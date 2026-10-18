/**
 * The Velvet Room — pure fusion rules (Persona 5 Royal's, with the P3/P4
 * Arcana the chart lacks taken from those games).
 *
 * The Compendium (personaModel.parseCompendiumEntry) gives each Persona a
 * `fusion` record:
 *   { kind: 'normal' | 'special' | 'party' | 'none', parts: [names], unlock, requirement, inherits }
 *
 * Normal fusion (two Personas):
 *   - different Arcana: the chart gives the result Arcana; the result is the
 *     first Persona of that Arcana whose level is at least
 *     (level₁ + level₂) / 2 + 1 (the strongest one when none is that high);
 *   - same Arcana: the strongest Persona of that Arcana at or below that
 *     level, never one of the two parents (none → the fusion fails).
 *   Only Personas fused the normal way can come out; special ones need their
 *   recipe, treasures and party Personas never come out of a fusion.
 * Special fusion: the exact set of Personas of the recipe (2 to 6).
 * Treasure fusion: a treasure demon moves the other Persona up or down inside
 *   its own Arcana by the steps of the treasure's table.
 *
 * The levels used are the Personas' base levels (the Compendium's), as in the
 * games, so training a Persona does not change what it fuses into.
 *
 * The result comes in at its base level plus a bonus from the Confidant of
 * its Arcana, and inherits skills from its parents: how many depends on how
 * many they know together, which ones on the result's inheritance type.
 */
import { ARCANA_CHART, TREASURES, INHERIT } from '../data/fusionData.js';
import { findSkill } from './skillModel.js';
import { nameKey, normalizeArcana, MAX_SKILLS, MAX_LEVEL } from './personaModel.js';

export const MAX_INHERIT = 4;
export const MAX_SPECIAL_PARTS = 6;

const TREASURE_KEYS = new Map(Object.keys(TREASURES).map(n => [nameKey(n), n]));

/** Whether a Persona (name) is one of the treasure demons. */
export function isTreasure(name) {
    return TREASURE_KEYS.has(nameKey(name));
}

/** The result Arcana of two Arcana, or null. */
export function chartArcana(a, b) {
    const A = normalizeArcana(a);
    const B = normalizeArcana(b);
    if (!A || !B) return null;
    if (A === B) return A;
    return ARCANA_CHART[A]?.[B] || null;
}

// ─── Reading the Compendium's fusion lines ─────────────────────────────────

/**
 * The fusion record from an entry's lines:
 *   Fusion: normal fusion of two Personas (Arcana chart)
 *   Fusion: special fusion of Belial + Nebiros
 *   Fusion: cannot be fused (a party member's own Persona)
 *   Fusion: cannot be fused — Recruit from Qliphoth
 *   Inherits: Curse / Unlocked by: … / Requirement: …
 * An entry without a Fusion line fuses the normal way (homebrew Personas).
 */
export function parseFusionLines(lines) {
    const field = (re) => {
        for (const l of lines || []) { const m = String(l).trim().match(re); if (m) return m[1].trim(); }
        return '';
    };
    const raw = field(/^fusion\s*[:=]\s*(.+)$/i);
    let kind = 'normal';
    let parts = [];
    const sp = raw.match(/special\s+fusion\s+of\s+(.+)$/i) || raw.match(/^(?:special\s*[:=]\s*)?(.+\+.+)$/);
    if (sp) {
        parts = sp[1].split(/\s*\+\s*/).map(s => s.replace(/[.;]+$/, '').trim()).filter(Boolean).slice(0, MAX_SPECIAL_PARTS);
        kind = parts.length >= 2 ? 'special' : 'normal';
    } else if (/party|teammate/i.test(raw) && /cannot|can't|no/i.test(raw)) {
        kind = 'party';
    } else if (/cannot|can't|not\s+fus/i.test(raw)) {
        kind = 'none';
    }
    return {
        kind,
        parts,
        inherits: field(/^inherits?\s*[:=]\s*(.+)$/i).toLowerCase(),
        unlock: field(/^unlocked\s+by\s*[:=]\s*(.+)$/i),
        requirement: field(/^requirement\s*[:=]\s*(.+)$/i),
    };
}

/** The Confidant an unlock line asks for: { arcana, rank } or null. */
export function unlockConfidant(unlock) {
    const m = String(unlock || '').match(/(?:confidant|social\s+link)\s*:\s*([a-z][a-z ]*?)\s+rank\s+(\d+)/i);
    return m ? { arcana: normalizeArcana(m[1]), rank: Number(m[2]) } : null;
}

// ─── Finding the result ─────────────────────────────────────────────────────

