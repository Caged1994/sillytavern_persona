/**
 * Map — the places of the story (rules in utils/placeModel.js).
 *
 * The Map tab shows the places from the lorebook ("Place:" entries) as a
 * schema: where you are, who is around, what can be done, which are closed
 * and where a dungeon is open. "Go here" writes a line in the chat box (like
 * free time: edit it, send it, or erase it to cancel); when it is sent the
 * calendar's place moves there and the AI is told. Moving costs no time.
 *
 * Who is where comes from the "Where:" lines of Confidants and activities,
 * matched to a place by its name or aliases.
 */
import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles, chat } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { getReadableWorldNames, loadWorldData } from '../lorebook/lorebookAPI.js';
import { getPersonaName, notifyStatsChanged } from './characterStats.js';
import { isCalendarEnabled, getNow, getPlace, setPlace, CALENDAR_CHANGED_EVENT } from './calendar.js';
import { freeTimeNow } from './freeTime.js';
import { isOtherworldEnabled, getSites } from './otherworld.js';
import * as K from '../../utils/calendarModel.js';
import * as M from '../../utils/placeModel.js';

const MOVE_PROMPT = 'dooms-map-move';

export function isMapEnabled() {
    return isCalendarEnabled() && extensionSettings.mapEnabled !== false;
}

export function setMapEnabled(on) {
    extensionSettings.mapEnabled = !!on;
    saveSettings();
    notifyStatsChanged({ source: 'calendar' });
}

// ─── The lorebook ───────────────────────────────────────────────────────────

let book = { places: [], decor: { water: [] }, books: [], at: 0 };
let loading = null;

export function refreshPlaceBook({ force = false } = {}) {
    if (loading) return loading;
    loading = (async () => {
        const books = [...getReadableWorldNames()];
        const entries = [];
        for (const b of books) {
            try { entries.push(...Object.values((await loadWorldData(b, force))?.entries || {})); } catch (e) { /* skip */ }
        }
        book = { places: M.parsePlaceBook(entries), decor: M.parseMapDecor(entries), books, at: Date.now() };
        try { window.dispatchEvent(new CustomEvent(CALENDAR_CHANGED_EVENT)); } catch (e) { /* no window */ }
        return book.places;
    })().finally(() => { loading = null; });
    return loading;
}

function current() {
    let books = [];
    try { books = [...getReadableWorldNames()]; } catch (e) { books = []; }
    const same = books.length === book.books.length && books.every((b, i) => b === book.books[i]);
    if (!same || Date.now() - book.at > 60000) refreshPlaceBook().catch(() => {});
    return book;
}

/** For tests: use these places (and decoration) as the lorebook's. */
export function setPlacesForTests(places, decor = { water: [] }) {
    let books = [];
    try { books = [...getReadableWorldNames()]; } catch (e) { books = []; }
    book = { places: (places || []).map(M.normalizePlace).filter(Boolean), decor, books, at: Date.now() };
}

export function getPlaces() {
    return current().places;
}

export function getDecor() {
    return current().decor;
}

// ─── The map now ────────────────────────────────────────────────────────────

/**
 * Everything the tab shows: { now, places: [{ ...place, pos, open, here, alert,
 * people: [{ name, arcana, rank }], activities: [{ id, name, icon }] }],
 * edges, here: place | null, decor } — or null without places or a date.
 */
export function mapNow() {
    if (!isMapEnabled()) return null;
    const places = getPlaces();
    const now = getNow();
    if (!places.length || !now) return null;
    const weekday = K.weekday(now.date);
    const ft = freeTimeNow({ force: true });
    let sites = [];
    try { sites = isOtherworldEnabled() ? getSites() : []; } catch (e) { sites = []; }
    const hereP = M.matchPlace(places, getPlace());
    const pos = M.layoutPlaces(places);
    const out = places.map(p => {
        const people = (ft?.people || []).filter(x => x.where && M.matchPlace(places, x.where)?.id === p.id)
            .map(x => ({ name: x.name, arcana: x.arcana, rank: x.rank }));
        const activities = (ft?.activities || []).filter(a => a.where && M.matchPlace(places, a.where)?.id === p.id)
            .map(a => ({ id: a.id, name: a.name, icon: a.icon, fx: a.now }));
        const alert = p.sites.some(n => sites.some(s => s.status === 'open' && M.placeKey(s.name) === M.placeKey(n)));
        return { ...p, pos: pos[p.id], open: M.isOpen(p, weekday, now.slot), here: hereP?.id === p.id, alert, people, activities };
    });
    return { now, weekday, places: out, edges: M.edgesOf(places), here: out.find(p => p.here) || null, decor: getDecor(), tired: !!ft?.tired };
}

