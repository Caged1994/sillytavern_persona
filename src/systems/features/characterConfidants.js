/**
 * Confidants — the player's bonds, one person per Arcana, rank 1–10.
 *
 *   chat_metadata.dooms_tracker.betterStats.characterConfidants =
 *     { bonds: { "Ryuji": { arcana, rank, points, source, since } },
 *       pending: [{ name, arcana, reason, at }] }      // waiting for "Accept"
 *
 * Who can become one is set per card (extensionSettings.confidantModes):
 *   defined  only the Confidants described in the lorebook (+ by hand);
 *   mixed    the lorebook ones keep their Arcana, the story fills free ones;
 *   sandbox  every bond comes from the story (+ by hand);
 *   auto     (default) mixed when an active lorebook has "Confidant:"
 *            entries, sandbox otherwise.
 * A bond the AI starts with someone not in the lorebook needs that person's
 * affinity at the threshold (Settings), and an Arcana nobody holds; with
 * "Ask first" on it waits in the panel for Accept / Reject.
 *
 * The AI gives points ("confidants" key); enough points raise the rank
 * unless a requirement (a social stat, a level) is not met yet. A swipe
 * undoes what the replaced reply changed.
 */
import { chat, chat_metadata } from '../../../../../../../script.js';
import { recordMessageEvent } from './messageEvents.js';
import { extensionSettings } from '../../core/state.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import { isRpgModeActive, currentCardKey } from './rpgMode.js';
import { chatStore, saveChatScope, CHAT_SCOPE } from './chatScope.js';
import { getPersonaName, notifyStatsChanged } from './characterStats.js';
import { resolveTarget } from './characterEquipment.js';
import { getAffinity, isAffinityEnabled } from './characterAffinity.js';
import { getSocialView, isSocialEnabled } from './characterSocial.js';
import { getProgress, isProgressEnabled, isPartyMember } from './characterProgress.js';
import { unlockedIds, abilityName } from '../../utils/bondModel.js';
import { getReadableWorldNames, loadWorldData } from '../lorebook/lorebookAPI.js';
import { nameKey } from '../../utils/personaModel.js';
import * as C from '../../utils/confidantModel.js';

export const CONFIDANTS_CHANGED_EVENT = 'dooms:confidants-book';

// ─── Settings ───────────────────────────────────────────────────────────────

export function isConfidantsEnabled() {
    return isRpgModeActive() && extensionSettings.confidantsEnabled !== false;
}

export function setConfidantsEnabled(on) {
    extensionSettings.confidantsEnabled = !!on;
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
}

/** The mode chosen for the current card ('auto' when none). */
export function getConfidantModeSetting(cardKey = currentCardKey()) {
    const v = extensionSettings.confidantModes?.[cardKey];
    return C.MODES.includes(v) ? v : 'auto';
}

export function setConfidantMode(mode, cardKey = currentCardKey()) {
    if (!cardKey) return;
    if (!extensionSettings.confidantModes || typeof extensionSettings.confidantModes !== 'object') extensionSettings.confidantModes = {};
    if (mode === 'auto' || !C.MODES.includes(mode)) delete extensionSettings.confidantModes[cardKey];
    else extensionSettings.confidantModes[cardKey] = mode;
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
}

/** The mode in force: defined | mixed | sandbox. */
export function getConfidantMode() {
    const m = getConfidantModeSetting();
    if (m !== 'auto') return m;
    return getDefinitions().length ? 'mixed' : 'sandbox';
}

export function getMinAffinity() {
    const v = Number(extensionSettings.confidantMinAffinity);
    return Number.isFinite(v) ? Math.max(-100, Math.min(100, Math.round(v))) : 20;
}

export function setMinAffinity(v) {
    extensionSettings.confidantMinAffinity = Math.max(-100, Math.min(100, Math.round(Number(v) || 0)));
    saveSettings();
}

/** Whether a bond the AI starts waits for Accept / Reject. */
export function isConfirmOn() {
    return extensionSettings.confidantConfirm === true;
}

export function setConfirm(on) {
    extensionSettings.confidantConfirm = !!on;
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
}

// ─── Lorebook definitions ───────────────────────────────────────────────────

let book = { list: [], books: [], at: 0 };
let loading = null;

