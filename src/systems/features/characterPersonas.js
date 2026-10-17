/**
 * Personas each character owns — kept in the chat, not in the lorebook.
 *
 *   chat_metadata.dooms_tracker.betterStats.characterPersonas["user:Joker"] =
 *     { wildCard: true, active: "<persona id>", list: [persona, …] }
 *
 * The equipped Persona supplies the character's St, Ma, En, Ag and Lu (as in
 * the games): this module registers itself as the attribute source of
 * characterStats.js, so the panel, the prompt, combat and checks all see the
 * Persona's numbers. Its skills are kept in the character's Spells &
 * Abilities (tagged with the Persona) so combat can use them.
 *
 * Personas come from the Compendium (personaCompendium.js, lorebook entries)
 * when the name is there, otherwise from the AI's description with numbers
 * made by the program. The equipped Persona follows its owner's level: each
 * level gained gives it POINTS_PER_LEVEL stat points and the skills its
 * "Learns" list holds.
 *
 * As in the games, a Persona can never be above its user's level (when
 * Levels are on): the user cannot add or equip one that is, and one the AI
 * awakens above it comes in at the character's level.
 *
 * A Wild Card (the player's character by default) holds up to MAX_STOCK
 * Personas and switches between them; anyone else has one, and a new one
 * replaces it (an evolution). AI changes are undone on a swipe
 * (chat_metadata.dooms_tracker.personasUndo).
 */
import { chat, chat_metadata } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import { isRpgModeActive } from './rpgMode.js';
import { chatStore, saveChatScope, CHAT_SCOPE } from './chatScope.js';
import { statKey, getStatCharacters, getPersonaName, notifyStatsChanged, setAttributeSource } from './characterStats.js';
import { setLevelHook, getProgress, isProgressEnabled } from './characterProgress.js';
import { resolveTarget } from './characterEquipment.js';
import { getAbilities, addAbility, removeAbility, isAbilitiesEnabled } from './characterAbilities.js';
import { getCompendium, findInCompendium } from './personaCompendium.js';
import * as P from '../../utils/personaModel.js';

export function isPersonasEnabled() {
    return isRpgModeActive() && extensionSettings.personasEnabled !== false;
}

export function setPersonasEnabled(on) {
    extensionSettings.personasEnabled = !!on;
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
}

// ─── Storage ────────────────────────────────────────────────────────────────

function store(create = false) {
    return chatStore('characterPersonas', create);
}

function findKey(obj, key) {
    if (!obj || !key) return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, key)) return key;
    const lower = String(key).toLowerCase();
    return Object.keys(obj).find(k => k.toLowerCase() === lower);
}

function normalizeRecord(raw, isUser) {
    const list = (Array.isArray(raw?.list) ? raw.list : []).map(P.normalizePersona).filter(Boolean);
    const wildCard = typeof raw?.wildCard === 'boolean' ? raw.wildCard : !!isUser;
    let active = typeof raw?.active === 'string' && list.some(p => p.id === raw.active) ? raw.active : null;
    if (!active && list.length) active = list[0].id;
    return { wildCard, active, list };
}

function readKey(key) {
    const s = store();
    const k = findKey(s, key);
    return normalizeRecord(k !== undefined ? s[k] : null, key.startsWith('user:'));
}

function writeKey(key, rec) {
    const s = store(true);
    if (!s) return;
    const k = findKey(s, key);
    s[k !== undefined ? k : key] = normalizeRecord(rec, key.startsWith('user:'));
}

/** { wildCard, active, list } for a character (a copy). */
export function getPersonaRecord(name, isUser = false) {
    return readKey(statKey(name, isUser));
}

export function getPersonas(name, isUser = false) {
    return getPersonaRecord(name, isUser).list;
}

/** The equipped Persona, or null. */
export function getActivePersona(name, isUser = false) {
    const r = getPersonaRecord(name, isUser);
    return r.list.find(p => p.id === r.active) || null;
}