// ─── Going somewhere (the chat box) ─────────────────────────────────────────

let pending = null; // { id, name, text, at: { date, slot } }

export function getPendingTravel() {
    return pending ? { ...pending } : null;
}

function chatBox() {
    return document.getElementById('send_textarea');
}

function fillChatBox(text) {
    const ta = chatBox();
    if (!ta) return false;
    ta.value = text;
    try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { /* old browser */ }
    try { ta.focus(); ta.setSelectionRange(text.length, text.length); } catch (e) { /* not focusable */ }
    return true;
}

/** Puts the line for going to a place in the chat box. Returns { text } or { error }. */
export function goTo(id) {
    const m = mapNow();
    if (!m) return { error: 'Set a date in the calendar first.' };
    const p = m.places.find(x => x.id === id);
    if (!p) return { error: 'No such place.' };
    if (p.here) return { error: 'You are already here.' };
    if (!p.open) return { error: `${p.name} is closed now (${M.hoursText(p)}).` };
    const text = M.travelText(p, getPersonaName() || 'I');
    pending = { id: p.id, name: p.name, text, at: { date: m.now.date, slot: m.now.slot } };
    if (!fillChatBox(text)) return { error: 'The chat box is not there.' };
    notifyStatsChanged({ source: 'calendar' });
    return { text };
}

export function cancelTravel() {
    if (!pending) return;
    const ta = chatBox();
    if (ta && ta.value === pending.text) fillChatBox('');
    pending = null;
    notifyStatsChanged({ source: 'calendar' });
}

/** Whether the sent message is still the picked line (edited is fine). */
function stillThePick(message, p) {
    const sent = String(message || '').replace(/[*_]/g, '').toLowerCase();
    const want = p.text.replace(/[*_]/g, '').toLowerCase();
    return sent.includes(want.slice(0, Math.min(18, want.length))) || sent.includes(p.name.toLowerCase());
}

/** MESSAGE_SENT: if the message is the picked line, the place moves there. */
export function onMapMessageSent() {
    try { setExtensionPrompt(MOVE_PROMPT, '', extension_prompt_types.IN_CHAT, 0, false); } catch (e) { /* no slot */ }
    const p = pending;
    if (!p) return null;
    pending = null;
    const idx = Array.isArray(chat) ? chat.length - 1 : -1;
    const msg = idx >= 0 ? chat[idx] : null;
    if (!msg || !msg.is_user || !stillThePick(msg.mes, p)) { notifyStatsChanged({ source: 'calendar' }); return null; }
    setPlace(p.name);
    try {
        setExtensionPrompt(MOVE_PROMPT, `[MOVE — ${getPersonaName() || 'The player'} has gone to ${p.name}. The game has moved the scene there (no time passed): narrate the arrival and what is going on there.]`, extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
    } catch (e) { /* no slot */ }
    notifyStatsChanged({ source: 'calendar' });
    console.log(`[Dooms Tracker] Map: moved to "${p.name}"`);
    return p;
}

// ─── The prompt ─────────────────────────────────────────────────────────────

export function buildMapPromptForGeneration() {
    if (!isMapEnabled()) return '';
    const m = mapNow();
    if (!m) return '';
    return M.mapPrompt(m.places, m.here, { user: getPersonaName() || 'The player', openNow: m.places.filter(p => p.open).map(p => p.id) });
}
