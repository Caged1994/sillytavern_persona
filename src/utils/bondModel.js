/**
 * Confidant abilities of a teammate (Persona 5) — pure rules.
 *
 * A Confidant who fights with you (a party member) unlocks these as the
 * bond grows; the default ranks are below. A lorebook Confidant can move
 * any of them with its own line ("Rank 3 unlocks: Follow Up"): an unlock
 * whose text names an ability sets that ability's rank.
 *
 *   baton     Baton Pass      can receive and pass a 1 More
 *   followup  Follow Up       may strike after your attack when it did not knock the enemy down
 *   endure    Endure          survives a fatal blow with 1 HP, once a fight
 *   harisen   Harisen Recovery may cure your ailment at the start of your turn
 *   protect   Protect         takes a fatal blow meant for you, once a fight
 *   awaken    Awakening       their Persona evolves (once, from the Confidants tab)
 */
export const BOND_ABILITIES = [
    { id: 'baton', name: 'Baton Pass', rank: 2, icon: '🤝', desc: 'Can take and pass on a 1 More (+50% damage per pass).', re: /baton/i },
    { id: 'followup', name: 'Follow Up', rank: 4, icon: '⚔️', desc: 'May strike right after your attack when it did not knock the enemy down.', re: /follow[\s-]*up/i },
    { id: 'endure', name: 'Endure', rank: 6, icon: '🛡️', desc: 'Survives a fatal blow with 1 HP, once per fight.', re: /\bendure/i },
    { id: 'harisen', name: 'Harisen Recovery', rank: 7, icon: '💫', desc: 'May cure your ailment at the start of your turn.', re: /harisen|cures?\s+(?:your|my|the\s+leader'?s?)?\s*ailments?/i },
    { id: 'protect', name: 'Protect', rank: 8, icon: '🫂', desc: 'Takes a fatal blow meant for you, once per fight.', re: /\bprotects?\b/i },
    { id: 'awaken', name: 'Awakening', rank: 10, icon: '🌟', desc: 'Their Persona evolves: the lorebook can name what into, otherwise it loses its weaknesses and grows stronger.', re: /awaken|evolv|ultimate\s+persona|second\s+awakening/i },
];
export const BOND_IDS = BOND_ABILITIES.map(a => a.id);
const BY_ID = Object.fromEntries(BOND_ABILITIES.map(a => [a.id, a]));

/** The rank each ability unlocks at for this Confidant (lorebook lines first). */
export function abilityRanks(def = null) {
    const out = {};
    for (const a of BOND_ABILITIES) out[a.id] = a.rank;
    for (const u of def?.unlocks || []) {
        for (const a of BOND_ABILITIES) if (a.re.test(u.text || '')) out[a.id] = Math.max(1, Math.min(10, Math.round(u.rank) || a.rank));
    }
    return out;
}

/**
 * The abilities of a Confidant at `rank`: [{ id, name, icon, desc, rank, unlocked }].
 * Only teammates get them (`teammate` false → []).
 */
export function bondAbilities(rank, def = null, { teammate = true } = {}) {
    if (!teammate) return [];
    const ranks = abilityRanks(def);
    return BOND_ABILITIES
        .map(a => ({ id: a.id, name: a.name, icon: a.icon, desc: a.desc, rank: ranks[a.id], unlocked: (rank || 0) >= ranks[a.id] }))
        .sort((a, b) => a.rank - b.rank || BOND_IDS.indexOf(a.id) - BOND_IDS.indexOf(b.id));
}

export function unlockedIds(rank, def = null, opts = {}) {
    return bondAbilities(rank, def, opts).filter(a => a.unlocked).map(a => a.id);
}

export function abilityName(id) {
    return BY_ID[id]?.name || id;
}

/** Chance of a Follow Up: 30% when unlocked, +5% a rank above it, at most 50%. */
export function followUpChance(rank, unlockRank = BY_ID.followup.rank) {
    return Math.min(0.5, 0.3 + 0.05 * Math.max(0, (rank || 0) - unlockRank));
}

/** Chance of a Harisen Recovery: 35%, +5% a rank above it, at most 50%. */
export function harisenChance(rank, unlockRank = BY_ID.harisen.rank) {
    return Math.min(0.5, 0.35 + 0.05 * Math.max(0, (rank || 0) - unlockRank));
}

/** "evolves into Seiten Taisei" → "Seiten Taisei" (from the Awakening's unlock text), or ''. */
export function evolutionTarget(def = null) {
    for (const u of def?.unlocks || []) {
        if (!BY_ID.awaken.re.test(u.text || '')) continue;
        const m = String(u.text).match(/\b(?:into|becomes?|→|->)\s+(.+?)\s*[.!]?$/i);
        if (m) return m[1].trim();
    }
    return '';
}

/** Awakening without a named evolution: weaknesses go, every stat +2 (max 99). */
export function awakenInPlace(persona) {
    const p = JSON.parse(JSON.stringify(persona));
    for (const el of Object.keys(p.affinities || {})) if (p.affinities[el] === 'wk') p.affinities[el] = '';
    for (const id of Object.keys(p.stats || {})) p.stats[id] = Math.min(99, (p.stats[id] || 1) + 2);
    p.awakened = true;
    return p;
}