function characterLevel(name, isUser) {
    try { return isProgressEnabled() ? getProgress(name, isUser).level || 1 : 1; } catch (e) { return 1; }
}

/** The highest Persona level a character can use, or null when Levels are off. */
export function personaLevelCap(name, isUser) {
    try { return isProgressEnabled() ? getProgress(name, isUser).level || 1 : null; } catch (e) { return null; }
}

/** Whether the character's level is high enough for this Persona. */
export function canUsePersona(name, isUser, persona) {
    const cap = personaLevelCap(name, isUser);
    return cap === null || !persona || persona.level <= cap;
}

function changed(name, isUser, { sync = true } = {}) {
    if (sync) syncSkills(name, isUser);
    saveChatScope();
    notifyStatsChanged({ source: 'personas', name });
}

// ─── Skills → Spells & Abilities ────────────────────────────────────────────

/**
 * Keeps the character's abilities in step with the equipped Persona:
 * entries tagged with a Persona that is not equipped (or a skill it no
 * longer has) go, the equipped one's skills come in as spells.
 */
function syncSkills(name, isUser) {
    if (!isAbilitiesEnabled()) return;
    const active = getActivePersona(name, isUser);
    const want = new Set((active?.skills || []).map(P.nameKey));
    for (const a of [...getAbilities(name, isUser)]) {
        if (!a.fromPersona) continue;
        if (!active || a.fromPersona !== active.id || !want.has(P.nameKey(a.name))) removeAbility(name, isUser, a.id);
    }
    if (!active) return;
    const have = new Set(getAbilities(name, isUser).map(a => P.nameKey(a.name)));
    for (const skill of active.skills) {
        if (have.has(P.nameKey(skill))) continue;
        const a = addAbility(name, isUser, { name: skill, type: 'spell', cost: 'light', desc: `${active.name}'s skill`, aiCanRemove: false });
        if (a && !a.error) a.fromPersona = active.id;
    }
}

// ─── Building Personas ──────────────────────────────────────────────────────

/**
 * A new Persona for a character: the Compendium's when the name is there,
 * otherwise made from the description (numbers from the program).
 */
export function makePersonaFor(name, isUser, desc, { lowerToCap = false } = {}) {
    const d = typeof desc === 'string' ? { name: desc } : (desc || {});
    const lvl = Number(d.level) || characterLevel(name, isUser);
    const def = findInCompendium(d.name);
    let p = def ? P.personaFromCompendium(def, { level: d.level ? lvl : null })
        : P.personaFromDescription({ ...d, source: d.source || 'ai' }, { level: lvl });
    const cap = personaLevelCap(name, isUser);
    // Above the character's level: brought down to it (when asked to).
    if (p && lowerToCap && cap !== null && p.level > cap) p = P.setPersonaLevel(p, cap).persona;
    return p;
}

/** Adds a Persona. Wild Cards collect them; anyone else swaps theirs. */
function addTo(rec, persona) {
    if (rec.list.some(p => P.nameKey(p.name) === P.nameKey(persona.name))) return { error: `Already has ${persona.name}.` };
    if (rec.wildCard) {
        if (rec.list.length >= P.MAX_STOCK) return { error: `A Wild Card holds at most ${P.MAX_STOCK} Personas.` };
        rec.list.push(persona);
        if (!rec.active) rec.active = persona.id;
    } else {
        rec.list = [persona];
        rec.active = persona.id;
    }
    return { persona };
}

// ─── Editing (Stats panel) ──────────────────────────────────────────────────

/** Adds a Persona by name (Compendium) or description. Returns { persona } or { error }. */
export function addPersona(name, isUser, desc) {
    const persona = makePersonaFor(name, isUser, { source: 'user', ...(typeof desc === 'string' ? { name: desc } : desc) });
    if (!persona) return { error: 'Give the Persona a name.' };
    if (!canUsePersona(name, isUser, persona)) {
        return { error: `${persona.name} is level ${persona.level}: ${name} must reach level ${persona.level} first (now ${personaLevelCap(name, isUser)}).` };
    }
    const key = statKey(name, isUser);
    const rec = readKey(key);
    const res = addTo(rec, persona);
    if (res.error) return res;
    writeKey(key, rec);
    changed(name, isUser);
    return res;
}

