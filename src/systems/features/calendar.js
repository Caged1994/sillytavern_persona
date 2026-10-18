/**
 * Calendar — the in-game date and time of day (rules in calendarModel.js).
 *
 *   chat_metadata.dooms_tracker.betterStats.calendar =
 *     { now: { date: 'YYYY-MM-DD', slot }, events: [event], days: { 'YYYY-MM-DD': { weather, forecast } } }
 *
 * The calendar is in charge of the Info Box date and time: the AI writes them
 * there as before, the calendar reads them, refuses to go back in time, and
 * writes its own date (and a time in its slot) back into the Info Box. When
 * the Info Box has no date widget the AI uses the "calendar" key instead.
 * The day's weather is taken from the Info Box; the AI can add a forecast,
 * events and deadlines ("calendar" key). Lorebook entries titled
 * "Calendar: …" add events too. A swipe undoes what the replaced reply did.
 */
import { chat, chat_metadata } from '../../../../../../../script.js';
import { recordMessageEvent } from './messageEvents.js';
import { extensionSettings, lastGeneratedData, committedTrackerData } from '../../core/state.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import { isRpgModeActive } from './rpgMode.js';
import { chatStore, saveChatScope, CHAT_SCOPE } from './chatScope.js';
import { notifyStatsChanged } from './characterStats.js';
import { getReadableWorldNames, loadWorldData } from '../lorebook/lorebookAPI.js';
import { repairJSON } from '../../utils/jsonRepair.js';
import * as K from '../../utils/calendarModel.js';

export const CALENDAR_CHANGED_EVENT = 'dooms:calendar';
const KEEP_DAYS = 120;

export function isCalendarEnabled() {
    return isRpgModeActive() && extensionSettings.calendarEnabled !== false;
}

export function setCalendarEnabled(on) {
    extensionSettings.calendarEnabled = !!on;
    saveSettings();
    notifyStatsChanged({ source: 'calendar' });
}

// ─── Storage ────────────────────────────────────────────────────────────────

function store(create = false) {
    const s = chatStore('calendar', create);
    if (s) {
        if (!Array.isArray(s.events)) s.events = [];
        if (!s.days || typeof s.days !== 'object') s.days = {};
        if (s.now && !K.normalizeMoment(s.now)) s.now = null;
        if (typeof s.place !== 'string') s.place = '';
    }
    return s;
}

const snapshot = () => {
    const s = store();
    return s ? JSON.parse(JSON.stringify({ now: s.now || null, events: s.events, days: s.days, place: s.place || '' })) : { now: null, events: [], days: {}, place: '' };
};

function restore(snap) {
    const s = store(true);
    if (!s) return;
    s.now = snap.now ? { ...snap.now } : null;
    s.events = JSON.parse(JSON.stringify(snap.events || []));
    s.days = JSON.parse(JSON.stringify(snap.days || {}));
    s.place = snap.place || '';
}

function trimDays(s) {
    if (!s.now) return;
    for (const d of Object.keys(s.days)) {
        const diff = K.dayDiff(s.now.date, d);
        if (!Number.isFinite(diff) || diff < -KEEP_DAYS || diff > 31) delete s.days[d];
    }
}

function changed({ sync = true } = {}) {
    if (sync) syncInfoBox();
    refreshScene();
    saveChatScope();
    notifyStatsChanged({ source: 'calendar' });
    try { window.dispatchEvent(new CustomEvent(CALENDAR_CHANGED_EVENT)); } catch (e) { /* no window */ }
}

// ─── Lorebook events ────────────────────────────────────────────────────────

let book = { list: [], books: [], at: 0 };
let loading = null;

