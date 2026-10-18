/**
 * Free time — pure model (no SillyTavern imports, testable in node).
 *
 * Every time of day can be spent on an activity: it takes that time of day
 * and gives what it says (social stat points, money, HP/SP back), or on a
 * Confidant (bond points; more with a Persona of the same Arcana in the
 * stock). A card can list its own activities in lorebook entries:
 *
 *   Activity: Study at the library
 *   Where: School library
 *   When: weekdays afternoon, evening        (days and times of day; empty = always)
 *   Weather: rain                              (optional: only then)
 *   Effect: Knowledge +2, Money +300, SP +30%
 *   Rain: Knowledge +1                         (optional: extra when it rains)
 *   Text: {user} spends the {slot} studying at the library.
 *
 * Without any, a generic set fits any setting. Rest is always there.
 */
import { SOCIAL_STATS } from './socialModel.js';

export const SLOT_IDS = ['morning', 'afternoon', 'evening', 'night'];
export const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// Bond points for spending a time of day with a Confidant, and the extra for
// a Persona of their Arcana in the stock ("you feel a stronger bond…").
export const HANGOUT_POINTS = 3;
export const ARCANA_BONUS = 3;

const SOCIAL_ALIASES = {
    knowledge: 'knowledge', academics: 'knowledge', smarts: 'knowledge',
    guts: 'guts', courage: 'guts',
    proficiency: 'proficiency', diligence: 'proficiency', dexterity: 'proficiency',
    kindness: 'kindness', understanding: 'kindness',
    charm: 'charm', expression: 'charm',
};

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const key = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** "weekdays afternoon, evening" → { days: [0-6] | null, slots: [ids] | null }. */
export function parseWhen(text) {
    const t = String(text || '').toLowerCase();
    if (!t.trim() || /\b(any ?time|always|daily|every ?day)\b/.test(t) && !/\b(morning|afternoon|evening|night)\b/.test(t)) return { days: null, slots: null };
    const days = new Set();
    if (/\bweekdays?\b/.test(t)) [1, 2, 3, 4, 5].forEach(d => days.add(d));
    if (/\bweekends?\b/.test(t)) [0, 6].forEach(d => days.add(d));
    DAY_NAMES.forEach((d, i) => { if (new RegExp(`\\b${d.slice(0, 3)}(${d.slice(3)})?s?\\b`).test(t)) days.add(i); });
    const slots = new Set();
    if (/\bmorning\b/.test(t)) slots.add('morning');
    if (/\b(afternoon|after school|day ?time)\b/.test(t)) slots.add('afternoon');
    if (/\bevening\b/.test(t)) slots.add('evening');
    if (/\b(night|late night)\b/.test(t)) slots.add('night');
    return { days: days.size ? [...days].sort() : null, slots: slots.size ? SLOT_IDS.filter(s => slots.has(s)) : null };
}

/** "Knowledge +2, Money +300, SP +30%" → { social: {id: n}, money, hp, sp }. */
export function parseEffects(text) {
    const out = { social: {}, money: 0, hp: 0, sp: 0 };
    for (const part of String(text || '').split(/[,;]| and /i)) {
        const m = part.trim().match(/^([A-Za-z ]+?)\s*([+-]?\d+)\s*(%)?$/);
        if (!m) continue;
        const name = m[1].trim().toLowerCase();
        const n = Number(m[2]);
        if (SOCIAL_ALIASES[name]) out.social[SOCIAL_ALIASES[name]] = (out.social[SOCIAL_ALIASES[name]] || 0) + n;
        else if (/^(money|yen|gold|cash|coins?)$/.test(name)) out.money += n;
        else if (/^(hp|health)$/.test(name)) out.hp += n;
        else if (/^(sp|mana|energy)$/.test(name)) out.sp += n;
    }
    return out;
}

export function isRainy(weather) {
    return /rain|storm|drizzle|shower|thunder|pioggia|temporale|☔|🌧|⛈/i.test(String(weather || ''));
}

/** A clean activity (null without a name). */
export function normalizeActivity(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = clip(raw.name, 60);
    if (!name) return null;
    const when = raw.when && typeof raw.when === 'object' ? raw.when : parseWhen(raw.when);
    const fx = (v) => (v && typeof v === 'object' && v.social ? v : parseEffects(v));
    return {
        id: raw.id || `act:${key(name)}`,
        name,
        icon: clip(raw.icon, 4) || '✨',
        where: clip(raw.where, 60),
        when: { days: Array.isArray(when.days) ? when.days : null, slots: Array.isArray(when.slots) ? when.slots : null },
        weather: raw.weather === 'rain' || raw.weather === 'clear' ? raw.weather : null,
        effects: fx(raw.effects),
        rain: fx(raw.rain),
        text: clip(raw.text, 200),
        source: raw.source === 'lorebook' ? 'lorebook' : 'default',
        rest: !!raw.rest,
        // A job pays with the level when it names no amount.
        job: !!raw.job || /\b(job|shift|work)\b/i.test(name) && !/work ?out/i.test(name),
    };
}

const DEF = (o) => normalizeActivity({ ...o, source: 'default' });