function editPersona(name, isUser, id, fn) {
    const key = statKey(name, isUser);
    const rec = readKey(key);
    const i = rec.list.findIndex(p => p.id === id);
    if (i === -1) return null;
    const next = fn(P.normalizePersona(rec.list[i]), rec);
    if (!next) return null;
    rec.list[i] = P.normalizePersona(next);
    writeKey(key, rec);
    changed(name, isUser);
    return rec.list[i];
}

export function equipPersona(name, isUser, id) {
    const key = statKey(name, isUser);
    const rec = readKey(key);
    const p = rec.list.find(x => x.id === id);
    if (!p || rec.active === id) return false;
    if (!canUsePersona(name, isUser, p)) return { error: `${p.name} is level ${p.level}: ${name} must reach level ${p.level} first.` };
    rec.active = id;
    writeKey(key, rec);
    changed(name, isUser);
    return true;
}

export function removePersona(name, isUser, id) {
    const key = statKey(name, isUser);
    const rec = readKey(key);
    const i = rec.list.findIndex(p => p.id === id);
    if (i === -1) return false;
    rec.list.splice(i, 1);
    if (rec.active === id) rec.active = rec.list[0]?.id || null;
    writeKey(key, rec);
    changed(name, isUser);
    return true;
}

/**
 * Velvet Room: the parents leave, the result comes in (equipped if one of the
 * parents was). Returns { persona } or { error }.
 */
export function replaceWithFusion(name, isUser, parentIds, persona) {
    const key = statKey(name, isUser);
    const rec = readKey(key);
    const ids = new Set(parentIds);
    if (!persona) return { error: 'No result.' };
    if (ids.size < 2 || [...ids].some(id => !rec.list.some(p => p.id === id))) return { error: 'Those Personas are not in the stock.' };
    if (rec.list.some(p => !ids.has(p.id) && P.nameKey(p.name) === P.nameKey(persona.name))) return { error: `Already has ${persona.name}.` };
    const wasActive = ids.has(rec.active);
    rec.list = rec.list.filter(p => !ids.has(p.id));
    const fresh = P.normalizePersona({ ...persona, id: undefined });
    rec.list.push(fresh);
    if (wasActive || !rec.active || !rec.list.some(p => p.id === rec.active)) rec.active = fresh.id;
    writeKey(key, rec);
    changed(name, isUser);
    return { persona: fresh };
}

export function setPersonaLevel(name, isUser, id, level) {
    const cap = personaLevelCap(name, isUser);
    const to = cap === null ? level : Math.min(level, cap);
    return editPersona(name, isUser, id, (p) => (to === p.level ? null : P.setPersonaLevel(p, to).persona));
}

export function setPersonaStat(name, isUser, id, statId, value) {
    if (!P.STAT_IDS.includes(statId)) return null;
    return editPersona(name, isUser, id, (p) => { p.stats[statId] = value; return p; });
}

export function cyclePersonaAffinity(name, isUser, id, elementId) {
    if (!P.ELEMENT_IDS.includes(elementId)) return null;
    return editPersona(name, isUser, id, (p) => {
        const i = P.AFFINITY_CYCLE.indexOf(p.affinities[elementId] || '');
        p.affinities[elementId] = P.AFFINITY_CYCLE[(i + 1) % P.AFFINITY_CYCLE.length];
        return p;
    });
}

export function addPersonaSkill(name, isUser, id, skill) {
    return editPersona(name, isUser, id, (p) => {
        const n = String(skill || '').trim();
        if (!n || p.skills.length >= P.MAX_SKILLS || p.skills.some(s => P.nameKey(s) === P.nameKey(n))) return null;
        p.skills.push(n);
        return p;
    });
}