export function refreshCalendarBook({ force = false } = {}) {
    if (loading) return loading;
    loading = (async () => {
        const books = [...getReadableWorldNames()];
        const entries = [];
        for (const b of books) {
            try {
                const data = await loadWorldData(b, force);
                entries.push(...Object.values(data?.entries || {}));
            } catch (e) { /* unreadable lorebook: skip */ }
        }
        book = { list: K.parseCalendarBook(entries), books, at: Date.now() };
        try { window.dispatchEvent(new CustomEvent(CALENDAR_CHANGED_EVENT)); } catch (e) { /* no window */ }
        return book.list;
    })().finally(() => { loading = null; });
    return loading;
}

function bookEvents() {
    let books = [];
    try { books = [...getReadableWorldNames()]; } catch (e) { books = []; }
    const same = books.length === book.books.length && books.every((b, i) => b === book.books[i]);
    if (!same || Date.now() - book.at > 60000) refreshCalendarBook().catch(() => {});
    return book.list;
}

/** For tests: use this list as the lorebook events. */
export function setBookEventsForTests(list) {
    let books = [];
    try { books = [...getReadableWorldNames()]; } catch (e) { books = []; }
    book = { list: list || [], books, at: Date.now() };
}

// ─── Reading ────────────────────────────────────────────────────────────────

export function getNow() {
    const s = store();
    return s?.now ? { ...s.now } : null;
}

/** Every event: the chat's own and the lorebook's (lorebook ones marked done in the chat stay done). */
export function getEvents() {
    const s = store();
    const own = s?.events || [];
    const doneBook = new Set(own.filter(e => e.bookRef && e.done).map(e => e.bookRef));
    const fromBook = bookEvents().map(e => ({ ...e, id: `lb:${e.date}:${e.title}`, done: doneBook.has(`${e.date}:${e.title}`) }));
    return [...own.filter(e => !e.bookRef), ...fromBook];
}

/** Where the scene is (kept by the calendar; from the Info Box when it has one). */
export function getPlace() {
    return store()?.place || '';
}

