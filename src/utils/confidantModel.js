/**
 * Confidants (Social Links) — pure model.
 *
 * A Confidant is one person bound to one Arcana; the bond has a rank from 1
 * to 10. Time spent together earns points; enough points raise the rank
 * (each rank costs a little more than the last). A rank can require a
 * social stat or a level, and can unlock something (a skill, a follow-up
 * attack, an evolution…) that the story and the AI take into account. Rank
 * 10 is "maxed". Only one person per Arcana.
 *
 * Who can become one depends on the card (see characterConfidants.js):
 *   - defined: only those described in the lorebook (and added by hand);
 *   - mixed:   the lorebook ones keep their Arcana, the story fills the rest;
 *   - sandbox: all come from the story (and by hand).
 *
 * Lorebook entry format (title or first line "Confidant: Name"):
 *   Confidant: Ryuji Sakamoto
 *   Arcana: Chariot
 *   Rank 2 requires: Guts 2
 *   Rank 5 requires: Level 20
 *   Rank 4 unlocks: Follow-up attack
 *   Rank 10 unlocks: Captain Kidd evolves into Seiten Taisei
 *   Description: Loud, loyal, former track star.
 */
import { ARCANA, normalizeArcana, nameKey } from './personaModel.js';
import { SOCIAL_STATS, findSocialStat } from './socialModel.js';

export { ARCANA };
export const MAX_RANK = 10;
/** The most points one reply can give one Confidant. */
export const MAX_CONFIDANT_STEP = 5;
export const MODES = ['auto', 'defined', 'mixed', 'sandbox'];
export const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];

/** The tarot number shown on a card (Fool 0 … World 21; the extra Arcana have none). */
export function arcanaNumber(arcana) {
    const order = ['Fool', 'Magician', 'Priestess', 'Empress', 'Emperor', 'Hierophant', 'Lovers', 'Chariot', 'Justice',
        'Hermit', 'Fortune', 'Strength', 'Hanged Man', 'Death', 'Temperance', 'Devil', 'Tower', 'Star', 'Moon', 'Sun',
        'Judgement', 'World'];
    const i = order.indexOf(normalizeArcana(arcana));
    if (i === 21) return 'XXI';
    return i >= 0 ? ROMAN[i] : '';
}

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const clampInt = (v, lo, hi) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};

/** Points needed to go from `rank` to the next one (7 for 1→2 … 23 for 9→10). */
export function rankCost(rank) {
    return 5 + 2 * Math.max(1, Math.min(MAX_RANK - 1, rank));
}

/** A clean Confidant record. */
export function normalizeConfidant(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const arcana = normalizeArcana(raw.arcana);
    if (!arcana) return null;
    return {
        arcana,
        rank: clampInt(raw.rank, 0, MAX_RANK) ?? 1,
        points: Math.max(0, clampInt(raw.points, 0, 999) ?? 0),
        source: ['lorebook', 'ai', 'user'].includes(raw.source) ? raw.source : 'user',
        since: typeof raw.since === 'number' ? raw.since : Date.now(),
        note: clip(raw.note, 120),
    };
}

/** Progress inside the current rank: { rank, points, cost, pct, maxed }. */
export function rankProgress(rec) {
    const rank = rec?.rank || 0;
    if (rank >= MAX_RANK) return { rank, points: 0, cost: 0, pct: 100, maxed: true };
    const cost = rankCost(rank);
    const points = Math.min(rec?.points || 0, cost);
    return { rank, points, cost, pct: Math.round((points / cost) * 100), maxed: false };
}

// ─── Requirements and unlocks ───────────────────────────────────────────────

/**
 * Whether the next rank can be reached: { ok, reason }.
 * `requires` is [{ rank, social?: id, socialRank?: n, level?: n }]; `social`
 * maps social stat ids to their rank; `level` is the player's level.
 */