export function removePersonaSkill(name, isUser, id, skill) {
    return editPersona(name, isUser, id, (p) => {
        p.skills = p.skills.filter(s => P.nameKey(s) !== P.nameKey(skill));
        return p;
    });
}

export function setPersonaArcana(name, isUser, id, arcana) {
    return editPersona(name, isUser, id, (p) => { p.arcana = arcana; return p; });
}

export function setWildCard(name, isUser, on) {
    const key = statKey(name, isUser);
    const rec = readKey(key);
    rec.wildCard = !!on;
    // Back to a single Persona: keep the equipped one.
    if (!rec.wildCard && rec.list.length > 1) rec.list = rec.list.filter(p => p.id === rec.active);
    writeKey(key, rec);
    changed(name, isUser);
}

export function deletePersonasEverywhere(name, isUser = false) {
    const s = store();
    const k = findKey(s, statKey(name, isUser));
    if (k !== undefined) { delete s[k]; saveChatScope(); }
}

// ─── The character's attributes come from the equipped Persona ──────────────

setAttributeSource({
    get(name, isUser) {
        if (!isPersonasEnabled()) return null;
        const p = getActivePersona(name, isUser);
        return p ? { ...p.stats } : null;
    },
    set(name, isUser, statId, value) {
        const p = isPersonasEnabled() ? getActivePersona(name, isUser) : null;
        if (!p) return false;
        return !!setPersonaStat(name, isUser, p.id, statId, value);
    },
});

// The equipped Persona grows (or shrinks) with its owner's level.
setLevelHook((key, from, to) => {
    if (!isPersonasEnabled()) return;
    const rec = readKey(key);
    const i = rec.list.findIndex(p => p.id === rec.active);
    if (i === -1) return;
    const { persona, learned } = P.setPersonaLevel(rec.list[i], rec.list[i].level + (to - from));
    rec.list[i] = persona;
    writeKey(key, rec);
    if (learned.length) {
        try { globalThis.toastr?.info(`${persona.name} learned ${learned.join(', ')}`, 'Persona', { timeOut: 4000 }); } catch (e) { /* no toasts */ }
    }
    const [ns, ...rest] = key.split(':');
    const name = rest.join(':');
    syncSkills(name, ns === 'user');
});

// ─── Prompt ─────────────────────────────────────────────────────────────────

function sceneOwners() {
    const owners = [];
    const wildCards = [];
    for (const c of getStatCharacters()) {
        const rec = getPersonaRecord(c.name, c.isUser);
        if (rec.wildCard) wildCards.push(c.name);
        if (!rec.list.length) continue;
        const active = rec.list.find(p => p.id === rec.active) || null;
        owners.push({
            name: c.name, isUser: c.isUser, wildCard: rec.wildCard, active,
            others: rec.list.filter(p => p !== active).map(p => `${p.name} (${p.arcana || '?'} ${p.level})`),
        });
    }
    return { owners, wildCards };
}

export function buildPersonaPromptForGeneration({ compact = true, standalone = false } = {}) {
    if (!isPersonasEnabled()) return '';
    const { owners, wildCards } = sceneOwners();
    const compendium = getCompendium().map(p => p.name);
    return P.buildPersonaPrompt({ owners, wildCards, compendium, compact, standalone });
}

export function buildPersonaContextSummary() {
    if (!isPersonasEnabled()) return '';
    const { owners } = sceneOwners();
    if (!owners.length) return '';
    return 'Personas: ' + owners.map(o => `${o.name} — ${o.active ? P.describePersona(o.active) : 'none equipped'}`).join('; ');
}

// ─── Applying the AI's update ───────────────────────────────────────────────