export function refreshConfidantBook({ force = false } = {}) {
    if (loading) return loading;
    loading = (async () => {
        const books = [...getReadableWorldNames()];
        const entries = [];
        for (const b of books) {
            try {
                const data = await loadWorldData(b, force);
                entries.push(...Object.values(data?.entries || {}));
            } catch (e) { /* unreadable lorebook: skip */ }
        }
        book = { list: C.parseConfidantBook(entries), books, at: Date.now() };
        try { window.dispatchEvent(new CustomEvent(CONFIDANTS_CHANGED_EVENT)); } catch (e) { /* no window */ }
        return book.list;
    })().finally(() => { loading = null; });
    return loading;
}

/** The Confidants the active lorebooks describe (cached, refreshed in the background). */
export function getDefinitions() {
    const books = [...getReadableWorldNames()];
    const same = books.length === book.books.length && books.every((b, i) => b === book.books[i]);
    if (!same || Date.now() - book.at > 60000) refreshConfidantBook().catch(() => {});
    return book.list;
}

export function findDefinition(name) {
    const k = nameKey(name);
    return k ? getDefinitions().find(d => nameKey(d.name) === k) || null : null;
}

/** For tests: use this list as the lorebook definitions. */
export function setDefinitionsForTests(list) {
    book = { list: list || [], books: [...getReadableWorldNames()], at: Date.now() };
}

// ─── Storage ────────────────────────────────────────────────────────────────

function store(create = false) {
    const s = chatStore('characterConfidants', create);
    if (s) {
        if (!s.bonds || typeof s.bonds !== 'object') s.bonds = {};
        if (!Array.isArray(s.pending)) s.pending = [];
    }
    return s;
}

function findKey(obj, name) {
    if (!obj || !name) return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, name)) return name;
    const k = nameKey(name);
    return Object.keys(obj).find(x => nameKey(x) === k);
}

function snapshot() {
    const s = store();
    return s ? JSON.parse(JSON.stringify({ bonds: s.bonds, pending: s.pending })) : { bonds: {}, pending: [] };
}

function restore(snap) {
    const s = store(true);
    if (!s) return;
    s.bonds = JSON.parse(JSON.stringify(snap.bonds || {}));
    s.pending = JSON.parse(JSON.stringify(snap.pending || []));
}

function changed() {
    saveChatScope();
    notifyStatsChanged({ source: 'confidants' });
}

/** Every formed bond: [{ name, arcana, rank, points, source, def, progress, unlocked }], by Arcana order. */
export function getBonds() {
    const s = store();
    const out = [];
    for (const [name, raw] of Object.entries(s?.bonds || {})) {
        const rec = C.normalizeConfidant(raw);
        if (!rec || rec.rank < 1) continue;
        const def = findDefinition(name);
        out.push({
            name, ...rec, def,
            progress: C.rankProgress(rec),
            unlocked: (def?.unlocks || []).filter(u => u.rank <= rec.rank).map(u => u.text),
        });
    }
    const order = (a) => { const i = C.ARCANA.indexOf(a); return i < 0 ? 99 : i; };
    return out.sort((a, b) => order(a.arcana) - order(b.arcana));
}

export function getBond(name) {
    return getBonds().find(b => nameKey(b.name) === nameKey(name)) || null;
}

export function getPending() {
    return [...(store()?.pending || [])];
}

/** Lorebook Confidants not formed yet. */
export function getUnmet() {
    const formed = new Set(getBonds().map(b => nameKey(b.name)));
    return getDefinitions().filter(d => !formed.has(nameKey(d.name)));
}

/** Arcana nobody holds (for the story: also not reserved by a lorebook Confidant). */
export function freeArcana({ forStory = false } = {}) {
    const used = new Set(getBonds().map(b => b.arcana));
    for (const p of getPending()) used.add(p.arcana);
    if (forStory) for (const d of getDefinitions()) used.add(d.arcana);
    return C.ARCANA.filter(a => !used.has(a));
}

function socialRanks() {
    const out = {};
    try { if (isSocialEnabled()) for (const s of getSocialView()) out[s.id] = s.rank; } catch (e) { /* none */ }
    return out;
}

function playerLevel() {
    try { return isProgressEnabled() ? getProgress(getPersonaName(), true).level : null; } catch (e) { return null; }
}

function writeBond(name, rec) {
    const s = store(true);
    if (!s) return;
    const k = findKey(s.bonds, name);
    s.bonds[k !== undefined ? k : name] = C.normalizeConfidant(rec);
}

function toast(kind, text, title = 'Confidant') {
    try { globalThis.toastr?.[kind]?.(text, title, { timeOut: 4500 }); } catch (e) { /* no toasts */ }
}

