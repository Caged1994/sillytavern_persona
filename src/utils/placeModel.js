/**
 * Map — pure model (no SillyTavern imports, testable in node).
 *
 * The places of a story come from lorebook entries titled "Place:":
 *
 *   Place: Fog & Bean cafe
 *   Short: Fog & Bean                (the label on the map; default: the name)
 *   Icon: ☕
 *   Position: 64, 48                 (percent of the map, left and top; optional)
 *   Connects: Moon Bridge, Riverside Plaza
 *   When: afternoon, evening         (days and times of day it is open; empty = always)
 *   Hours: 10am - 9pm                (shown as text; default: built from When)
 *   Alias: Fog & Bean, the cafe      (other names used by Confidants, activities, the story)
 *   Dungeon: The Empty Stage         (sites entered from here; a mark shows while one is open)
 *   Text: {user} walks over to {place}.
 *   Description: ...
 *
 * and an optional decoration entry:
 *
 *   Map: Hazamachi
 *   Water: river 0,64 30,60 62,68 100,58
 *   Water: lake 66,100 74,80 88,71 100,69 | Kasumi Reservoir @ 86,95
 *
 * Places without a Position are laid out by themselves (a spring layout over
 * the connections). Moving between places costs no time.
 */
import { parseWhen, fits, SLOT_IDS } from './activityModel.js';

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const placeKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const HEADER = /^\s*(?:place|location|spot)\s*[:\-–]\s*(.+?)\s*$/i;
const MAP_HEADER = /^\s*map\s*[:\-–]\s*(.*?)\s*$/i;

/** A clean place (null without a name). */
export function normalizePlace(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = clip(raw.name, 60);
    if (!name) return null;
    const when = raw.when && typeof raw.when === 'object' ? raw.when : parseWhen(raw.when);
    const pos = Array.isArray(raw.pos) ? raw.pos.map(Number) : null;
    const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[,;]/)).map(s => clip(s, 60)).filter(Boolean);
    return {
        id: raw.id || `pl:${placeKey(name).replace(/ /g, '-')}`,
        name,
        short: clip(raw.short, 24) || name,
        icon: clip(raw.icon, 4) || '📍',
        pos: pos && pos.length === 2 && pos.every(Number.isFinite) ? [clamp(pos[0], 3, 97), clamp(pos[1], 5, 95)] : null,
        connects: list(raw.connects),
        when: { days: Array.isArray(when.days) ? when.days : null, slots: Array.isArray(when.slots) ? when.slots : null },
        hours: clip(raw.hours, 40),
        aliases: list(raw.aliases),
        sites: list(raw.sites),
        text: clip(raw.text, 200),
        desc: clip(raw.desc, 200),
        source: raw.source === 'lorebook' ? 'lorebook' : 'default',
    };
}

/** The name of a "Place:" entry, or null. */
export function placeEntryName(entry) {
    const t = String(entry?.comment ?? '').match(HEADER);
    if (t) return t[1];
    const first = String(entry?.content ?? '').split(/\r?\n/).find(l => l.trim()) || '';
    const m = first.match(HEADER);
    return m ? m[1] : null;
}

/** One "Place: …" entry → place (or null). */
export function parsePlaceEntry(entry) {
    const name = placeEntryName(entry);
    if (!name) return null;
    const raw = { name, source: 'lorebook' };
    for (const line of String(entry.content ?? '').split(/\r?\n/)) {
        const m = line.trim().match(/^(short|icon|position|pos|connects?|connections?|when|hours?|alias(?:es)?|dungeon|sites?|text|desc(?:ription)?)\s*[:=]\s*(.+)$/i);
        if (!m) continue;
        const k = m[1].toLowerCase();
        const v = m[2].trim();
        if (k === 'position' || k === 'pos') {
            const n = v.match(/(-?\d+(?:\.\d+)?)\s*[,;x ]\s*(-?\d+(?:\.\d+)?)/);
            if (n) raw.pos = [Number(n[1]), Number(n[2])];
        } else if (k.startsWith('connect')) raw.connects = v;
        else if (k.startsWith('alias')) raw.aliases = v;
        else if (k === 'dungeon' || k.startsWith('site')) raw.sites = v;
        else if (k.startsWith('desc')) raw.desc = v;
        else if (k.startsWith('hour')) raw.hours = v;
        else raw[k] = v;
    }
    return normalizePlace(raw);
}

