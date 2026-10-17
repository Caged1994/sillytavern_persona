/**
 * Calendar — pure rules: dates, the four time slots, events and deadlines,
 * weather by day, and the prompt.
 *
 * A moment is { date: 'YYYY-MM-DD', slot: 'morning' | 'afternoon' | 'evening' | 'night' }
 * on the real (Gregorian) calendar, as in the Persona games. Time only moves
 * forward when the AI moves it; the user can set any moment by hand.
 *
 * Events: { id, date: 'YYYY-MM-DD' | 'MM-DD' (every year), title, kind, slot?, source, done? }
 *   kind: event | deadline | exam | holiday
 * Lorebook entries titled "Calendar: …" list them one per line:
 *   April 29: Golden Week (holiday)
 *   2016-05-05: Kamoshida's Palace deadline (deadline)
 *   July 13 evening — Fireworks festival
 */
export const SLOTS = [
    { id: 'morning', name: 'Morning', icon: '🌅', from: 5, clock: '8:00 AM' },
    { id: 'afternoon', name: 'Afternoon', icon: '☀️', from: 12, clock: '1:00 PM' },
    { id: 'evening', name: 'Evening', icon: '🌆', from: 18, clock: '7:00 PM' },
    { id: 'night', name: 'Night', icon: '🌙', from: 22, clock: '11:00 PM' },
];
export const SLOT_IDS = SLOTS.map(s => s.id);
export const KINDS = {
    event: { name: 'Event', icon: '📌' },
    deadline: { name: 'Deadline', icon: '⏳' },
    exam: { name: 'Exam', icon: '📝' },
    holiday: { name: 'Holiday', icon: '🎌' },
};
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MAX_EVENTS = 200;
export const FORECAST_DAYS = 3;

const MONTH_WORDS = {
    jan: 1, january: 1, gennaio: 1, feb: 2, february: 2, febbraio: 2, mar: 3, march: 3, marzo: 3,
    apr: 4, april: 4, aprile: 4, may: 5, maggio: 5, jun: 6, june: 6, giugno: 6, jul: 7, july: 7, luglio: 7,
    aug: 8, august: 8, agosto: 8, sep: 9, sept: 9, september: 9, settembre: 9, oct: 10, october: 10, ottobre: 10,
    nov: 11, november: 11, novembre: 11, dec: 12, december: 12, dicembre: 12,
};