export function canRankUp(rec, def, { social = {}, level = null } = {}) {
    const next = (rec?.rank || 0) + 1;
    for (const r of def?.requires || []) {
        if (r.rank !== next) continue;
        if (r.social && (social[r.social] || 1) < r.socialRank) {
            const s = SOCIAL_STATS.find(x => x.id === r.social);
            return { ok: false, reason: `${s ? s.name : r.social} ${r.socialRank} needed` };
        }
        if (r.level && level !== null && level < r.level) return { ok: false, reason: `level ${r.level} needed` };
    }
    return { ok: true, reason: '' };
}

/**
 * Adds points and raises the rank as far as they and the requirements allow.
 * Returns { rec, ranksGained, blocked } (blocked: why it stopped short, or '').
 */
export function addPoints(rec, add, def = null, ctx = {}) {
    const out = { ...rec, points: (rec.points || 0) + Math.max(0, add) };
    let gained = 0;
    let blocked = '';
    while (out.rank < MAX_RANK && out.points >= rankCost(out.rank)) {
        const check = canRankUp(out, def, ctx);
        if (!check.ok) { blocked = check.reason; out.points = rankCost(out.rank); break; }
        out.points -= rankCost(out.rank);
        out.rank++;
        gained++;
    }
    if (out.rank >= MAX_RANK) out.points = 0;
    return { rec: out, ranksGained: gained, blocked };
}

// ─── Lorebook entries ───────────────────────────────────────────────────────

const HEADER = /^\s*confidant\s*[:\-–]\s*(.+?)\s*$/i;

export function confidantName(entry) {
    let m = String(entry?.comment ?? '').match(HEADER);
    if (m) return clip(m[1], 60);
    const first = String(entry?.content ?? '').split(/\r?\n/).find(l => l.trim());
    m = first ? first.match(HEADER) : null;
    return m ? clip(m[1], 60) : null;
}

/** A Confidant definition from a lorebook entry, or null. */
export function parseConfidantEntry(entry) {
    const name = confidantName(entry);
    if (!name) return null;
    const lines = String(entry?.content ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let arcana = '';
    let desc = '';
    const requires = [];
    const unlocks = [];
    for (const l of lines) {
        let m;
        if ((m = l.match(/^arcana\s*[:=]\s*(.+)$/i))) arcana = normalizeArcana(m[1]);
        else if ((m = l.match(/^(?:description|desc)\s*[:=]\s*(.+)$/i))) desc = clip(m[1], 300);
        else if ((m = l.match(/^rank\s*(\d+)\s*requires?\s*[:=]\s*(.+)$/i))) {
            const rank = clampInt(m[1], 2, MAX_RANK);
            for (const part of m[2].split(/[,;]| and /i)) {
                const lv = part.match(/level\s*(\d+)/i);
                const st = part.match(/([A-Za-z]+)\s*(\d+)/);
                if (lv) requires.push({ rank, level: Number(lv[1]) });
                else if (st && findSocialStat(st[1])) requires.push({ rank, social: findSocialStat(st[1]).id, socialRank: Number(st[2]) });
            }
        } else if ((m = l.match(/^rank\s*(\d+)\s*unlocks?\s*[:=]\s*(.+)$/i))) {
            unlocks.push({ rank: clampInt(m[1], 1, MAX_RANK), text: clip(m[2], 120) });
        }
    }
    if (!arcana) return null;
    return { name, arcana, desc, requires, unlocks: unlocks.sort((a, b) => a.rank - b.rank) };
}

export function parseConfidantBook(entries) {
    const out = [];
    const names = new Set();
    const arcana = new Set();
    for (const e of entries || []) {
        if (!e || e.disable) continue;
        const d = parseConfidantEntry(e);
        if (!d || names.has(nameKey(d.name)) || arcana.has(d.arcana)) continue;
        names.add(nameKey(d.name));
        arcana.add(d.arcana);
        out.push(d);
    }
    return out;
}

// ─── The AI's "confidants" key ──────────────────────────────────────────────

/**
 * → [{ name, add?, start?: arcana, reason }].
 * Accepts {"Ryuji": 3}, {"Ryuji": {"points": 3, "reason": "…"}},
 * {"Ann": {"start": "Lovers", "reason": "…"}} and [{"name": …}].
 */
export function normalizeAIConfidants(raw) {
    let data = raw;
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { return []; }
    }
    if (!data || typeof data !== 'object') return [];
    const out = [];
    const num = (v) => {
        const n = Number(typeof v === 'string' ? v.replace(/[^\d.-]/g, '') : v);
        return Number.isFinite(n) ? n : null;
    };
    const push = (name, v) => {
        if (typeof name !== 'string' || !name.trim()) return;
        const entry = { name: name.trim().slice(0, 60), reason: '' };
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            const start = v.start ?? v.arcana ?? v.form ?? v.begin;
            if (typeof start === 'string' && normalizeArcana(start)) entry.start = normalizeArcana(start);
            const add = num(v.points ?? v.add ?? v.progress ?? v.change);
            if (add !== null && add > 0) entry.add = Math.min(MAX_CONFIDANT_STEP, Math.round(add));
            const r = v.reason ?? v.why ?? v.note;
            if (typeof r === 'string') entry.reason = r.trim().slice(0, 120);
        } else {
            const add = num(v);
            if (add !== null && add > 0) entry.add = Math.min(MAX_CONFIDANT_STEP, Math.round(add));
        }
        if (entry.start || entry.add) out.push(entry);
    };
    if (Array.isArray(data)) {
        for (const e of data) if (e && typeof e === 'object') push(e.name ?? e.character, e);
    } else {
        for (const [k, v] of Object.entries(data)) push(k, v);
    }
    return out;
}