export function setPlace(place) {
    const s = store(true);
    if (!s) return false;
    s.place = String(place || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    changed({ sync: false });
    return true;
}

/** Whether the Info Box carries the date (and the scene): otherwise the calendar does. */
export function infoBoxCarriesScene() {
    const w = extensionSettings.trackerConfig?.infoBox?.widgets;
    return !!(extensionSettings.showInfoBox !== false && w?.date?.enabled);
}

/**
 * The scene as Info Box JSON, built from the calendar (date, a time in the
 * slot, the day's weather, the place) — for the weather effects and the chat
 * scene header when there is no Info Box. null without a date.
 */
export function sceneAsInfoBox() {
    if (!isCalendarEnabled()) return null;
    const now = getNow();
    if (!now) return null;
    const w = getDay(now.date)?.weather || '';
    const emoji = (w.match(/^\p{Extended_Pictographic}\uFE0F?/u) || [''])[0];
    const out = { date: { value: K.formatLong(now.date) }, time: { start: K.SLOTS.find(s => s.id === now.slot).clock, end: '' } };
    if (w) out.weather = { emoji, forecast: w.slice(emoji.length).trim() || w };
    const place = getPlace();
    if (place) out.location = { value: place };
    return JSON.stringify(out);
}

/** Repaints what shows the scene (weather effects, the chat scene header). */
function refreshScene() {
    import('../ui/weatherEffects.js').then(m => m.updateWeatherEffect?.()).catch(() => {});
    import('../rendering/sceneHeaders.js').then(m => m.updateChatSceneHeaders?.()).catch(() => {});
}

export function getDay(date) {
    const s = store();
    return s?.days?.[date] ? { ...s.days[date] } : null;
}

/** Everything the panel needs for a month. */
export function getMonthView(year, month) {
    const now = getNow();
    const events = getEvents();
    const first = K.ymd(year, month, 1);
    const days = [];
    for (let d = first; d && K.splitYmd(d).m === month; d = K.addDays(d, 1)) {
        days.push({
            date: d,
            day: K.splitYmd(d).d,
            weekday: K.weekday(d),
            today: now?.date === d,
            past: now ? K.dayDiff(now.date, d) < 0 : false,
            weather: getDay(d)?.weather || '',
            forecast: !!getDay(d)?.forecast,
            events: events.filter(e => K.eventOn(e, d)),
        });
    }
    return { year, month, days, now };
}

export function getUpcoming(days = 30) {
    const now = getNow();
    return now ? K.upcoming(getEvents(), now.date, days) : [];
}

// ─── Changing it by hand ────────────────────────────────────────────────────

/** Sets the moment (by hand: may go back). */
export function setNow(date, slot = 'morning') {
    const m = K.normalizeMoment({ date, slot });
    if (!m) return { error: 'Not a valid date.' };
    const s = store(true);
    s.now = m;
    trimDays(s);
    changed();
    return { now: m };
}

/** Moves on by one slot or to the next morning. */
export function advance(step = 'slot') {
    const now = getNow();
    if (!now) return { error: 'Set a date first.' };
    const next = step === 'day' ? K.nextDay(now) : K.nextSlot(now);
    return setNow(next.date, next.slot);
}

export function addEvent(raw) {
    const now = getNow();
    const ev = K.normalizeEvent({ ...raw, source: raw?.source || 'user' }, { year: now ? K.splitYmd(now.date).y : null });
    if (!ev) return { error: 'An event needs a title and a date.' };
    const s = store(true);
    if (s.events.length >= K.MAX_EVENTS) return { error: `At most ${K.MAX_EVENTS} events.` };
    s.events.push(ev);
    changed({ sync: false });
    return { event: ev };
}

export function removeEvent(id) {
    const s = store(true);
    const i = s.events.findIndex(e => e.id === id);
    if (i === -1) return false;
    s.events.splice(i, 1);
    changed({ sync: false });
    return true;
}

/** Marks an event dealt with (or not). Lorebook events are remembered by date and title. */
export function setEventDone(id, done = true) {
    const s = store(true);
    if (String(id).startsWith('lb:')) {
        const ref = String(id).slice(3);
        const ev = bookEvents().find(e => `${e.date}:${e.title}` === ref);
        if (!ev) return false;
        let rec = s.events.find(e => e.bookRef === ref);
        if (!rec) { rec = { ...ev, id: `ref:${ref}`, bookRef: ref }; s.events.push(rec); }
        rec.done = !!done;
    } else {
        const ev = s.events.find(e => e.id === id);
        if (!ev) return false;
        if (done) ev.done = true; else delete ev.done;
    }
    changed({ sync: false });
    return true;
}

export function setWeather(date, weather, { forecast = false } = {}) {
    if (!K.splitYmd(date)) return false;
    const s = store(true);
    const w = String(weather || '').trim().slice(0, 40);
    if (!w) delete s.days[date];
    else s.days[date] = { weather: w, ...(forecast ? { forecast: true } : {}) };
    changed({ sync: false });
    return true;
}

// ─── The Info Box ───────────────────────────────────────────────────────────

function readJson(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    const t = String(raw).trim();
    if (!t.startsWith('{')) return null;
    try { return JSON.parse(t); } catch (e) { return repairJSON(t) || null; }
}

/** { date, slot, weather } the Info Box text says, any of them null. */
export function readInfoBox(raw, { year = null } = {}) {
    const j = readJson(raw);
    if (!j) {
        const text = String(raw || '');
        const dl = text.match(/(?:Date:|🗓️:)\s*(.+)/);
        const tl = text.match(/(?:Time:|🕒:)\s*(.+)/);
        return { date: dl ? K.parseDate(dl[1], { year }) : null, slot: tl ? K.normalizeSlot(tl[1].split('→')[0]) : null, weather: null, location: null };
    }
    const dateText = typeof j.date === 'string' ? j.date : j.date?.value;
    const timeText = typeof j.time === 'string' ? j.time.split('→')[0] : j.time?.start;
    const w = j.weather;
    const weather = w ? (typeof w === 'string' ? w : [w.emoji, w.forecast].filter(Boolean).join(' ')).trim() || null : null;
    const loc = typeof j.location === 'string' ? j.location : j.location?.value;
    return { date: dateText ? K.parseDate(dateText, { year }) : null, slot: timeText ? K.normalizeSlot(timeText) : null, weather, location: loc ? String(loc).trim() || null : null };
}

/** The Info Box JSON with the calendar's date and a time in its slot, or null when unchanged. */
export function patchInfoBox(raw, now) {
    const j = readJson(raw);
    if (!j || !now) return null;
    let touched = false;
    const long = K.formatLong(now.date);
    const curDate = typeof j.date === 'string' ? j.date : j.date?.value;
    if (curDate !== undefined && curDate !== long) {
        if (typeof j.date === 'string') j.date = long; else j.date = { ...(j.date || {}), value: long };
        touched = true;
    }
    const timeText = typeof j.time === 'string' ? j.time.split('→')[0] : j.time?.start;
    if (j.time !== undefined && K.slotFromClock(timeText) !== now.slot && K.normalizeSlot(timeText) !== now.slot) {
        const clock = K.SLOTS.find(s => s.id === now.slot).clock;
        if (typeof j.time === 'string') j.time = clock; else j.time = { start: clock, end: '' };
        touched = true;
    }
    return touched ? JSON.stringify(j) : null;
}

/** Writes the calendar's date and slot into the Info Box shown and sent to the AI. */
export function syncInfoBox({ render = true } = {}) {
    if (!isCalendarEnabled()) return false;
    const now = getNow();
    if (!now) return false;
    let any = false;
    for (const holder of [lastGeneratedData, committedTrackerData]) {
        const next = patchInfoBox(holder.infoBox, now);
        if (next) { holder.infoBox = next; any = true; }
    }
    if (any && render) import('../rendering/infoBox.js').then(m => m.renderInfoBox?.()).catch(() => {});
    return any;
}

/**
 * Looks back through the chat (newest first) for the last date the story
 * gave — in an Info Box saved with a reply, or a header in the text such as
 * "APRIL 1 — TUESDAY" — and sets the calendar to it. For chats that were
 * already going before the calendar was on. Returns { now } or { error }.
 */
export function readDateFromChat({ lookBack = 40 } = {}) {
    const msgs = Array.isArray(chat) ? chat : [];
    for (let i = msgs.length - 1; i >= 0 && i >= msgs.length - lookBack; i--) {
        const m = msgs[i];
        if (!m || m.is_user || m.is_system) continue;
        const swipe = m.extra?.dooms_tracker_swipes?.[m.swipe_id ?? 0];
        const box = swipe?.infoBox ? readInfoBox(swipe.infoBox) : null;
        let date = box?.date || null;
        let slot = box?.slot || null;
        if (!date) {
            date = K.findDateInText(m.mes);
            slot = date ? K.findSlotInText(m.mes) : null;
        }
        if (date) return setNow(date, slot || 'morning');
    }
    return { error: 'No date found in the recent messages: set it by hand.' };
}

/** The user changed the Info Box date or time by hand: the calendar follows (it may go back). */
export function followInfoBoxEdit(raw) {
    if (!isCalendarEnabled()) return false;
    const now = getNow();
    const r = readInfoBox(raw, { year: now ? K.splitYmd(now.date).y : null });
    const date = r.date || now?.date;
    if (!date) return false;
    const slot = r.slot || now?.slot || 'morning';
    if (now && now.date === date && now.slot === slot) return false;
    setNow(date, slot);
    return true;
}

// ─── The AI ─────────────────────────────────────────────────────────────────


function needForecast() {
    const now = getNow();
    if (!now) return false;
    for (let i = 1; i <= K.FORECAST_DAYS; i++) if (!getDay(K.addDays(now.date, i))?.weather) return true;
    return false;
}

export function buildCalendarPromptForGeneration({ compact = true, standalone = false } = {}) {
    if (!isCalendarEnabled()) return '';
    const now = getNow();
    const events = getEvents();
    return K.buildCalendarPrompt({
        now,
        soon: now ? K.upcoming(events, now.date, 14) : [],
        late: now ? K.overdue(events, now.date) : [],
        needForecast: needForecast(),
        infoBoxDate: infoBoxCarriesScene(),
        weather: now ? getDay(now.date)?.weather || '' : '',
        location: getPlace(),
        compact, standalone,
    });
}

export function buildCalendarContextSummary() {
    if (!isCalendarEnabled()) return '';
    const now = getNow();
    if (!now) return '';
    const soon = K.upcoming(getEvents(), now.date, 7);
    // Without an Info Box in the context, the scene comes from here.
    const scene = infoBoxCarriesScene() ? '' : [getPlace() && `at ${getPlace()}`, getDay(now.date)?.weather && `weather ${getDay(now.date).weather}`].filter(Boolean).join(', ');
    return `Date: ${K.formatLong(now.date)}, ${K.slotName(now.slot).toLowerCase()}${scene ? `; ${scene}` : ''}${soon.length ? `; coming up: ${soon.map(e => `${e.title} ${K.countdown(e.days)}`).join(', ')}` : ''}`;
}

function toast(kind, text, title = 'Calendar') {
    try { globalThis.toastr?.[kind]?.(text, title, { timeOut: 4000 }); } catch (e) { /* no toasts */ }
}

/**
 * Applies a fresh reply: the "calendar" key and the Info Box date/time/weather.
 * Time never goes back here. Returns whether anything changed.
 */
export function applyAICalendar(rawKey, rawInfoBox, messageIndex) {
    if (!isCalendarEnabled()) return false;
    const before = snapshot();
    const s = store(true);
    if (!s) return false;
    const year = s.now ? K.splitYmd(s.now.date).y : null;
    const key = rawKey ? K.normalizeAICalendar(rawKey, { year }) : null;
    const box = rawInfoBox && infoBoxCarriesScene() ? readInfoBox(rawInfoBox, { year }) : { date: null, slot: null, weather: null, location: null };

    // The moment: the key first, then the Info Box, then a date header the
    // story itself writes ("APRIL 1 — TUESDAY" / "MORNING") — that one only
    // with month, day and weekday together, and close to today.
    let date = key?.date || box.date || null;
    let slot = key?.slot || box.slot || null;
    if (!date) {
        const prose = typeof messageIndex === 'number' ? chat?.[messageIndex]?.mes : null;
        const found = prose ? K.findDateInText(prose, { around: year ?? new Date().getFullYear() }) : null;
        let d = found;
        // Seen from a calendar that has a date, the same day of this year (or the next).
        if (d && s.now) {
            const p = K.splitYmd(d);
            const yr = K.splitYmd(s.now.date).y;
            d = K.ymd(yr, p.m, p.d);
            if (d && K.dayDiff(s.now.date, d) < -180) d = K.ymd(yr + 1, p.m, p.d);
            if (d && (K.dayDiff(s.now.date, d) < -7 || K.dayDiff(s.now.date, d) > 60)) d = null;
        }
        if (d) {
            date = d;
            slot = slot || K.findSlotInText(prose);
        }
    }
    let moved = null;
    if (date || slot) {
        const target = K.normalizeMoment({ date: date || s.now?.date, slot: slot || (date && s.now && date !== s.now.date ? 'morning' : s.now?.slot) || 'morning' });
        if (target && (!s.now || K.compareMoments(target, s.now) > 0)) {
            const days = s.now ? K.dayDiff(s.now.date, target.date) : 0;
            s.now = target;
            moved = days;
        } else if (target && s.now && K.compareMoments(target, s.now) < 0) {
            console.log(`[Dooms Tracker] Calendar: the reply went back to ${target.date} ${target.slot}; kept ${s.now.date} ${s.now.slot}`);
        }
    }
    // Weather of today, the place, the forecast, events.
    const weatherNow = key?.weather || box.weather;
    if (s.now && weatherNow) s.days[s.now.date] = { weather: weatherNow.slice(0, 40) };
    const placeNow = key?.location || box.location;
    if (placeNow) s.place = placeNow.slice(0, 80);
    for (const f of key?.forecast || []) {
        if (s.now && K.dayDiff(s.now.date, f.date) > 0 && !(s.days[f.date] && !s.days[f.date].forecast)) s.days[f.date] = { weather: f.weather, forecast: true };
    }
    const all = getEvents();
    for (const ev of key?.events || []) {
        if (all.some(e => K.eventOn(e, ev.date.length === 5 ? `2000-${ev.date}` : ev.date) && e.title.toLowerCase() === ev.title.toLowerCase())) continue;
        if (s.events.length < K.MAX_EVENTS) { s.events.push(ev); toast('info', `${K.KINDS[ev.kind].icon} ${ev.title} — ${ev.date.length === 5 ? ev.date : K.formatShort(ev.date)}`); }
    }
    for (const t of key?.done || []) {
        const ev = all.find(e => !e.done && e.title.toLowerCase() === t.toLowerCase());
        if (!ev) continue;
        if (String(ev.id).startsWith('lb:')) {
            const ref = String(ev.id).slice(3);
            if (!s.events.some(e => e.bookRef === ref)) s.events.push({ ...ev, id: `ref:${ref}`, bookRef: ref, done: true });
        } else {
            const own = s.events.find(e => e.id === ev.id);
            if (own) own.done = true;
        }
    }
    trimDays(s);
    if (JSON.stringify(snapshot()) === JSON.stringify(before)) { syncInfoBox(); return false; }
    // Where and when the story is after this reply (the chat's day and place cards).
    if (s.now && (moved !== null || placeNow || weatherNow)) {
        recordMessageEvent(messageIndex, 'when', { date: s.now.date, slot: s.now.slot, place: s.place || '', weather: s.days[s.now.date]?.weather || '' });
    }
    if (moved && moved > 0) {
        const due = K.upcoming(getEvents(), s.now.date, 0);
        toast('info', `${K.formatShort(s.now.date)} · ${K.slotName(s.now.slot)}${due.length ? ` — today: ${due.map(e => e.title).join(', ')}` : ''}`);
    }
    try {
        if (chat_metadata) {
            if (!chat_metadata.dooms_tracker) chat_metadata.dooms_tracker = {};
            const prev = chat_metadata.dooms_tracker.calendarUndo;
            const start = prev && prev.messageIndex === messageIndex ? prev.before : before;
            chat_metadata.dooms_tracker.calendarUndo = { messageIndex, campaign: CHAT_SCOPE, before: start, after: snapshot() };
        }
    } catch (e) { /* undo is best-effort */ }
    changed();
    return true;
}

/** Before a swipe/regenerate: put back what the replaced reply changed, if untouched since. */
export function revertAICalendarForReplacedMessage(replacedIndex) {
    try {
        const rec = chat_metadata?.dooms_tracker?.calendarUndo;
        if (!rec) return 0;
        const lastIdx = Array.isArray(chat) ? chat.length - 1 : -1;
        const idx = typeof replacedIndex === 'number' ? replacedIndex : lastIdx;
        if (rec.messageIndex !== idx && rec.messageIndex !== idx + 1) return 0;
        delete chat_metadata.dooms_tracker.calendarUndo;
        if (JSON.stringify(snapshot()) !== JSON.stringify(rec.after)) { saveChatData(); return 0; }
        restore(rec.before);
        saveChatScope();
        notifyStatsChanged({ source: 'undo' });
        saveChatData();
        return 1;
    } catch (e) {
        console.warn('[Dooms Tracker] Calendar: undo failed', e);
        return 0;
    }
}