/** Every place in a list of lorebook entries (the first of a name wins). */
export function parsePlaceBook(entries) {
    const out = [];
    const seen = new Set();
    for (const e of entries || []) {
        if (!e || e.disable) continue;
        const p = parsePlaceEntry(e);
        if (!p || seen.has(placeKey(p.name))) continue;
        seen.add(placeKey(p.name));
        out.push(p);
    }
    return out;
}

/**
 * The decoration of the map from "Map: …" entries:
 * { water: [{ kind: 'river'|'lake', points: [[x, y]…], label, labelAt }] }.
 */
export function parseMapDecor(entries) {
    const water = [];
    for (const e of entries || []) {
        if (!e || e.disable) continue;
        const title = String(e.comment ?? '').match(MAP_HEADER) || (String(e.content ?? '').split(/\r?\n/).find(l => l.trim()) || '').match(MAP_HEADER);
        if (!title) continue;
        for (const line of String(e.content ?? '').split(/\r?\n/)) {
            const m = line.trim().match(/^water\s*[:=]\s*(river|lake|sea)\s+([^|]+?)(?:\s*\|\s*(.+?))?\s*$/i);
            if (!m) continue;
            const points = [...m[2].matchAll(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g)].map(p => [clamp(Number(p[1]), -5, 105), clamp(Number(p[2]), -5, 105)]);
            if (points.length < 2) continue;
            let label = '';
            let labelAt = null;
            if (m[3]) {
                const l = m[3].match(/^(.*?)\s*@\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
                label = clip(l ? l[1] : m[3], 40);
                labelAt = l ? [Number(l[2]), Number(l[3])] : points[Math.floor(points.length / 2)];
            }
            water.push({ kind: m[1].toLowerCase() === 'river' ? 'river' : 'lake', points, label, labelAt });
        }
    }
    return { water };
}

// ─── Matching ───────────────────────────────────────────────────────────────

/** Names a place answers to: its name, short label and aliases (as keys). */
export function placeNames(p) {
    return [...new Set([p.name, p.short, ...(p.aliases || [])].map(placeKey).filter(Boolean))];
}

/** The place a free text ("Fog & Bean cafe", "at the boathouse") points to, by the longest name inside it. */
export function matchPlace(places, text) {
    const t = ` ${placeKey(text)} `;
    if (t.trim() === '') return null;
    let best = null;
    let bestLen = 0;
    for (const p of places || []) {
        for (const n of placeNames(p)) {
            if (n.length > bestLen && (t.includes(` ${n} `) || n === t.trim())) { best = p; bestLen = n.length; }
        }
    }
    return best;
}

// ─── Open hours ─────────────────────────────────────────────────────────────

export function isOpen(place, weekday, slot) {
    return fits(place.when, weekday, slot);
}

/** "afternoon, evening" (or the given hours text). */
export function hoursText(place) {
    if (place.hours) return place.hours;
    const { days, slots } = place.when;
    if (!days && !slots) return 'always open';
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const d = days ? (days.length === 5 && !days.includes(0) && !days.includes(6) ? 'weekdays' : days.length === 2 && days.includes(0) && days.includes(6) ? 'weekends' : days.map(x => names[x]).join(', ')) : '';
    const s = slots && slots.length < SLOT_IDS.length ? slots.join(', ') : '';
    return [d, s].filter(Boolean).join(' · ') || 'always open';
}

// ─── Connections and layout ─────────────────────────────────────────────────

/** Undirected links [idA, idB] from the Connects lines (unknown names are ignored). */
export function edgesOf(places) {
    const seen = new Set();
    const out = [];
    for (const p of places || []) {
        for (const c of p.connects) {
            const q = matchPlace((places || []).filter(x => x.id !== p.id), c);
            if (!q) continue;
            const k = [p.id, q.id].sort().join('|');
            if (seen.has(k)) continue;
            seen.add(k);
            out.push([p.id, q.id]);
        }
    }
    return out;
}

/** Places linked to this one. */
export function neighborsOf(places, id) {
    const ids = new Set();
    for (const [a, b] of edgesOf(places)) {
        if (a === id) ids.add(b);
        else if (b === id) ids.add(a);
    }
    return (places || []).filter(p => ids.has(p.id));
}

/** A small deterministic pseudo-random sequence (so the layout is stable). */
function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Positions in percent for every place: its own Position, else a spring layout
 * (linked places pull together, all push apart). → { [id]: [x, y] }
 */
export function layoutPlaces(places) {
    const list = places || [];
    const pos = {};
    const free = [];
    const rand = rng(list.reduce((n, p) => n * 31 + p.name.length * 7 + p.name.charCodeAt(0), 17));
    list.forEach((p, i) => {
        if (p.pos) pos[p.id] = [...p.pos];
        else {
            const a = (i / Math.max(1, list.length)) * Math.PI * 2;
            pos[p.id] = [50 + Math.cos(a) * 30 + (rand() - 0.5) * 4, 50 + Math.sin(a) * 30 + (rand() - 0.5) * 4];
            free.push(p.id);
        }
    });
    if (!free.length) return pos;
    const edges = edgesOf(list);
    const fixed = new Set(list.filter(p => p.pos).map(p => p.id));
    const k = Math.sqrt((90 * 80) / Math.max(1, list.length));
    for (let it = 0; it < 240; it++) {
        const cool = 1 - it / 240;
        const d = {};
        for (const p of list) d[p.id] = [0, 0];
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const a = list[i].id;
                const b = list[j].id;
                let dx = pos[a][0] - pos[b][0];
                let dy = pos[a][1] - pos[b][1];
                const dist = Math.max(1, Math.hypot(dx, dy));
                const f = (k * k) / dist;
                dx /= dist; dy /= dist;
                d[a][0] += dx * f; d[a][1] += dy * f;
                d[b][0] -= dx * f; d[b][1] -= dy * f;
            }
        }
        for (const [a, b] of edges) {
            let dx = pos[a][0] - pos[b][0];
            let dy = pos[a][1] - pos[b][1];
            const dist = Math.max(1, Math.hypot(dx, dy));
            const f = (dist * dist) / k;
            dx /= dist; dy /= dist;
            d[a][0] -= dx * f; d[a][1] -= dy * f;
            d[b][0] += dx * f; d[b][1] += dy * f;
        }
        for (const id of free) {
            const len = Math.max(1, Math.hypot(d[id][0], d[id][1]));
            const step = Math.min(len, 6 * cool + 0.5);
            pos[id][0] = clamp(pos[id][0] + (d[id][0] / len) * step, 10, 90);
            pos[id][1] = clamp(pos[id][1] + (d[id][1] / len) * step, 9, 91);
        }
    }
    for (const id of free) if (!fixed.has(id)) pos[id] = [Math.round(pos[id][0] * 10) / 10, Math.round(pos[id][1] * 10) / 10];
    return pos;
}

// ─── The line in the chat box and the prompt ────────────────────────────────

/** "*Hayate walks over to Fog & Bean.*" ({user}, {place}). */
export function travelText(place, user = 'I') {
    const t = place.text || '{user} goes to {place}.';
    return `*${t.replace(/\{user\}/g, user).replace(/\{place\}/g, place.name)}*`;
}

/** What the AI is told about the map each turn. */
export function mapPrompt(places, here, { user = 'The player', openNow = null } = {}) {
    if (!places?.length) return '';
    const near = here ? neighborsOf(places, here.id).map(p => p.short) : [];
    const lines = [];
    if (here) lines.push(`${user} is at ${here.name}${near.length ? `; from here they can go to: ${near.join(', ')}` : ''}.`);
    else lines.push(`Places on the map: ${places.slice(0, 14).map(p => p.short).join(', ')}.`);
    if (openNow && openNow.length < places.length) lines.push(`Closed now: ${places.filter(p => !openNow.includes(p.id)).map(p => p.short).join(', ')}.`);
    lines.push('Travel inside the town takes no time. When they go somewhere, narrate arriving there and keep the scene location in step.');
    return `MAP — ${lines.join(' ')}`;
}