/**
 * The prompt section.
 * @param {object} o
 * @param {string} o.player
 * @param {Array<{name, arcana, rank, unlocked: string[]}>} o.bonds - formed Confidants
 * @param {Array<{name, arcana}>} o.unmet - lorebook Confidants not formed yet
 * @param {string[]} o.free - Arcana the story may still give (mixed / sandbox)
 * @param {string} o.mode - defined | mixed | sandbox
 * @param {number} o.minAffinity - affinity needed before a new bond can form
 */
export function buildConfidantPrompt({ player, bonds = [], unmet = [], free = [], mode = 'sandbox', minAffinity = 20, compact = true, standalone = false } = {}) {
    if (!player) return '';
    const where = standalone ? 'start your reply with ONE JSON code block with' : 'add to the same tracker JSON object';
    let out = compact ? `CONFIDANTS of ${player} (rank 1-10):` : `CONFIDANTS — the bonds ${player} has formed, as in Persona (each person is one Arcana, rank 1 to 10):`;
    out += bonds.length
        ? ' ' + bonds.map(b => `${b.name} (${b.arcana} ${b.rank}${b.unlocked?.length ? `; ${b.unlocked.join(', ')}` : ''})`).join(', ') + '.\n'
        : ' none yet.\n';
    out += compact
        ? `When ${player} spends real time with one of them, ${where} "confidants": {"Name": 3} (1-${MAX_CONFIDANT_STEP} points: a chat 1-2, a meaningful hangout or a gift they love 3-${MAX_CONFIDANT_STEP}). Let the rank shape how close they are. `
        : `When ${player} spends real time with one of them (talking, helping, going out), ${where} "confidants": {"Name": 3} — 1 to ${MAX_CONFIDANT_STEP} points (a short chat 1-2; a meaningful hangout, the right words or a gift they love 3-${MAX_CONFIDANT_STEP}). Let the rank shape how open and close they are. `;
    const startEx = '"confidants": {"Name": {"start": "Arcana", "reason": "…"}}';
    if (unmet.length) {
        out += `Not met yet as Confidants: ${unmet.map(u => `${u.name} (${u.arcana})`).join(', ')} — when the story seals a bond with one, ${startEx} with their Arcana. `;
    }
    if (mode !== 'defined' && free.length) {
        out += `${unmet.length ? 'Also, w' : 'W'}hen the story truly seals a new bond with someone who already likes ${player} (affinity ${minAffinity >= 0 ? '+' : ''}${minAffinity} or more) — a promise, a pact, a turning point — ${startEx} with a free Arcana that fits them: ${free.join(', ')}. Rare: never for strangers or passing characters. `;
    }
    out += 'Most replies change nothing: leave the key out.';
    return out.trim();
}
