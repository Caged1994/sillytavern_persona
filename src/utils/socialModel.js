/**
 * Social stats — pure model (Persona 5).
 *
 * The player's character has five social stats: Knowledge, Guts,
 * Proficiency, Kindness and Charm. Each one collects points; enough points
 * raise it to the next rank (1–5), and every rank has a title, as in the game.
 * Points only go up. The AI awards a few points when the player's character
 * does something that builds a stat (studying, a brave act, skilled work…).
 *
 * The thresholds are the cumulative points of Persona 5 / Royal as published
 * in fan guides (samurai-gamers.com, "Human parameters"). Some players report
 * slightly different totals; they only decide when a rank changes.
 */

export const SOCIAL_STATS = [
    {
        id: 'knowledge', name: 'Knowledge', color: '#f2c94c',
        ranks: ['Oblivious', 'Learned', 'Scholarly', 'Encyclopedic', 'Erudite'],
        thresholds: [0, 34, 82, 126, 192],
        grows: 'studying, reading, quizzes, learning something new',
    },
    {
        id: 'guts', name: 'Guts', color: '#ff7a59',
        ranks: ['Milquetoast', 'Bold', 'Staunch', 'Dauntless', 'Lionhearted'],
        thresholds: [0, 11, 38, 68, 113],
        grows: 'brave or daring acts, facing fear, scary food or challenges',
    },
    {
        id: 'proficiency', name: 'Proficiency', color: '#6fd3a8',
        ranks: ['Bumbling', 'Decent', 'Skilled', 'Masterful', 'Transcendent'],
        thresholds: [0, 12, 34, 60, 87],
        grows: 'crafting, repairing, cooking, practising a skill or a part-time job',
    },
    {
        id: 'kindness', name: 'Kindness', color: '#ff8fc7',
        ranks: ['Inoffensive', 'Considerate', 'Empathetic', 'Selfless', 'Angelic'],
        thresholds: [0, 14, 47, 94, 136],
        grows: 'helping, caring for someone or something, listening, comforting',
    },
    {
        id: 'charm', name: 'Charm', color: '#7fb4ff',
        ranks: ['Existent', 'Head-Turning', 'Suave', 'Charismatic', 'Debonair'],
        thresholds: [0, 6, 52, 92, 132],
        grows: 'style, confidence, winning people over, a relaxing bath',
    },
];

export const SOCIAL_IDS = SOCIAL_STATS.map(s => s.id);
export const MAX_RANK = 5;
/** The most points one reply can add to one stat. */
export const MAX_SOCIAL_STEP = 5;
/** Points above the last threshold still count (they just change nothing). */
export const MAX_SOCIAL_POINTS = 999;

export function getSocialStat(id) {
    return SOCIAL_STATS.find(s => s.id === id) || null;
}

/** Finds a social stat by id or name (case-insensitive). */
export function findSocialStat(label) {
    const key = String(label || '').trim().toLowerCase();
    if (!key) return null;
    return SOCIAL_STATS.find(s => s.id === key || s.name.toLowerCase() === key) || null;
}

export function clampPoints(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return null;
    return Math.min(MAX_SOCIAL_POINTS, Math.max(0, n));
}

/**
 * Rank details for a stat at a number of points.
 * @returns {{rank: number, title: string, points: number, floor: number, next: number|null, pct: number}}
 *   floor: points where this rank starts; next: points for the next rank
 *   (null at rank 5); pct: progress toward the next rank (100 at rank 5).
 */
export function rankInfo(stat, points) {
    const s = typeof stat === 'string' ? getSocialStat(stat) : stat;
    const p = clampPoints(points) ?? 0;
    let idx = 0;
    for (let i = 0; i < s.thresholds.length; i++) if (p >= s.thresholds[i]) idx = i;
    const floor = s.thresholds[idx];
    const next = idx + 1 < s.thresholds.length ? s.thresholds[idx + 1] : null;
    const pct = next === null ? 100 : Math.round(((p - floor) / (next - floor)) * 100);
    return { rank: idx + 1, title: s.ranks[idx], points: p, floor, next, pct };
}

