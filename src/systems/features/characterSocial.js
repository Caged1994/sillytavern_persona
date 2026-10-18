/**
 * Social stats — the player's Knowledge, Guts, Proficiency, Kindness and
 * Charm (Persona 5), with their ranks.
 *
 * Points live in the open chat, per persona:
 *   chat_metadata.dooms_tracker.betterStats.characterSocial["user:Name"] = { knowledge: 34, … }
 * The AI adds a few points ("social" key, 1–5 per stat per reply, never
 * down); the user can set them in the Stats panel. A swipe takes back what
 * the replaced reply added (chat_metadata.dooms_tracker.socialUndo).
 *
 * The pure logic is in src/utils/socialModel.js.
 */
import { chat, chat_metadata } from '../../../../../../../script.js';
import { recordMessageEvent } from './messageEvents.js';
import { extensionSettings } from '../../core/state.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import { isRpgModeActive } from './rpgMode.js';
import { chatStore, saveChatScope, CHAT_SCOPE } from './chatScope.js';
import { getPersonaName, notifyStatsChanged, statKey } from './characterStats.js';
import {
    SOCIAL_STATS,
    normalizeSocial,
    clampPoints,
    rankInfo,
    normalizeAISocial,
    buildSocialPrompt,
    formatSocial,
    getSocialStat,
} from '../../utils/socialModel.js';

export function isSocialEnabled() {
    return isRpgModeActive() && extensionSettings.characterSocialEnabled !== false;
}

export function setSocialEnabled(on) {
    extensionSettings.characterSocialEnabled = !!on;
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
}

function store(create = false) {
    return chatStore('characterSocial', create);
}

function findKey(obj, key) {
    if (!obj || !key) return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, key)) return key;
    const lower = String(key).toLowerCase();
    return Object.keys(obj).find(k => k.toLowerCase() === lower);
}

function personaKey(name) {
    const n = name || getPersonaName();
    return n ? statKey(n, true) : '';
}

/** { id: points } for the persona (all zero when nothing is stored yet). */
export function getSocialPoints(name) {
    const s = store();
    const k = findKey(s, personaKey(name));
    return normalizeSocial(k !== undefined ? s[k] : null);
}

/** [{ ...stat, points, rank, title, next, pct }] in display order. */
export function getSocialView(name) {
    const p = getSocialPoints(name);
    return SOCIAL_STATS.map(s => ({ ...s, ...rankInfo(s, p[s.id]) }));
}

function writeAll(name, points) {
    const key = personaKey(name);
    const s = store(true);
    if (!s || !key) return;
    const k = findKey(s, key);
    s[k !== undefined ? k : key] = normalizeSocial(points);
}

/** Sets one stat's points by hand. Returns the stored value. */
export function setSocialPoints(name, id, value) {
    const v = clampPoints(value);
    if (v === null || !getSocialStat(id)) return null;
    const p = getSocialPoints(name);
    p[id] = v;
    writeAll(name, p);
    saveChatScope();
    notifyStatsChanged({ source: 'social' });
    return v;
}

export function resetSocial(name) {
    const s = store();
    const k = findKey(s, personaKey(name));
    if (k !== undefined) { delete s[k]; saveChatScope(); notifyStatsChanged({ source: 'social' }); }
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

export function buildSocialPromptForGeneration({ compact = true, standalone = false } = {}) {
    if (!isSocialEnabled()) return '';
    const player = getPersonaName();
    if (!player) return '';
    return buildSocialPrompt({ player, points: getSocialPoints(player), compact, standalone });
}

export function buildSocialContextSummary() {
    if (!isSocialEnabled()) return '';
    const player = getPersonaName();
    if (!player) return '';
    const p = getSocialPoints(player);
    return `${player}'s social stats: ${SOCIAL_STATS.map(s => formatSocial(s.id, p[s.id])).join(', ')}`;
}

// ─── Applying the AI's update ───────────────────────────────────────────────

function announceRankUps(before, after) {
    for (const s of SOCIAL_STATS) {
        const a = rankInfo(s, before[s.id]);
        const b = rankInfo(s, after[s.id]);
        if (b.rank > a.rank) {
            try { globalThis.toastr?.success(`${s.name} rank ${b.rank}: ${b.title}`, 'Rank up!', { timeOut: 4000 }); } catch (e) { /* no toasts */ }
        }
    }
}

/**
 * Applies the "social" key of a fresh reply to the persona.
 * @returns {number} stats changed
 */
export function applyAISocial(raw, messageIndex) {
    if (!isSocialEnabled() || raw === null || raw === undefined) return 0;
    const player = getPersonaName();
    if (!player) return 0;
    const gains = normalizeAISocial(raw);
    if (!gains.length) return 0;
    const before = getSocialPoints(player);
    const after = { ...before };
    for (const g of gains) after[g.id] = clampPoints(after[g.id] + g.add);
    const changed = SOCIAL_STATS.filter(s => after[s.id] !== before[s.id]).length;
    if (!changed) return 0;
    writeAll(player, after);
    try {
        if (chat_metadata) {
            if (!chat_metadata.dooms_tracker) chat_metadata.dooms_tracker = {};
            const prev = chat_metadata.dooms_tracker.socialUndo;
            // A refresh of the same reply keeps the oldest "before".
            const start = prev && prev.messageIndex === messageIndex && prev.player === player ? prev.before : before;
            chat_metadata.dooms_tracker.socialUndo = { messageIndex, campaign: CHAT_SCOPE, player, before: start, after: normalizeSocial(after) };
        }
    } catch (e) { /* undo is best-effort */ }
    announceRankUps(before, after);
    recordMessageEvent(messageIndex, 'social', SOCIAL_STATS.filter(st => after[st.id] !== before[st.id]).map(st => {
        const a = rankInfo(st, before[st.id]);
        const b = rankInfo(st, after[st.id]);
        return { name: st.name, add: after[st.id] - before[st.id], rank: b.rank, title: b.title, rankUp: b.rank > a.rank };
    }));
    console.log(`[Dooms Tracker] Social: ${changed} stat(s) raised`);
    saveChatScope();
    notifyStatsChanged({ source: 'ai' });
    return changed;
}

/** Before a swipe/regenerate: take back what the replaced reply added, if untouched since. */
export function revertAISocialForReplacedMessage(replacedIndex) {
    try {
        const rec = chat_metadata?.dooms_tracker?.socialUndo;
        if (!rec) return 0;
        const lastIdx = Array.isArray(chat) ? chat.length - 1 : -1;
        const idx = typeof replacedIndex === 'number' ? replacedIndex : lastIdx;
        if (rec.messageIndex !== idx && rec.messageIndex !== idx + 1) return 0;
        delete chat_metadata.dooms_tracker.socialUndo;
        const now = getSocialPoints(rec.player);
        const back = { ...now };
        let n = 0;
        for (const s of SOCIAL_STATS) {
            // Only a value still holding what the AI wrote goes back.
            if (now[s.id] === rec.after?.[s.id] && rec.before?.[s.id] !== rec.after?.[s.id]) {
                back[s.id] = rec.before[s.id];
                n++;
            }
        }
        if (n) {
            writeAll(rec.player, back);
            saveChatScope();
            notifyStatsChanged({ source: 'undo' });
        }
        saveChatData();
        return n;
    } catch (e) {
        console.warn('[Dooms Tracker] Social: undo failed', e);
        return 0;
    }
}