// ─── Editing (Stats panel) ──────────────────────────────────────────────────

/** Starts a bond by hand (any mode; the Arcana must be free). Returns { ok } or { error }. */
export function startConfidant(name, arcana, { source = 'user' } = {}) {
    const n = String(name || '').trim();
    if (!n) return { error: 'Choose someone.' };
    const def = findDefinition(n);
    const a = def ? def.arcana : C.normalizeConfidant({ arcana })?.arcana;
    if (!a) return { error: 'Choose an Arcana.' };
    if (getBond(n)) return { error: `${n} is already a Confidant.` };
    const holder = getBonds().find(b => b.arcana === a);
    if (holder) return { error: `${a} is already ${holder.name}'s Arcana.` };
    const s = store(true);
    s.pending = s.pending.filter(p => nameKey(p.name) !== nameKey(n));
    writeBond(def ? def.name : n, { arcana: a, rank: 1, points: 0, source: def ? 'lorebook' : source });
    changed();
    return { ok: true, arcana: a };
}

export function removeConfidant(name) {
    const s = store();
    const k = findKey(s?.bonds, name);
    if (k === undefined) return false;
    delete s.bonds[k];
    changed();
    return true;
}

export function setConfidantRank(name, rank) {
    const b = getBond(name);
    if (!b) return null;
    writeBond(b.name, { ...b, rank: Math.max(1, Math.min(C.MAX_RANK, Math.round(rank))), points: 0 });
    changed();
    return getBond(name);
}

export function addConfidantPoints(name, n) {
    const b = getBond(name);
    if (!b) return null;
    const r = C.addPoints(b, n, b.def, { social: socialRanks(), level: playerLevel() });
    writeBond(b.name, r.rec);
    changed();
    return r;
}

export function acceptPending(name) {
    const p = getPending().find(x => nameKey(x.name) === nameKey(name));
    if (!p) return { error: 'Nothing to accept.' };
    return startConfidant(p.name, p.arcana, { source: 'ai' });
}

export function rejectPending(name) {
    const s = store();
    if (!s) return false;
    const before = s.pending.length;
    s.pending = s.pending.filter(p => nameKey(p.name) !== nameKey(name));
    if (s.pending.length !== before) changed();
    return s.pending.length !== before;
}

