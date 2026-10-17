/**
 * Checks — rolls for the characters, kept in the open chat.
 *
 * A check is d20 + a social stat's rank bonus against a difficulty
 * (src/utils/checkModel.js). The player's character uses their own social
 * stats; anyone else counts as rank 2 in each (an ordinary person). It
 * starts in one of two ways:
 *   - the player rolls by hand (the 🎲 button in the Stats panel);
 *   - the AI suggests one ("check" key of its tracker JSON); it waits as a
 *     pending request until the player rolls or dismisses it.
 * The result is not posted in the chat: it is added, as a fact, to the next
 * prompt so the story follows it, and stays there for one reply.
 *
 * In the chat (chat_metadata.dooms_tracker.betterStats.characterChecks):
 *   { pending: {who, stat, difficulty, dc, reason, at} | null,
 *     results: [{ id, name, isUser, stat, statLabel, difficultyLabel, die, modifier,
 *                 bonus, total, dc, margin, success, degree, reason, source,
 *                 afterIndex, consumedAt }] }   (the last 20)
 */
import { chat } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { isRpgModeActive } from './rpgMode.js';
import { chatStore, saveChatScope } from './chatScope.js';
import { getStatCharacters, getPersonaName, notifyStatsChanged } from './characterStats.js';
import { resolveTarget } from './characterEquipment.js';
import { getSocialView, isSocialEnabled } from './characterSocial.js';
import { SOCIAL_STATS, rankInfo } from '../../utils/socialModel.js';
import {
    DIFFICULTIES, resolveDifficulty, rollCheck, successChance, rankBonus,
    normalizeCheckRequest, describeResult, buildChecksPrompt,
} from '../../utils/checkModel.js';

const KEEP_RESULTS = 20;

export function isChecksEnabled() {
    return isRpgModeActive() && extensionSettings.checksEnabled !== false;
}

export function setChecksEnabled(on) {
    extensionSettings.checksEnabled = !!on;
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
}

function store(create = false) {
    const s = chatStore('characterChecks', create);
    if (s && create) {
        if (!Array.isArray(s.results)) s.results = [];
        if (!('pending' in s)) s.pending = null;
    }
    return s;
}

const lastIndex = () => (Array.isArray(chat) ? chat.length - 1 : -1);

// ─── Attributes ─────────────────────────────────────────────────────────────

/** Rank of the social stats for someone who is not the player's character. */
export const NPC_SOCIAL_RANK = 2;

/**
 * The social stats a character can be tested on, with their rank (the
 * value), its title and the bonus it gives.
 * @returns {Array<{id, name, abbr, value, title, modifier}>}
 */
export function getCheckAttributes(name, isUser) {
    let view = null;
    if (isUser) {
        try { if (isSocialEnabled()) view = getSocialView(name); } catch (e) { view = null; }
    }
    return SOCIAL_STATS.map(s => {
        const own = view ? view.find(v => v.id === s.id) : null;
        const rank = own ? own.rank : NPC_SOCIAL_RANK;
        const title = own ? own.title : rankInfo(s, s.thresholds[NPC_SOCIAL_RANK - 1]).title;
        return { id: s.id, name: s.name, abbr: s.name, value: rank, title, modifier: rankBonus(rank) };
    });
}

// Older chats and dungeons named a battle attribute: read it as the closest social stat.
const OLD_STATS = { st: 'guts', en: 'guts', ag: 'proficiency', ma: 'knowledge', lu: 'charm', str: 'guts', dex: 'proficiency', con: 'guts', int: 'knowledge', wis: 'knowledge', cha: 'charm', courage: 'guts', academics: 'knowledge', understanding: 'kindness', expression: 'charm', diligence: 'proficiency' };

function findAttribute(name, isUser, token) {
    let t = String(token || '').toLowerCase().trim();
    if (OLD_STATS[t]) t = OLD_STATS[t];
    if (!t) return null;
    const list = getCheckAttributes(name, isUser);
    return list.find(a => a.id.toLowerCase() === t)
        || list.find(a => String(a.abbr).toLowerCase() === t)
        || list.find(a => String(a.name).toLowerCase() === t)
        || list.find(a => String(a.name).toLowerCase().startsWith(t))
        || null;
}

/** The chance (0–1) of a check, for the roll dialog. */
export function checkChance(name, isUser, statId, dc, bonus = 0) {
    const a = findAttribute(name, isUser, statId);
    if (!a) return null;
    return successChance(a.modifier + (Number(bonus) || 0), dc);
}

// ─── Rolling ────────────────────────────────────────────────────────────────

/**
 * Rolls a check for a character and records it for the next prompt.
 * @param {string} name
 * @param {boolean} isUser
 * @param {{stat: string, difficulty?: string|number, bonus?: number, reason?: string, source?: 'player'|'ai'|'dungeon', rng?: Function, record?: boolean}} o
 * @returns {object|null} the recorded result, or null (no such attribute)
 */
