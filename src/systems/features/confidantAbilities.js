/**
 * Confidant abilities — what a teammate's bond gives in a fight (rules in
 * bondModel.js, effects in combatModel.js) and their Persona's Awakening.
 *
 * Only Confidants who fight with you (party members) get them, whether the
 * bond comes from the lorebook or from the story; a lorebook Confidant can
 * set the ranks with its unlock lines. With Confidants off, nobody has them
 * and Baton Pass is free for everyone, as before.
 */
import { getBond, isConfidantsEnabled } from './characterConfidants.js';
import { isPartyMember } from './characterProgress.js';
import { getActivePersona, replacePersona, isPersonasEnabled, personaLevelCap } from './characterPersonas.js';
import { findInCompendium } from './personaCompendium.js';
import * as B from '../../utils/bondModel.js';
import * as P from '../../utils/personaModel.js';

function teammate(name) {
    try { return isPartyMember(name); } catch (e) { return false; }
}

/** For the Confidants tab: { teammate, list: [{ id, name, icon, desc, rank, unlocked }] }. */
export function getBondAbilities(name) {
    const b = getBond(name);
    const mate = teammate(name);
    return { teammate: mate, list: b ? B.bondAbilities(b.rank, b.def, { teammate: mate }) : [] };
}

/** The bond a fighter brings into combat ({ rank, abilities, ranks }) or null. */
export function combatBond(name, isUser) {
    if (isUser || !isConfidantsEnabled() || !teammate(name)) return null;
    const b = getBond(name);
    if (!b) return { rank: 0, abilities: [], ranks: {} };
    return { rank: b.rank, abilities: B.unlockedIds(b.rank, b.def), ranks: B.abilityRanks(b.def) };
}

/** Whether Baton Pass needs the bond (Confidants on). */
export function batonNeedsBond() {
    return isConfidantsEnabled();
}

/** Whether the Awakening can be used now, and what it would do. */
export function awakeningInfo(name) {
    const b = getBond(name);
    if (!b || !isPersonasEnabled()) return { can: false };
    const ab = B.bondAbilities(b.rank, b.def, { teammate: teammate(name) }).find(a => a.id === 'awaken');
    const persona = getActivePersona(name, false);
    const target = B.evolutionTarget(b.def);
    const into = target ? findInCompendium(target) : null;
    if (!ab) return { can: false };
    if (!ab.unlocked) return { can: false, reason: `Unlocks at rank ${ab.rank}.`, rank: ab.rank };
    if (!persona) return { can: false, reason: `${name} has no Persona.` };
    if (persona.awakened) return { can: false, done: true, reason: `${persona.name} has awakened.` };
    return { can: true, persona, into: into ? into.name : (target || ''), known: !!into };
}

/**
 * Awakens the teammate's Persona: into the Persona the lorebook names (from the
 * Compendium, at least at the old level, keeping the old skills where they
 * fit, never above the teammate's level) or, without one, the same Persona without weaknesses and stronger.
 */
export function awakenPersona(name) {
    const info = awakeningInfo(name);
    if (!info.can) return { error: info.reason || 'No Awakening.' };
    const old = info.persona;
    let next;
    if (info.known) {
        next = P.personaFromCompendium(findInCompendium(info.into), { level: old.level });
        // Never above its user's level.
        const cap = personaLevelCap(name, false);
        if (cap !== null && next.level > cap) next = P.setPersonaLevel(next, Math.max(old.level, cap)).persona;
        for (const s of old.skills) {
            if (next.skills.length >= P.MAX_SKILLS) break;
            if (!next.skills.some(x => P.nameKey(x) === P.nameKey(s))) next.skills.push(s);
        }
        next.awakened = true;
    } else {
        next = B.awakenInPlace(old);
        if (info.into) next.name = info.into;
    }
    return replacePersona(name, false, old.id, next);
}
