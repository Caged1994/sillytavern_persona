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
 * Levels are on): the user cannot add or equip one that is. One the AI
 * awakens can be any Persona at all and comes in at exactly its user's level.
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
import { setLevelHook, setNoPointsCheck, setLevel as setCharacterLevel, getProgress, isProgressEnabled, getXpSettings } from './characterProgress.js';
import { xpNeededAt } from '../../utils/xpModel.js';
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

/**
 * The character's own level, or null when Levels are off. A Persona can be
 * obtained (fused, drawn, added at its base level) only when this has
 * reached the Persona's base level; once owned it can grow past it.
 */
export function personaLevelCap(name, isUser) {
    try { return isProgressEnabled() ? getProgress(name, isUser).level || 1 : null; } catch (e) { return null; }
}

/** Whether the character can use this Persona: any Persona they own (the level rule is checked when it is obtained). */
export function canUsePersona(name, isUser, persona) {
    return !!persona;
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
export function makePersonaFor(name, isUser, desc, { lowerToCap = false, atUserLevel = false } = {}) {
    const d = typeof desc === 'string' ? { name: desc } : (desc || {});
    const lvl = Number(d.level) || characterLevel(name, isUser);
    const def = findInCompendium(d.name);
    let p = def ? P.personaFromCompendium(def, { level: d.level ? lvl : null })
        : P.personaFromDescription({ ...d, source: d.source || 'ai' }, { level: lvl });
    const cap = personaLevelCap(name, isUser);
    // An awakening: any Persona, at exactly its user's level (up or down).
    if (p && atUserLevel && cap !== null && p.level !== cap) p = P.setPersonaLevel(p, cap).persona;
    // Above the character's level: brought down to it (when asked to).
    if (p && lowerToCap && cap !== null && p.level > cap) p = P.setPersonaLevel(p, cap).persona;
    if (p) p.xp = 0;
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
    const d = { source: 'user', ...(typeof desc === 'string' ? { name: desc } : desc) };
    // Its base level (the Compendium's) once the character has reached it,
    // or any level typed in; before that it comes in at the character's
    // level, as an awakening does.
    const cap = personaLevelCap(name, isUser);
    const base = findInCompendium(d.name)?.level ?? null;
    const reachable = cap === null || base === null || base <= cap;
    const persona = makePersonaFor(name, isUser, d, { atUserLevel: !reachable || (!d.level && base === null) });
    if (!persona) return { error: 'Give the Persona a name.' };
    const key = statKey(name, isUser);
    const rec = readKey(key);
    const res = addTo(rec, persona);
    console.log(`[Dooms Tracker] Personas: adding ${persona.name} to ${name} (${isUser ? 'user' : 'npc'}, ${rec.wildCard ? 'Wild Card' : 'one Persona'}, character level ${cap ?? 'off'}) — ${findInCompendium(d.name) ? 'from the Compendium' : 'not in the Compendium'}, Lv ${persona.level}: ${res.error ? `refused (${res.error})` : 'added'}`);
    if (res.error) return res;
    writeKey(key, rec);
    const saved = readKey(key).list.some(p => p.id === persona.id);
    if (!saved) {
        console.warn(`[Dooms Tracker] Personas: ${persona.name} could not be stored — no chat data to write to (is a chat open and saved?)`);
        return { error: 'It could not be saved in this chat. Send a message first (a new chat is not saved until then), then try again.' };
    }
    changed(name, isUser);
    // Not a Wild Card: the character is as strong as their (only) Persona.
    if (!rec.wildCard && cap !== null && persona.level !== cap) {
        try { setCharacterLevel(name, isUser, persona.level); } catch (e) { /* levels off */ }
    }
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

/** Puts `persona` in place of the Persona `id` (an evolution), keeping it equipped if it was. */
export function replacePersona(name, isUser, id, persona) {
    const key = statKey(name, isUser);
    const rec = readKey(key);
    const i = rec.list.findIndex(p => p.id === id);
    const next = P.normalizePersona({ ...persona, id });
    if (i === -1 || !next) return { error: 'That Persona is not there.' };
    if (rec.list.some((p, j) => j !== i && P.nameKey(p.name) === P.nameKey(next.name))) return { error: `Already has ${next.name}.` };
    rec.list[i] = next;
    writeKey(key, rec);
    changed(name, isUser);
    return { persona: next };
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
    const res = editPersona(name, isUser, id, (p) => (level === p.level ? null : { ...P.setPersonaLevel(p, level).persona, xp: 0 }));
    // Not a Wild Card: the character is as strong as their Persona.
    const rec = readKey(statKey(name, isUser));
    if (res && !rec.wildCard && rec.active === id && isProgressEnabled() && getProgress(name, isUser).level !== res.level) {
        try { setCharacterLevel(name, isUser, res.level); } catch (e) { /* levels off */ }
    }
    return res;
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

// Anyone who is not a Wild Card is as strong as their Persona: its level
// follows theirs. A Wild Card's Personas level on their own (awardPersonaXp).
setLevelHook((key, from, to) => {
    if (!isPersonasEnabled()) return;
    const rec = readKey(key);
    if (rec.wildCard) return;
    const i = rec.list.findIndex(p => p.id === rec.active);
    if (i === -1 || rec.list[i].level === to) return;
    const { persona, learned } = P.setPersonaLevel(rec.list[i], to);
    rec.list[i] = persona;
    writeKey(key, rec);
    if (learned.length) {
        try { globalThis.toastr?.info(`${persona.name} learned ${learned.join(', ')}`, 'Persona', { timeOut: 4000 }); } catch (e) { /* no toasts */ }
    }
    const [ns, ...rest] = key.split(':');
    const name = rest.join(':');
    syncSkills(name, ns === 'user');
});

// With a Persona, the stats grow with it: no attribute points on level-up.
setNoPointsCheck((name, isUser) => isPersonasEnabled() && !!getActivePersona(name, isUser));

/**
 * Battle XP for a Wild Card's Personas: the one out gets it all, the others
 * only with a Growth skill (25 / 50 / 100%). Each levels on its own (and may
 * pass its user). Returns [{ name, levels, learned }].
 */
export function awardPersonaXp(name, isUser, amount) {
    if (!isPersonasEnabled() || !(amount > 0)) return [];
    const key = statKey(name, isUser);
    const rec = readKey(key);
    if (!rec.wildCard || !rec.list.length) return [];
    const { perLevel } = getXpSettings();
    const out = [];
    rec.list = rec.list.map(raw => {
        let p = P.normalizePersona(raw);
        const share = p.id === rec.active ? 1 : P.growthShare(p);
        if (!share) return p;
        let xp = p.xp + Math.round(amount * share);
        let level = p.level;
        while (level < P.MAX_LEVEL && xp >= xpNeededAt(level, perLevel)) { xp -= xpNeededAt(level, perLevel); level++; }
        if (level >= P.MAX_LEVEL) xp = 0;
        const learned = [];
        if (level !== p.level) {
            const r = P.setPersonaLevel(p, level);
            p = r.persona;
            learned.push(...r.learned);
            out.push({ name: p.name, from: raw.level, level, learned });
        }
        p.xp = xp;
        return p;
    });
    writeKey(key, rec);
    for (const u of out) {
        try { globalThis.toastr?.success(`${u.name} reached level ${u.level}${u.learned.length ? ` and learned ${u.learned.join(', ')}` : ''}.`, 'Persona', { timeOut: 5000 }); } catch (e) { /* no toasts */ }
    }
    changed(name, isUser);
    return out;
}

/** { level, into, needed, pct } of a Persona's own XP (a Wild Card's). */
export function personaXpInfo(persona) {
    const { perLevel } = getXpSettings();
    const needed = xpNeededAt(persona.level, perLevel);
    const into = Math.min(persona.xp || 0, needed);
    return { level: persona.level, into, needed, pct: persona.level >= P.MAX_LEVEL ? 100 : Math.round(into / needed * 100) };
}

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
            const persona = makePersonaFor(target.name, target.isUser, { ...a, source: 'ai', level: undefined }, { atUserLevel: true });
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