export function rollCheckFor(name, isUser, { stat, difficulty = 'medium', bonus = 0, reason = '', source = 'player', rng, record = true } = {}) {
    const attr = findAttribute(name, isUser, stat);
    if (!attr) return null;
    const diff = resolveDifficulty(difficulty);
    const r = rollCheck({ value: attr.value, bonus, dc: diff.dc, rng });
    const entry = {
        id: `chk-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
        name, isUser: !!isUser,
        stat: attr.id, statLabel: attr.name,
        difficultyLabel: diff.id ? diff.id : `DC ${diff.dc}`,
        ...r,
        reason: String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 100),
        source: source === 'ai' ? 'ai' : (source === 'dungeon' ? 'dungeon' : 'player'),
        at: Date.now(),
        afterIndex: lastIndex(),
        consumedAt: null,
    };
    // `record: false` rolls without telling the story (a dungeon keeps its own log).
    if (!record) return entry;
    const s = store(true);
    if (!s) return entry;
    s.results.push(entry);
    if (s.results.length > KEEP_RESULTS) s.results.splice(0, s.results.length - KEEP_RESULTS);
    // Rolling answers whatever the AI had asked for.
    s.pending = null;
    saveChatScope();
    notifyStatsChanged({ source: 'checks', name });
    return entry;
}

/** The latest results, newest first. */
export function getRecentChecks(limit = 6) {
    const s = store();
    return (s?.results || []).slice(-limit).reverse();
}

export function clearChecks() {
    const s = store();
    if (!s) return;
    s.results = [];
    s.pending = null;
    saveChatScope();
    notifyStatsChanged({ source: 'checks' });
}

// ─── The AI's request ───────────────────────────────────────────────────────

/** The check the AI suggested and nobody has rolled yet, or null. */
export function getPendingCheck() {
    if (!isChecksEnabled()) return null;
    const p = store()?.pending;
    // A request belongs to the reply that made it and the player's answer to it.
    return p && p.stat && lastIndex() - p.at <= 1 ? { ...p } : null;
}

export function dismissPendingCheck() {
    const s = store();
    if (!s || !s.pending) return;
    s.pending = null;
    saveChatScope();
    notifyStatsChanged({ source: 'checks' });
}

/** Who the pending request is about: the persona unless it names a party NPC. */
export function pendingActor(p = getPendingCheck()) {
    if (!p) return null;
    if (p.who) {
        const t = resolveTarget(p.who);
        if (t) return t;
    }
    const persona = getStatCharacters().find(c => c.isUser);
    return persona ? { name: persona.name, isUser: true } : (getPersonaName() ? { name: getPersonaName(), isUser: true } : null);
}

/**
 * Takes the "check" of a fresh reply (if any) as the pending request, and
 * lets everything older than this reply go: a result has done its job once
 * the AI has answered it, and a request the AI did not repeat has passed.
 * @returns {boolean} whether a request was recorded
 */
export function settleChecks(rawCheck, messageIndex) {
    if (!isChecksEnabled()) return false;
    const s = store(!!rawCheck);
    if (!s) return false;
    let changed = false;
    for (const r of s.results || []) {
        if (r.consumedAt === null && r.afterIndex < messageIndex) { r.consumedAt = messageIndex; changed = true; }
    }
    if (s.pending && s.pending.at < messageIndex) { s.pending = null; changed = true; }
    let recorded = false;
    const req = rawCheck ? normalizeCheckRequest(rawCheck) : null;
    if (req) {
        const actor = req.who ? resolveTarget(req.who) : null;
        const who = actor || getStatCharacters().find(c => c.isUser) || null;
        if (who && findAttribute(who.name, who.isUser, req.stat)) {
            s.pending = { who: who.name, stat: req.stat, difficulty: req.difficulty, dc: req.dc, reason: req.reason, at: messageIndex };
            recorded = true;
            changed = true;
        }
    }
    if (changed) { saveChatScope(); notifyStatsChanged({ source: 'checks' }); }
    return recorded;
}

/** A swipe or regenerate replaced that reply: forget what it asked or consumed. */
export function revertAIChecksForReplacedMessage(index) {
    const s = store();
    if (!s || index === undefined) return;
    let changed = false;
    if (s.pending && s.pending.at === index) { s.pending = null; changed = true; }
    for (const r of s.results || []) {
        // The result is waiting again, as if it had been rolled just before that reply.
        if (r.consumedAt === index) { r.consumedAt = null; r.afterIndex = index - 1; changed = true; }
    }
    if (changed) { saveChatScope(); notifyStatsChanged({ source: 'checks' }); }
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

/** The outcome lines still waiting for the story to answer them. */
function activeResults() {
    const s = store();
    const idx = lastIndex();
    return (s?.results || []).filter(r => r.consumedAt === null && idx - r.afterIndex <= 1);
}

function activeNote() {
    return activeResults().map(describeResult).join(' ');
}

/** Instructions to ask for a check, plus the outcome of the last one. */
export function buildChecksPromptForGeneration({ compact = true, standalone = false } = {}) {
    if (!isChecksEnabled()) return '';
    const persona = getStatCharacters().find(c => c.isUser);
    const statIds = persona ? getCheckAttributes(persona.name, true).map(a => a.id) : [];
    return buildChecksPrompt({ player: persona?.name || getPersonaName(), statIds, note: activeNote(), compact, standalone });
}

/** The outcome of the last check, for the roleplay reply (separate mode). */
export function buildChecksContextSummary() {
    if (!isChecksEnabled()) return '';
    const note = activeNote();
    return note ? `Check outcome (rolled by the game; it is fixed, write what happens to match it): ${note}` : '';
}

export { DIFFICULTIES };