export function deleteConfidant(name) {
    const s = store();
    if (!s) return;
    const k = findKey(s.bonds, name);
    if (k !== undefined) delete s.bonds[k];
    s.pending = s.pending.filter(p => nameKey(p.name) !== nameKey(name));
    saveChatScope();
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

/** A teammate's unlocked fight abilities join the unlock texts the AI is told about. */
function withTeamAbilities(b) {
    let mate = false;
    try { mate = isPartyMember(b.name); } catch (e) { /* no levels */ }
    if (!mate) return b.unlocked;
    const names = unlockedIds(b.rank, b.def).map(abilityName).filter(n => !b.unlocked.some(u => u.toLowerCase().includes(n.toLowerCase())));
    return [...b.unlocked, ...names];
}

export function buildConfidantPromptForGeneration({ compact = true, standalone = false } = {}) {
    if (!isConfidantsEnabled()) return '';
    const player = getPersonaName();
    if (!player) return '';
    const mode = getConfidantMode();
    return C.buildConfidantPrompt({
        player,
        bonds: getBonds().map(b => ({ name: b.name, arcana: b.arcana, rank: b.rank, unlocked: withTeamAbilities(b) })),
        unmet: getUnmet().map(d => ({ name: d.name, arcana: d.arcana })),
        free: mode === 'defined' ? [] : freeArcana({ forStory: true }),
        mode,
        minAffinity: isAffinityEnabled() ? getMinAffinity() : -100,
        compact, standalone,
    });
}

export function buildConfidantContextSummary() {
    if (!isConfidantsEnabled()) return '';
    const bonds = getBonds();
    const player = getPersonaName();
    if (!bonds.length || !player) return '';
    return `${player}'s Confidants: ${bonds.map(b => `${b.name} (${b.arcana} ${b.rank})`).join(', ')}`;
}

// ─── Applying the AI's update ───────────────────────────────────────────────

/** Why the AI may not start this bond, or '' when it may. */
function storyStartBlocker(name, arcana, def, mode) {
    if (def) return '';
    if (mode === 'defined') return 'this card only has the Confidants of its lorebook';
    if (!arcana) return 'no Arcana given';
    if (!freeArcana({ forStory: true }).includes(arcana)) return `${arcana} is taken`;
    if (isAffinityEnabled()) {
        const aff = getAffinity(name);
        if (aff === null || aff < getMinAffinity()) return `affinity below ${getMinAffinity()}`;
    }
    return '';
}

/** Applies the "confidants" key of a fresh reply. Returns how many bonds changed. */
export function applyAIConfidants(raw, messageIndex) {
    if (!isConfidantsEnabled() || raw === null || raw === undefined) return 0;
    const changes = C.normalizeAIConfidants(raw);
    if (!changes.length) return 0;
    const before = snapshot();
    const mode = getConfidantMode();
    let n = 0;
    const events = [];
    for (const ch of changes) {
        let target = null;
        try { target = resolveTarget(ch.name); } catch (e) { target = null; }
        const name = target && !target.isUser ? target.name : (findDefinition(ch.name)?.name || null);
        if (!name) continue;
        const def = findDefinition(name);
        let bond = getBond(name);
        if (ch.start && !bond) {
            const arcana = def ? def.arcana : ch.start;
            const why = storyStartBlocker(name, arcana, def, mode);
            if (why) {
                console.log(`[Dooms Tracker] Confidants: not starting ${name} — ${why}`);
            } else if (isConfirmOn() && !def) {
                const s = store(true);
                if (!s.pending.some(p => nameKey(p.name) === nameKey(name))) {
                    s.pending.push({ name, arcana, reason: ch.reason, at: Date.now() });
                    toast('info', `${name} could become your ${arcana} Confidant — accept it in the Stats panel.`);
                    n++;
                }
            } else {
                const r = startConfidant(name, arcana, { source: def ? 'lorebook' : 'ai' });
                if (r.ok) {
                    events.push({ name, arcana: r.arcana, rank: 1, kind: 'new' });
                    toast('success', `I am thou, thou art I… ${name} — ${r.arcana} Arcana, rank 1.`, 'New Confidant');
                    n++;
                    bond = getBond(name);
                }
            }
        }
        if (ch.add && bond) {
            const r = C.addPoints(bond, ch.add, def, { social: socialRanks(), level: playerLevel() });
            writeBond(bond.name, r.rec);
            n++;
            if (r.ranksGained) events.push({ name: bond.name, arcana: bond.arcana, rank: r.rec.rank, kind: 'up' });
            if (r.ranksGained) toast('success', `${bond.name} (${bond.arcana}) — rank ${r.rec.rank}${r.rec.rank >= C.MAX_RANK ? ' MAX!' : ''}`, 'Rank up!');
            else if (r.blocked && !bond.progress?.maxed) toast('warning', `${bond.name} could rank up, but ${r.blocked}.`);
        }
    }
    if (!n) return 0;
    if (events.length) recordMessageEvent(messageIndex, 'bonds', events);
    try {
        if (chat_metadata) {
            if (!chat_metadata.dooms_tracker) chat_metadata.dooms_tracker = {};
            const prev = chat_metadata.dooms_tracker.confidantsUndo;
            const start = prev && prev.messageIndex === messageIndex ? prev.before : before;
            chat_metadata.dooms_tracker.confidantsUndo = { messageIndex, campaign: CHAT_SCOPE, before: start, after: snapshot() };
        }
    } catch (e) { /* undo is best-effort */ }
    changed();
    return n;
}

/** Before a swipe/regenerate: put back what the replaced reply changed, if untouched since. */
export function revertAIConfidantsForReplacedMessage(replacedIndex) {
    try {
        const rec = chat_metadata?.dooms_tracker?.confidantsUndo;
        if (!rec) return 0;
        const lastIdx = Array.isArray(chat) ? chat.length - 1 : -1;
        const idx = typeof replacedIndex === 'number' ? replacedIndex : lastIdx;
        if (rec.messageIndex !== idx && rec.messageIndex !== idx + 1) return 0;
        delete chat_metadata.dooms_tracker.confidantsUndo;
        if (JSON.stringify(snapshot()) !== JSON.stringify(rec.after)) { saveChatData(); return 0; }
        restore(rec.before);
        saveChatScope();
        notifyStatsChanged({ source: 'undo' });
        saveChatData();
        return 1;
    } catch (e) {
        console.warn('[Dooms Tracker] Confidants: undo failed', e);
        return 0;
    }
}