/** Points to put a stat exactly at the start of a rank. */
export function pointsForRank(stat, rank) {
    const s = typeof stat === 'string' ? getSocialStat(stat) : stat;
    const r = Math.min(MAX_RANK, Math.max(1, Math.round(Number(rank) || 1)));
    return s.thresholds[r - 1];
}

/** A full record with every stat present ({ id: points }). */
export function normalizeSocial(stored) {
    const src = stored && typeof stored === 'object' ? stored : {};
    const out = {};
    for (const s of SOCIAL_STATS) out[s.id] = clampPoints(src[s.id]) ?? 0;
    return out;
}

/** "Knowledge 2 (Learned)" */
export function formatSocial(id, points) {
    const s = getSocialStat(id);
    const r = rankInfo(s, points);
    return `${s.name} ${r.rank} (${r.title})`;
}

function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
        const m = v.replace(/[−–]/g, '-').match(/[-+]?\d+(\.\d+)?/);
        return m ? Number(m[0]) : null;
    }
    return null;
}

/**
 * The AI's "social" value → [{ id, add, reason }], only gains.
 * Accepts {"Knowledge": 2}, {"Guts": "+3"}, {"Charm": {"add": 2, "reason": "…"}}
 * and [{"stat": "Kindness", "add": 1}].
 */
export function normalizeAISocial(raw) {
    let data = raw;
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { return []; }
    }
    if (!data || typeof data !== 'object') return [];
    const out = [];
    const seen = new Set();
    const push = (label, val) => {
        const s = findSocialStat(label);
        if (!s || seen.has(s.id)) return;
        let add = null;
        let reason = '';
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            add = num(val.add ?? val.change ?? val.delta ?? val.points ?? val.value);
            const r = val.reason ?? val.why ?? val.note;
            reason = typeof r === 'string' ? r.trim().slice(0, 100) : '';
        } else {
            add = num(val);
        }
        if (add === null) return;
        const step = Math.min(MAX_SOCIAL_STEP, Math.round(add));
        if (step <= 0) return;
        seen.add(s.id);
        out.push({ id: s.id, add: step, reason });
    };
    if (Array.isArray(data)) {
        for (const e of data) if (e && typeof e === 'object') push(e.stat ?? e.name ?? e.id, e);
    } else {
        for (const [k, v] of Object.entries(data)) push(k, v);
    }
    return out;
}

/**
 * The prompt section.
 * @param {string} player
 * @param {object} points - { id: points }
 */
export function buildSocialPrompt({ player, points, compact = true, standalone = false } = {}) {
    if (!player) return '';
    const p = normalizeSocial(points);
    const where = standalone ? 'start your reply with ONE JSON code block with' : 'add to the same tracker JSON object';
    const list = SOCIAL_STATS.map(s => formatSocial(s.id, p[s.id])).join(', ');
    let out = compact
        ? `SOCIAL STATS of ${player} (rank 1-5): ${list}.\n`
        : `SOCIAL STATS — ${player}'s personal qualities, as in Persona 5 (rank 1 to 5, each with a title): ${list}.\n`;
    out += compact
        ? `Let the ranks shape what ${player} can pull off socially and how people react. When ${player} spends time on something that builds one, ${where} "social": {"Knowledge": 2} (1-${MAX_SOCIAL_STEP} points per stat; they never go down). Most replies add nothing: leave the key out.\n`
        : `Let these ranks shape what ${player} can manage in social situations (a low Guts may not dare something, a high Charm wins people over) and how others react. When ${player} spends real time on something that builds a stat, ${where} "social": {"Knowledge": 2} — 1 to ${MAX_SOCIAL_STEP} points per stat (a short activity 1-2, a demanding one 3-${MAX_SOCIAL_STEP}). Points never go down. Most replies add nothing; then leave the key out.\n`;
    out += 'What builds them: ' + SOCIAL_STATS.map(s => `${s.name} — ${s.grows}`).join('; ') + '.';
    return out.trim();
}
