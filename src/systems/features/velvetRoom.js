/**
 * The Velvet Room — fusing a Wild Card's Personas (rules in fusionModel.js).
 *
 * Works on the stock kept by characterPersonas.js and the Compendium read by
 * personaCompendium.js. Only a Wild Card can fuse; the result must be in the
 * Compendium (that is where the fusion table and the result's numbers come
 * from). The user's level and the Confidants (when those features are on)
 * limit what can be made and add bonus levels, as in the games.
 */
import { getXpSettings } from './characterProgress.js';
import { levelWithXp } from '../../utils/xpModel.js';
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { isRpgModeActive } from './rpgMode.js';
import { getCompendium } from './personaCompendium.js';
import { getPersonaRecord, personaLevelCap, replaceWithFusion, isPersonasEnabled } from './characterPersonas.js';
import { getBonds, isConfidantsEnabled } from './characterConfidants.js';
import * as F from '../../utils/fusionModel.js';
import * as P from '../../utils/personaModel.js';

export function isVelvetEnabled() {
    return isRpgModeActive() && isPersonasEnabled() && extensionSettings.velvetRoomEnabled !== false;
}

export function setVelvetEnabled(on) {
    extensionSettings.velvetRoomEnabled = !!on;
    saveSettings();
}

/** The rank of the Confidant of an Arcana, or null when Confidants are off. */
function confidantRank(arcana) {
    if (!isConfidantsEnabled()) return null;
    const a = P.normalizeArcana(arcana);
    let best = 0;
    for (const b of getBonds()) if (P.normalizeArcana(b.arcana) === a) best = Math.max(best, b.rank);
    return best;
}

function context(name, isUser) {
    return { userLevel: personaLevelCap(name, isUser), confidantRank };
}

/** Whether this character can use the Velvet Room (a Wild Card with two Personas). */
export function canFuse(name, isUser) {
    const rec = getPersonaRecord(name, isUser);
    return isVelvetEnabled() && rec.wildCard && rec.list.length >= 2;
}

/**
 * What fusing these owned Personas (ids) would give.
 * @returns {{ error } | { def, kind, parents, level, bonus, blocks: string[], inherit, already: boolean }}
 */
export function previewFusion(name, isUser, ids) {
    const rec = getPersonaRecord(name, isUser);
    if (!rec.wildCard) return { error: `${name} is not a Wild Card: only a Wild Card fuses Personas.` };
    const parents = (ids || []).map(id => rec.list.find(p => p.id === id)).filter(Boolean);
    const comp = getCompendium();
    if (!comp.length) return { error: 'The Velvet Room needs the Persona Compendium (a lorebook with Persona entries).' };
    const r = F.fusionResult(parents, comp);
    if (r.error) return r;
    const ctx = context(name, isUser);
    const rank = confidantRank(r.def.arcana);
    // The Confidant of its Arcana gives it XP: it may start above its base level.
    const pace = getXpSettings().perLevel;
    const bonusXp = rank ? F.confidantBonusXp(rank, r.def.level, pace) : 0;
    const grown = levelWithXp(r.def.level, 0, bonusXp, pace);
    const level = grown.level;
    const bonus = level - r.def.level;
    const already = rec.list.some(p => !ids.includes(p.id) && P.nameKey(p.name) === P.nameKey(r.def.name));
    const blocks = F.fusionBlocks(r.def, ctx);
    if (already) blocks.push(`${name} already has ${r.def.name}.`);
    return { ...r, parents, level, bonus, bonusXp, into: grown.into, rank, blocks, already, inherit: F.inheritance(parents, r.def) };
}

/** Every pair and special recipe this character's stock can make. */
export function listFusions(name, isUser) {
    const rec = getPersonaRecord(name, isUser);
    const comp = getCompendium();
    if (!rec.wildCard || !comp.length) return [];
    const out = [...F.availableSpecials(rec.list, comp), ...F.allFusions(rec.list, comp).filter(x => x.kind !== 'special')];
    const ctx = context(name, isUser);
    return out.map(x => ({ ...x, ids: x.parents.map(p => p.id), blocks: F.fusionBlocks(x.def, ctx) }));
}

/** How a Compendium Persona is made (for the Compendium lookup). */
export function recipesFor(personaName, { limit = 8 } = {}) {
    const comp = getCompendium();
    const def = comp.find(d => P.nameKey(d.name) === P.nameKey(personaName));
    return def ? F.recipesFor(def, comp, { limit }) : [];
}

/**
 * Fuses: the parents leave the stock, the result comes in with the chosen
 * inherited skills (the default pick when none are given).
 * @returns {{ persona, preview } | { error }}
 */
export function fuse(name, isUser, ids, { skills = null } = {}) {
    if (!isVelvetEnabled()) return { error: 'The Velvet Room is off.' };
    const pv = previewFusion(name, isUser, ids);
    if (pv.error) return pv;
    if (pv.blocks.length) return { error: pv.blocks.join(' ') };
    const pool = new Set(pv.inherit.pool.map(P.nameKey));
    const chosen = (Array.isArray(skills) ? skills : pv.inherit.picked)
        .filter(s => pool.has(P.nameKey(s)))
        .filter((s, i, a) => a.findIndex(x => P.nameKey(x) === P.nameKey(s)) === i)
        .slice(0, pv.inherit.slots);
    let persona = P.personaFromCompendium(pv.def, { level: pv.level });
    persona.xp = pv.into || 0;
    for (const s of chosen) {
        if (persona.skills.length >= P.MAX_SKILLS) break;
        if (!persona.skills.some(x => P.nameKey(x) === P.nameKey(s))) persona.skills.push(s);
    }
    persona.desc = P.normalizePersona(pv.def).desc;
    const res = replaceWithFusion(name, isUser, ids, persona);
    return res.error ? res : { persona: res.persona, preview: pv, inherited: chosen };
}