/** Applies the "personas" key of a fresh reply. Returns how many characters changed. */
export function applyAIPersonas(raw, messageIndex) {
    if (!isPersonasEnabled() || raw === null || raw === undefined) return 0;
    const snapshots = [];
    for (const change of P.normalizeAIPersonas(raw)) {
        let target = null;
        try { target = resolveTarget(change.name); } catch (e) { target = null; }
        if (!target) {
            const player = getPersonaName();
            if (player && change.name.toLowerCase() === player.toLowerCase()) target = { name: player, isUser: true };
        }
        if (!target) continue;
        const key = statKey(target.name, target.isUser);
        const before = readKey(key);
        const rec = readKey(key);
        const notes = [];
        for (const a of change.add) {
            const persona = makePersonaFor(target.name, target.isUser, { ...a, source: 'ai' }, { lowerToCap: true });
            if (!persona) continue;
            const hadNone = !rec.list.length;
            const res = addTo(rec, persona);
            if (!res.error) notes.push(hadNone ? `${target.name} awakened ${persona.name}!` : `${target.name} obtained ${persona.name}`);
        }
        if (change.equip) {
            const p = rec.list.find(x => P.nameKey(x.name) === P.nameKey(change.equip));
            if (p && rec.active !== p.id && canUsePersona(target.name, target.isUser, p)) rec.active = p.id;
        }
        if (change.learn.length) {
            const i = rec.list.findIndex(x => x.id === rec.active);
            if (i !== -1) {
                const p = P.normalizePersona(rec.list[i]);
                for (const s of change.learn) {
                    if (p.skills.length < P.MAX_SKILLS && !p.skills.some(x => P.nameKey(x) === P.nameKey(s))) p.skills.push(s);
                }
                rec.list[i] = p;
            }
        }
        if (JSON.stringify(rec) === JSON.stringify(before)) continue;
        writeKey(key, rec);
        syncSkills(target.name, target.isUser);
        snapshots.push({ key, name: target.name, isUser: target.isUser, before, after: readKey(key) });
        for (const n of notes) {
            try { globalThis.toastr?.success(n, 'Persona', { timeOut: 5000 }); } catch (e) { /* no toasts */ }
        }
    }
    console.log(`[Dooms Tracker] Personas: ${snapshots.length} character(s) changed`);
    if (!snapshots.length) return 0;
    try {
        if (chat_metadata) {
            if (!chat_metadata.dooms_tracker) chat_metadata.dooms_tracker = {};
            const prev = chat_metadata.dooms_tracker.personasUndo;
            let snaps = snapshots;
            if (prev && prev.messageIndex === messageIndex && Array.isArray(prev.snapshots)) {
                snaps = prev.snapshots.map(x => ({ ...x }));
                for (const sn of snapshots) {
                    const old = snaps.find(x => x.key === sn.key);
                    if (old) old.after = sn.after;
                    else snaps.push(sn);
                }
            }
            chat_metadata.dooms_tracker.personasUndo = { messageIndex, campaign: CHAT_SCOPE, snapshots: snaps };
        }
    } catch (e) { /* undo is best-effort */ }
    saveChatScope();
    notifyStatsChanged({ source: 'ai' });
    return snapshots.length;
}

/** Before a swipe/regenerate: put back what the replaced reply changed, where untouched since. */
export function revertAIPersonasForReplacedMessage(replacedIndex) {
    try {
        const rec = chat_metadata?.dooms_tracker?.personasUndo;
        if (!rec) return 0;
        const lastIdx = Array.isArray(chat) ? chat.length - 1 : -1;
        const idx = typeof replacedIndex === 'number' ? replacedIndex : lastIdx;
        if (rec.messageIndex !== idx && rec.messageIndex !== idx + 1) return 0;
        delete chat_metadata.dooms_tracker.personasUndo;
        let n = 0;
        for (const sn of rec.snapshots || []) {
            if (JSON.stringify(readKey(sn.key)) !== JSON.stringify(sn.after)) continue;
            writeKey(sn.key, sn.before);
            syncSkills(sn.name, sn.isUser);
            n++;
        }
        if (n) {
            saveChatScope();
            notifyStatsChanged({ source: 'undo' });
        }
        saveChatData();
        return n;
    } catch (e) {
        console.warn('[Dooms Tracker] Personas: undo failed', e);
        return 0;
    }
}