const fusionOf = (def) => def?.fusion || { kind: 'normal', parts: [] };

/** The Compendium Personas of an Arcana that a normal fusion can make, by level. */
function normalResults(compendium, arcana) {
    return compendium
        .filter(d => d.arcana === arcana && fusionOf(d).kind === 'normal' && !isTreasure(d.name))
        .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

function find(compendium, name) {
    const k = nameKey(name);
    return compendium.find(d => nameKey(d.name) === k) || null;
}

/** The special recipe made of exactly these names, or null. */
export function specialFor(compendium, names) {
    const want = names.map(nameKey).sort().join('|');
    for (const d of compendium) {
        const f = fusionOf(d);
        if (f.kind === 'special' && f.parts.length === names.length && f.parts.map(nameKey).sort().join('|') === want) return d;
    }
    return null;
}

/**
 * The Persona two (or more) Personas fuse into.
 * @param {object[]} parents  owned Personas ({ name, arcana, level })
 * @param {object[]} compendium  parsed Compendium (with `fusion`)
 * @returns {{ def, kind: 'normal'|'special'|'treasure' } | { error }}
 */
export function fusionResult(parents, compendium) {
    const list = (parents || []).filter(Boolean);
    if (list.length < 2) return { error: 'Choose at least two Personas.' };
    const keys = new Set(list.map(p => nameKey(p.name)));
    if (keys.size !== list.length) return { error: 'The same Persona twice cannot be fused.' };

    const special = specialFor(compendium, list.map(p => p.name));
    if (special) return { def: special, kind: 'special' };
    if (list.length > 2) return { error: 'No special fusion uses these Personas.' };

    const [a, b] = list;
    const baseLevel = (p) => find(compendium, p.name)?.level ?? p.level;

    // Treasure demons.
    const ta = isTreasure(a.name);
    const tb = isTreasure(b.name);
    if (ta && tb) return { error: 'Two treasures cannot be fused together.' };
    if (ta || tb) {
        const [treasure, other] = ta ? [a, b] : [b, a];
        const steps = TREASURES[TREASURE_KEYS.get(nameKey(treasure.name))]?.[normalizeArcana(other.arcana)];
        if (!steps) return { error: `${treasure.name} cannot change a ${other.arcana || 'Persona'} Persona.` };
        const row = normalResults(compendium, normalizeArcana(other.arcana));
        let i = row.findIndex(d => nameKey(d.name) === nameKey(other.name));
        if (i === -1) {
            // Not in the row (special or homebrew): placed by level.
            const lvl = baseLevel(other);
            i = row.findIndex(d => d.level >= lvl);
            if (i === -1) i = row.length;
            if (steps > 0) i -= 1;
        }
        const j = i + steps;
        if (j < 0 || j >= row.length) return { error: `No ${other.arcana} Persona is ${Math.abs(steps)} step${Math.abs(steps) === 1 ? '' : 's'} ${steps > 0 ? 'above' : 'below'} ${other.name}.` };
        return { def: row[j], kind: 'treasure' };
    }

    const arcana = chartArcana(a.arcana, b.arcana);
    if (!arcana) return { error: `${a.arcana || '?'} and ${b.arcana || '?'} do not fuse.` };
    const target = (baseLevel(a) + baseLevel(b)) / 2 + 1;
    const row = normalResults(compendium, arcana).filter(d => !keys.has(nameKey(d.name)));
    if (!row.length) return { error: `No ${arcana} Persona can come out of this fusion.` };

    if (normalizeArcana(a.arcana) === normalizeArcana(b.arcana)) {
        const below = row.filter(d => d.level <= target);
        if (!below.length) return { error: `Nothing weaker than ${a.name} and ${b.name} in the ${arcana} Arcana: the fusion fails.` };
        return { def: below[below.length - 1], kind: 'normal' };
    }
    return { def: row.find(d => d.level >= target) || row[row.length - 1], kind: 'normal' };
}

/** Every pair among `owned` and what it gives (for the "what can I make" list). */
export function allFusions(owned, compendium) {
    const out = [];
    for (let i = 0; i < owned.length; i++) {
        for (let j = i + 1; j < owned.length; j++) {
            const r = fusionResult([owned[i], owned[j]], compendium);
            if (r.def) out.push({ parents: [owned[i], owned[j]], ...r });
        }
    }
    return out;
}

/** The special recipes whose ingredients are all in `owned`. */
export function availableSpecials(owned, compendium) {
    const have = new Map(owned.map(p => [nameKey(p.name), p]));
    const out = [];
    for (const d of compendium) {
        const f = fusionOf(d);
        if (f.kind !== 'special') continue;
        const parts = f.parts.map(n => have.get(nameKey(n)));
        if (parts.every(Boolean)) out.push({ def: d, parents: parts, kind: 'special' });
    }
    return out;
}

/** The recipes that make `def` — normal pairs from the Compendium, or its special recipe. */
export function recipesFor(def, compendium, { limit = 12 } = {}) {
    const f = fusionOf(def);
    if (f.kind === 'special') return [{ names: f.parts, kind: 'special' }];
    if (f.kind !== 'normal' || isTreasure(def.name)) return [];
    const pool = compendium.filter(d => fusionOf(d).kind !== 'party' && !isTreasure(d.name));
    const out = [];
    for (let i = 0; i < pool.length && out.length < limit; i++) {
        for (let j = i + 1; j < pool.length && out.length < limit; j++) {
            const r = fusionResult([pool[i], pool[j]], compendium);
            if (r.def && nameKey(r.def.name) === nameKey(def.name) && r.kind === 'normal') out.push({ names: [pool[i].name, pool[j].name], kind: 'normal' });
        }
    }
    return out;
}

// ─── Skills ─────────────────────────────────────────────────────────────────

/** How many skills a result inherits when its parents know `total` together. */
export function inheritSlots(total) {
    const n = Math.max(0, Math.round(total) || 0);
    if (n <= 0) return 0;
    if (n <= 1) return 1;
    if (n <= 4) return 2;
    if (n <= 8) return 3;
    return MAX_INHERIT;
}

/** Whether a Persona of inheritance `type` can inherit `skill`. */
export function canInherit(type, skill) {
    const rec = findSkill(skill);
    const t = String(type || '').toLowerCase();
    if (t === 'none') return false;
    if (!rec) return true;                      // homebrew skills: allowed
    if (rec.e === 'special') return false;      // unique skills stay with their Persona
    if (['passive', 'support', 'almighty'].includes(rec.e)) return true;
    const allowed = INHERIT[t];
    return !allowed || allowed.includes(rec.e);
}

/**
 * The skills the result can inherit, how many, and a default pick.
 * @returns {{ pool: string[], blocked: string[], slots: number, picked: string[] }}
 */
export function inheritance(parents, resultDef) {
    const innate = new Set((resultDef?.skills || []).map(nameKey));
    const type = fusionOf(resultDef).inherits || '';
    const all = [];
    const seen = new Set();
    for (const p of parents) {
        for (const s of p.skills || []) {
            const k = nameKey(s);
            if (seen.has(k) || innate.has(k)) continue;
            seen.add(k);
            all.push(s);
        }
    }
    const pool = all.filter(s => canInherit(type, s));
    const blocked = all.filter(s => !pool.includes(s));
    const room = Math.max(0, MAX_SKILLS - innate.size);
    const slots = Math.min(inheritSlots(all.length), room, pool.length);
    return { pool, blocked, slots, picked: pool.slice(0, slots) };
}

// ─── The finished Persona ──────────────────────────────────────────────────

/** Bonus levels from the Confidant of the result's Arcana (rank 10 → +5). */
export function confidantBonus(rank) {
    const r = Math.max(0, Math.min(10, Math.round(Number(rank) || 0)));
    return Math.floor(r / 2);
}

/**
 * Whether the fusion may go ahead: the user must be at least the result's
 * level, and the Confidant an unlock asks for must be at that rank.
 * @param {object} ctx { userLevel: number|null, confidantRank: (arcana) => number|null }
 * @returns {string[]} reasons it cannot (empty → it can)
 */
export function fusionBlocks(def, ctx = {}) {
    const out = [];
    if (!def) return ['No result.'];
    if (ctx.userLevel != null && def.level > ctx.userLevel) out.push(`${def.name} is level ${def.level}: you are level ${ctx.userLevel}.`);
    const need = unlockConfidant(fusionOf(def).unlock);
    if (need && typeof ctx.confidantRank === 'function') {
        const have = ctx.confidantRank(need.arcana);
        if (have !== null && have < need.rank) out.push(`Needs the ${need.arcana} Confidant at rank ${need.rank} (now ${have}).`);
    }
    return out;
}

/** The level the result comes in at: base + Confidant bonus, never above the user's level. */
export function resultLevel(def, { bonus = 0 } = {}) {
    // The base level plus the Confidant bonus: it may pass its user's level
    // (only fusing needs the user to have reached the base level).
    return Math.min(MAX_LEVEL, (def?.level || 1) + Math.max(0, bonus));
}