/** The generic set (setting-agnostic). */
export const DEFAULT_ACTIVITIES = [
    DEF({ name: 'Study', icon: '📚', effects: 'Knowledge +2', rain: 'Knowledge +1', text: '{user} spends the {slot} studying.' }),
    DEF({ name: 'Read a book', icon: '📖', effects: 'Knowledge +1, Kindness +1', rain: 'Knowledge +1', text: '{user} spends the {slot} reading a book.' }),
    DEF({ name: 'Part-time job', icon: '💼', when: 'afternoon, evening', effects: 'Proficiency +1', text: '{user} works a part-time shift this {slot}.', job: true }),
    DEF({ name: 'Work out', icon: '🏋️', when: 'morning, afternoon, evening', effects: 'Guts +2', text: '{user} spends the {slot} working out.' }),
    DEF({ name: 'Help out', icon: '🤝', when: 'morning, afternoon', effects: 'Kindness +2', text: '{user} spends the {slot} lending a hand to someone who needs it.' }),
    DEF({ name: 'Go out', icon: '🌆', when: 'afternoon, evening', effects: 'Charm +2', text: '{user} goes out and spends the {slot} around town.' }),
    DEF({ name: 'Hobby', icon: '🛠️', effects: 'Proficiency +2', rain: 'Proficiency +1', text: '{user} spends the {slot} on a hobby, making something by hand.' }),
    DEF({ name: 'Rest', icon: '🛏️', effects: 'HP +40%, SP +40%', text: '{user} takes the {slot} off to rest.', rest: true }),
];

const HEADER = /^\s*activity\s*[:\-–]\s*(.+?)\s*$/i;

/** One "Activity: …" lorebook entry → activity (or null). */
export function parseActivityEntry(entry) {
    const title = String(entry?.comment ?? '').match(HEADER) || String(entry?.content ?? '').split(/\r?\n/)[0].match(HEADER);
    if (!title) return null;
    const raw = { name: title[1], source: 'lorebook' };
    for (const line of String(entry.content ?? '').split(/\r?\n/)) {
        const m = line.trim().match(/^(where|when|weather|effects?|rain|text|icon)\s*[:=]\s*(.+)$/i);
        if (!m) continue;
        const k = m[1].toLowerCase();
        if (k === 'weather') raw.weather = isRainy(m[2]) ? 'rain' : /clear|sun|fine/i.test(m[2]) ? 'clear' : null;
        else raw[k.startsWith('effect') ? 'effects' : k] = m[2];
    }
    return normalizeActivity(raw);
}

export function parseActivityBook(entries) {
    const out = [];
    const seen = new Set();
    for (const e of entries || []) {
        if (!e || e.disable) continue;
        const a = parseActivityEntry(e);
        if (a && !seen.has(a.id)) { seen.add(a.id); out.push(a); }
    }
    return out;
}

/** The card's activities if it has any (plus Rest), else the generic set. */
export function activityList(fromBook = []) {
    if (!fromBook.length) return DEFAULT_ACTIVITIES;
    const rest = DEFAULT_ACTIVITIES.find(a => a.rest);
    return fromBook.some(a => a.rest || /^rest\b/i.test(a.name)) ? fromBook : [...fromBook, rest];
}

/** Whether `when` allows this weekday (0 = Sunday) and time of day. */
export function fits(when, weekday, slot) {
    if (when?.days && !when.days.includes(weekday)) return false;
    if (when?.slots && !when.slots.includes(slot)) return false;
    return true;
}

/** The activities open at this moment ({ weekday, slot, weather, tired }). */
export function availableActivities(list, { weekday, slot, weather = '', tired = false }) {
    const rain = isRainy(weather);
    return list.filter(a => {
        if (tired && !a.rest) return false;
        if (a.weather === 'rain' && !rain) return false;
        if (a.weather === 'clear' && rain) return false;
        return fits(a.when, weekday, slot);
    });
}

/** What an activity gives now: its effects plus the rain bonus. Money for a job grows with the level. */
export function effectsNow(activity, { weather = '', level = 1 } = {}) {
    const e = { social: { ...activity.effects.social }, money: activity.effects.money, hp: activity.effects.hp, sp: activity.effects.sp };
    if (isRainy(weather)) {
        for (const [k, v] of Object.entries(activity.rain?.social || {})) e.social[k] = (e.social[k] || 0) + v;
        e.money += activity.rain?.money || 0;
        e.hp += activity.rain?.hp || 0;
        e.sp += activity.rain?.sp || 0;
    }
    if (activity.job && !e.money) e.money = 30 * Math.max(1, level);
    return e;
}

/** "Knowledge +2, money +300, SP +40%" for the panel and the prompt. */
export function describeEffects(e) {
    const parts = [];
    for (const [id, n] of Object.entries(e.social || {})) {
        const s = SOCIAL_STATS.find(x => x.id === id);
        if (n) parts.push(`${s ? s.name : id} ${n > 0 ? '+' : ''}${n}`);
    }
    if (e.money) parts.push(`money ${e.money > 0 ? '+' : ''}${e.money}`);
    if (e.hp) parts.push(`HP +${e.hp}%`);
    if (e.sp) parts.push(`SP +${e.sp}%`);
    return parts.join(', ');
}

/** The sentence put in the chat box: {user}, {slot}, {where}, {who}. */
export function activityText(template, { user = 'I', slot = 'afternoon', where = '', who = '' } = {}) {
    const t = template || (who ? '{user} spends the {slot} with {who}.' : '{user} spends the {slot} on something of their own.');
    return `*${t.replace(/\{user\}/g, user).replace(/\{slot\}/g, slot).replace(/\{where\}/g, where || 'there').replace(/\{who\}/g, who)}*`;
}

/** Bond points for a hangout: the base, plus the Arcana bonus. */
export function hangoutPoints(arcanaMatch) {
    return HANGOUT_POINTS + (arcanaMatch ? ARCANA_BONUS : 0);
}