const pad = (n) => String(n).padStart(2, '0');
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// ─── Dates ──────────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' from numbers, or null when not a real day. */
export function ymd(y, m, d) {
    y = Math.round(y); m = Math.round(m); d = Math.round(d);
    if (![y, m, d].every(Number.isFinite) || y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
    const t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCMonth() !== m - 1) return null;
    return `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
}

/** { y, m, d } of a 'YYYY-MM-DD', or null. */
export function splitYmd(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m && ymd(+m[1], +m[2], +m[3]) ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

const toUtc = (s) => { const p = splitYmd(s); return p ? Date.UTC(p.y, p.m - 1, p.d) : NaN; };

export function addDays(s, n) {
    const t = toUtc(s);
    if (!Number.isFinite(t)) return null;
    const d = new Date(t + Math.round(n) * 86400000);
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Whole days from a to b (b − a). */
export function dayDiff(a, b) {
    return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

export function weekday(s) {
    const t = toUtc(s);
    return Number.isFinite(t) ? new Date(t).getUTCDay() : null;
}

const WEEKDAY_WORDS = {
    sunday: 0, sun: 0, domenica: 0, monday: 1, mon: 1, lunedi: 1, lunedì: 1, tuesday: 2, tue: 2, tues: 2, martedi: 2, martedì: 2,
    wednesday: 3, wed: 3, mercoledi: 3, mercoledì: 3, thursday: 4, thu: 4, thurs: 4, giovedi: 4, giovedì: 4,
    friday: 5, fri: 5, venerdi: 5, venerdì: 5, saturday: 6, sat: 6, sabato: 6,
};

/** The weekday a text names (0 = Sunday), or null. */
export function weekdayIn(text) {
    for (const w of String(text ?? '').toLowerCase().match(/[a-zà-ù]+/g) || []) if (WEEKDAY_WORDS[w] !== undefined) return WEEKDAY_WORDS[w];
    return null;
}

/**
 * The year nearest to `around` in which month/day falls on `wd` — so
 * "Tuesday, April 1" without a year lands on a year where April 1 really is
 * a Tuesday (2025 seen from 2026), not on a calendar that disagrees with the story.
 */
export function inferYear(month, day, wd, around = new Date().getFullYear()) {
    for (let k = 0; k <= 30; k++) {
        for (const y of k ? [around - k, around + k] : [around]) {
            const d = ymd(y, month, day);
            if (d && weekday(d) === wd) return y;
        }
    }
    return around;
}

/**
 * A date out of free text: "Tuesday, April 12, 2016", "April 12th 2016",
 * "12 aprile 2016", "2016-04-12", "4/12/2016", "April 12" (year from `year`).
 * Without any year, a weekday picks the nearest year it fits ("APRIL 1 —
 * TUESDAY" → 2025, seen from 2026); with neither, there is no date.
 * @returns {string|null} 'YYYY-MM-DD'
 */
export function parseDate(text, { year = null, around = null } = {}) {
    const s = String(text ?? '').toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1');
    let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    const wd = weekdayIn(s);
    const guess = (mo, d) => (year ?? (wd !== null ? inferYear(mo, d, wd, around ?? new Date().getFullYear()) : null));
    m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (m) {
        const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : guess(+m[1], +m[2]);
        return y ? ymd(y, +m[1], +m[2]) : null;
    }
    const yearM = s.match(/\b(\d{4})\b/);
    // "April 12" or "12 April"
    const words = [...s.matchAll(/[a-zà-ù]+/g)].map(w => w[0]);
    const monthWord = words.find(w => MONTH_WORDS[w]);
    if (!monthWord) return null;
    const mo = MONTH_WORDS[monthWord];
    const after = s.match(new RegExp(`${monthWord}\\.?\\s+(\\d{1,2})\\b(?!\\d)`));
    const before = s.match(new RegExp(`\\b(\\d{1,2})\\s+(?:of\\s+)?${monthWord}`));
    const day = after ? +after[1] : before ? +before[1] : null;
    if (!day) return null;
    const y = yearM ? +yearM[1] : guess(mo, day);
    return y ? ymd(y, mo, day) : null;
}

/**
 * A date written in a story's prose — a header like "APRIL 1 — TUESDAY" or
 * "Tuesday, April 1st" — only when month, day and weekday sit together (so a
 * passing "in May" never counts). Used to start a calendar that has no date.
 */
export function findDateInText(text, { around = null } = {}) {
    const s = String(text ?? '');
    const wd = '(?:mon|tue|tues|wed|thu|thurs|fri|sat|sun)[a-z]*|(?:luned|marted|mercoled|gioved|venerd)[iì]|sabato|domenica';
    const mon = Object.keys(MONTH_WORDS).join('|');
    const day = '\\d{1,2}(?:st|nd|rd|th)?';
    const yr = '(?:,?\\s*\\d{4})?';
    const sep = '[\\s,.\\-–—|:/]{1,6}';
    const pats = [
        `\\b(?:${wd})${sep}(?:(?:${mon})\\.?\\s+${day}|${day}\\s+(?:${mon}))${yr}\\b`,
        `\\b(?:(?:${mon})\\.?\\s+${day}|${day}\\s+(?:${mon}))${yr}${sep}(?:${wd})\\b`,
    ];
    for (const p of pats) {
        const m = s.match(new RegExp(p, 'i'));
        if (m) { const d = parseDate(m[0], { around }); if (d) return d; }
    }
    return null;
}

/** A time of day written alone on a line ("MORNING", "After School"), or null. */
export function findSlotInText(text) {
    const m = String(text ?? '').match(/^[\s*_#>\[]*(early morning|morning|lunchtime|lunch|afternoon|after school|evening|late night|night|dark hour|mattina|pomeriggio|sera|notte)[\s*_\]]*$/im);
    return m ? normalizeSlot(m[1]) : null;
}

/** 'MM-DD' of a yearly date ("April 29", "4/29", "04-29"), or null. */
export function parseMonthDay(text) {
    const d = parseDate(text, { year: 2000 });
    const plain = String(text ?? '').match(/^\s*(\d{1,2})-(\d{1,2})\s*$/);
    if (plain && ymd(2000, +plain[1], +plain[2])) return `${pad(+plain[1])}-${pad(+plain[2])}`;
    return d ? d.slice(5) : null;
}

// ─── Slots ──────────────────────────────────────────────────────────────────

export function slotIndex(id) {
    return SLOT_IDS.indexOf(id);
}

export function normalizeSlot(v) {
    const s = String(v ?? '').toLowerCase().trim();
    if (!s) return null;
    if (SLOT_IDS.includes(s)) return s;
    if (/early\s*morning|dawn|morning|mattin|breakfast/.test(s)) return 'morning';
    if (/lunch|noon|afternoon|after\s*school|pomerigg|midday/.test(s)) return 'afternoon';
    if (/late\s*night|midnight|dark\s*hour|notte|night/.test(s)) return 'night';
    if (/evening|dusk|sunset|sera|dinner/.test(s)) return 'evening';
    return slotFromClock(s);
}

/** The slot of a clock time ("8:30 AM", "20:15", "11pm"), or null. */
export function slotFromClock(text) {
    const m = String(text ?? '').toLowerCase().match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/);
    if (!m) return null;
    let h = +m[1];
    if (h > 24) return null;
    const ap = m[3]?.replace(/\./g, '');
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h >= 22 || h < 5) return 'night';
    if (h >= 18) return 'evening';
    if (h >= 12) return 'afternoon';
    return 'morning';
}

// ─── Moments ────────────────────────────────────────────────────────────────

export function normalizeMoment(raw) {
    if (!raw || !splitYmd(raw.date)) return null;
    return { date: raw.date, slot: SLOT_IDS.includes(raw.slot) ? raw.slot : 'morning' };
}

/** < 0 when a is before b. */
export function compareMoments(a, b) {
    return dayDiff(b.date, a.date) || slotIndex(a.slot) - slotIndex(b.slot);
}

export function nextSlot(cur) {
    const i = slotIndex(cur.slot);
    return i < SLOTS.length - 1 ? { date: cur.date, slot: SLOT_IDS[i + 1] } : { date: addDays(cur.date, 1), slot: 'morning' };
}

export function nextDay(cur) {
    return { date: addDays(cur.date, 1), slot: 'morning' };
}

/** "Tuesday, April 12, 2016" */
export function formatLong(date) {
    const p = splitYmd(date);
    return p ? `${WEEKDAYS[weekday(date)]}, ${MONTHS[p.m - 1]} ${p.d}, ${p.y}` : '';
}

/** "4/12 Tu" — the P5 corner. */
export function formatShort(date) {
    const p = splitYmd(date);
    return p ? `${p.m}/${p.d} ${WEEKDAY_SHORT[weekday(date)]}` : '';
}

export function slotName(id) {
    return SLOTS.find(s => s.id === id)?.name || '';
}

// ─── Events ─────────────────────────────────────────────────────────────────

export function detectKind(text) {
    const s = String(text || '').toLowerCase();
    if (/deadline|scadenza|\bdue\b|palace|by the end/.test(s)) return 'deadline';
    if (/exam|test\b|midterm|finals|quiz|esame|verifica/.test(s)) return 'exam';
    if (/holiday|festival|vacation|break\b|festa|vacanz|golden week|christmas|new year/.test(s)) return 'holiday';
    return 'event';
}

let idCounter = 0;
const newId = () => `ev${Date.now().toString(36)}${(idCounter = (idCounter + 1) % 1e5).toString(36)}`;

/** A clean event, or null. A date without a year repeats every year. */
export function normalizeEvent(raw, { year = null } = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const title = clip(raw.title ?? raw.name ?? raw.event, 80);
    if (!title) return null;
    let date = splitYmd(raw.date) ? raw.date : null;
    if (!date && /^\d{2}-\d{2}$/.test(String(raw.date || ''))) date = raw.date;
    if (!date) {
        const hasYear = /\b\d{4}\b|\/\d{2,4}\b/.test(String(raw.date || ''));
        date = hasYear ? parseDate(raw.date) : (raw.yearly === false && year ? parseDate(raw.date, { year }) : parseMonthDay(raw.date));
    }
    if (!date) return null;
    const kindRaw = String(raw.kind || raw.type || '').toLowerCase();
    const kind = KINDS[kindRaw] ? kindRaw : detectKind(`${kindRaw} ${title}`);
    const ev = { id: typeof raw.id === 'string' && raw.id ? raw.id : newId(), date, title, kind };
    const slot = normalizeSlot(raw.slot ?? raw.time);
    if (slot) ev.slot = slot;
    ev.source = ['lorebook', 'ai', 'user'].includes(raw.source) ? raw.source : 'user';
    if (raw.done) ev.done = true;
    if (raw.desc) ev.desc = clip(raw.desc, 200);
    return ev;
}

/** Whether an event falls on a day (yearly ones every year). */
export function eventOn(ev, date) {
    return ev.date.length === 5 ? date.slice(5) === ev.date : ev.date === date;
}

/** The next date (on or after `from`) an event falls on. */
export function eventDate(ev, from) {
    if (ev.date.length !== 5) return ev.date;
    const y = splitYmd(from)?.y;
    if (!y) return null;
    let d = ymd(y, +ev.date.slice(0, 2), +ev.date.slice(3));
    if (!d) d = ymd(y, 3, 1); // 02-29 in a common year
    return dayDiff(from, d) >= 0 ? d : ymd(y + 1, +ev.date.slice(0, 2), +ev.date.slice(3)) || ymd(y + 1, 3, 1);
}

/** Events from `from` for `days` days: [{ ...ev, on, days }] sorted, skipping done ones. */
export function upcoming(events, from, days = 30) {
    const out = [];
    for (const ev of events || []) {
        if (ev.done) continue;
        const on = eventDate(ev, from);
        if (!on) continue;
        const left = dayDiff(from, on);
        if (left >= 0 && left <= days) out.push({ ...ev, on, days: left });
    }
    return out.sort((a, b) => a.days - b.days || (a.kind === 'deadline' ? -1 : 1));
}

/** Deadlines already past and not done. */
export function overdue(events, from) {
    return (events || []).filter(ev => ev.kind === 'deadline' && !ev.done && ev.date.length !== 5 && dayDiff(from, ev.date) < 0);
}

/** "today", "tomorrow", "in 5 days" */
export function countdown(days) {
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days < 0) return `${-days} day${days === -1 ? '' : 's'} ago`;
    return `in ${days} days`;
}

// ─── Lorebook ───────────────────────────────────────────────────────────────

const HEADER = /^\s*(?:calendar|events?|schedule)\s*[:\-–]/i;

export function isCalendarEntry(entry) {
    return HEADER.test(String(entry?.comment ?? '')) || HEADER.test(String(entry?.content ?? '').split(/\r?\n/)[0] || '');
}

/** The events of one "Calendar:" lorebook entry. */
export function parseCalendarEntry(entry) {
    if (!isCalendarEntry(entry)) return [];
    const out = [];
    for (const raw of String(entry.content ?? '').split(/\r?\n/)) {
        const line = raw.replace(/^\s*[-*•]\s*/, '').trim();
        if (!line || HEADER.test(line)) continue;
        const m = line.match(/^(.+?)\s*(?::|—|–|\s-\s)\s*(.+)$/);
        if (!m) continue;
        let when = m[1].trim();
        let title = m[2].trim();
        let slot = null;
        const sm = when.match(/\b(morning|afternoon|evening|night|lunchtime|after school|late night)\b/i);
        if (sm) { slot = normalizeSlot(sm[1]); when = when.replace(sm[0], '').trim(); }
        let kind = '';
        const km = title.match(/\((event|deadline|exam|holiday)\)\s*$/i);
        if (km) { kind = km[1].toLowerCase(); title = title.slice(0, km.index).trim(); }
        const ev = normalizeEvent({ date: when, title, kind, source: 'lorebook', ...(slot ? { slot } : {}) });
        if (ev) out.push(ev);
    }
    return out;
}

export function parseCalendarBook(entries) {
    const out = [];
    for (const e of entries || []) if (e && !e.disable) out.push(...parseCalendarEntry(e));
    return out;
}

// ─── The AI ─────────────────────────────────────────────────────────────────

/**
 * The "calendar" key: { date?, slot?, events?: [{date, title, kind, slot}],
 * forecast?: [{date, weather}], done?: [title] } (a JSON string or object).
 */
export function normalizeAICalendar(raw, { year = null } = {}) {
    let v = raw;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return null; } }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const out = { events: [], forecast: [], done: [] };
    if (v.date) out.date = parseDate(v.date, { year });
    if (v.slot || v.time) out.slot = normalizeSlot(v.slot || v.time);
    const w = typeof v.weather === 'object' && v.weather ? [v.weather.emoji, v.weather.forecast ?? v.weather.text].filter(Boolean).join(' ') : v.weather;
    if (clip(w, 40)) out.weather = clip(w, 40);
    const place = typeof v.location === 'object' && v.location ? v.location.value : v.location;
    if (clip(place, 80)) out.location = clip(place, 80);
    for (const e of Array.isArray(v.events) ? v.events.slice(0, 10) : []) {
        const hasYear = /\b\d{4}\b/.test(String(e?.date || ''));
        const ev = normalizeEvent({ ...e, date: hasYear || !year ? e?.date : parseDate(e?.date, { year }) || e?.date, source: 'ai' });
        if (ev) out.events.push(ev);
    }
    for (const f of Array.isArray(v.forecast) ? v.forecast.slice(0, 7) : []) {
        const d = parseDate(f?.date, { year });
        const w = clip(f?.weather ?? f?.forecast, 40);
        if (d && w) out.forecast.push({ date: d, weather: w });
    }
    for (const t of Array.isArray(v.done) ? v.done.slice(0, 10) : []) if (clip(t, 80)) out.done.push(clip(t, 80));
    return out;
}

/**
 * The prompt section.
 * @param {object} o
 * @param {{date, slot}|null} o.now
 * @param {object[]} o.soon - upcoming() results
 * @param {object[]} o.late - overdue deadlines
 * @param {boolean} o.needForecast - ask for the next days' weather
 * @param {boolean} o.infoBoxDate - the Info Box carries the date and time
 */
export function buildCalendarPrompt({ now = null, soon = [], late = [], needForecast = false, infoBoxDate = true, weather = '', location = '', compact = true, standalone = false } = {}) {
    const where = standalone ? 'start your reply with ONE JSON code block with' : 'add to the same tracker JSON object';
    const slots = SLOTS.map(s => `${s.name.toLowerCase()} (from ${s.from}:00)`).join(', ');
    let out;
    if (now) {
        out = `CALENDAR: today is ${formatLong(now.date)}, ${slotName(now.slot).toLowerCase()}. Time moves only forward, through ${slots}; move it when the story does (a scene ending, sleep, "the next day").`;
    } else {
        out = 'CALENDAR: no date yet — set one that fits the story: a real calendar date with its year, whose weekday matches (if the story already named "Tuesday, April 1", use a year where April 1 is a Tuesday).';
    }
    if (infoBoxDate) {
        out += ' Write the Info Box date as "Weekday, Month Day, Year" and its time as a clock time in that slot.';
    } else {
        // No Info Box: the calendar carries the scene too.
        if (weather || location) out += ` Now: ${[location && `at ${location}`, weather && `weather ${weather}`].filter(Boolean).join(', ')}.`;
        out += ` Whenever any of them changes, ${where} "calendar": {"date": "Month Day, Year", "slot": "morning|afternoon|evening|night", "weather": "🌧️ Rain", "location": "Place"} (only the parts that changed${now ? '' : '; now all of them'}).`;
    }
    if (soon.length) out += ` Coming up: ${soon.slice(0, 6).map(e => `${KINDS[e.kind].name.toLowerCase()} "${e.title}" ${countdown(e.days)}${e.days > 1 ? ` (${formatShort(e.on)})` : ''}`).join('; ')}.`;
    if (late.length) out += ` Missed deadline${late.length === 1 ? '' : 's'}: ${late.map(e => `"${e.title}"`).join(', ')} — the story should feel it.`;
    const ex = '"calendar": {"events": [{"date": "Month Day, Year", "title": "…", "kind": "event|deadline|exam|holiday"}]}';
    out += compact
        ? ` When the story sets a date to remember (an appointment, an exam, a deadline), ${where} ${ex}; "done": ["title"] when one is dealt with.`
        : ` When the story fixes something on a date (an appointment, an exam, a festival, a deadline the characters must meet), ${where} ${ex}; when one is dealt with before its date, "done": ["title"].`;
    if (needForecast) out += ` Also "forecast": [{"date": "Month Day, Year", "weather": "🌧️ Rain"}] for the next ${FORECAST_DAYS} days.`;
    out += ' Otherwise leave the key out.';
    return out;
}
