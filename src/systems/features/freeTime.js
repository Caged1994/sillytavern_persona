/**
 * Free time — spending a time of day (rules in utils/activityModel.js).
 *
 * The Calendar tab lists what can be done now: activities (the card's
 * "Activity: …" lorebook entries, else a generic set) and the Confidants
 * who are around (their "When:" line, if any). Picking one writes a line in
 * the chat box — edit it as you like. When it is sent, the game applies the
 * effects (social points, money, HP/SP, bond points: more with a Persona of
 * the Confidant's Arcana in the stock), moves the calendar on by one time of
 * day and tells the AI to narrate it without awarding it again. Erase the
 * line and write something else, and nothing happens.
 *
 * After an Otherworld visit the next time of day is spent recovering (P5):
 * only Rest is open then.
 */
import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles, chat } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { getReadableWorldNames, loadWorldData } from '../lorebook/lorebookAPI.js';
import { getPersonaName, getCurrentStatValues, setCurrentStatValue, getStatSheet, notifyStatsChanged } from './characterStats.js';
import { isCalendarEnabled, getNow, getDay, advance, isTired, CALENDAR_CHANGED_EVENT } from './calendar.js';
import { isSocialEnabled, getSocialPoints, setSocialPoints } from './characterSocial.js';
import { isConfidantsEnabled, getBonds, addConfidantPoints } from './characterConfidants.js';
import { isMoneyEnabled, getMoney, setMoney, hasPurse } from './characterMoney.js';
import { getPersonas, isPersonasEnabled } from './characterPersonas.js';
import { getProgress, isProgressEnabled } from './characterProgress.js';
import { recordMessageEvent } from './messageEvents.js';
import { activeStats } from '../../utils/statsModel.js';
import { SOCIAL_STATS, rankInfo, clampPoints } from '../../utils/socialModel.js';
import { MAX_RANK as CONFIDANT_MAX } from '../../utils/confidantModel.js';
import * as A from '../../utils/activityModel.js';
import * as K from '../../utils/calendarModel.js';

const SLOT_PROMPT = 'dooms-free-time';

export function isFreeTimeEnabled() {
    return isCalendarEnabled() && extensionSettings.freeTimeEnabled !== false;
}

export function setFreeTimeEnabled(on) {
    extensionSettings.freeTimeEnabled = !!on;
    saveSettings();
    notifyStatsChanged({ source: 'calendar' });
}

// ─── The card's activities ──────────────────────────────────────────────────

let book = { list: [], books: [], at: 0 };
let loading = null;

export function refreshActivityBook({ force = false } = {}) {
    if (loading) return loading;
    loading = (async () => {
        const books = [...getReadableWorldNames()];
        const entries = [];
        for (const b of books) {
            try { entries.push(...Object.values((await loadWorldData(b, force))?.entries || {})); } catch (e) { /* skip */ }
        }
        book = { list: A.parseActivityBook(entries), books, at: Date.now() };
        try { window.dispatchEvent(new CustomEvent(CALENDAR_CHANGED_EVENT)); } catch (e) { /* no window */ }
        return book.list;
    })().finally(() => { loading = null; });
    return loading;
}

function bookActivities() {
    let books = [];
    try { books = [...getReadableWorldNames()]; } catch (e) { books = []; }
    const same = books.length === book.books.length && books.every((b, i) => b === book.books[i]);
    if (!same || Date.now() - book.at > 60000) refreshActivityBook().catch(() => {});
    return book.list;
}

/** For tests: use this list as the lorebook's activities. */
export function setActivitiesForTests(list) {
    let books = [];
    try { books = [...getReadableWorldNames()]; } catch (e) { books = []; }
    book = { list: (list || []).map(A.normalizeActivity).filter(Boolean), books, at: Date.now() };
}

export function getActivities() {
    return A.activityList(bookActivities());
}

// ─── What is open now ───────────────────────────────────────────────────────

function moment() {
    const now = getNow();
    if (!now) return null;
    return { ...now, weekday: K.weekday(now.date), weather: getDay(now.date)?.weather || '', tired: isTired() };
}

function playerLevel(player) {
    try { return isProgressEnabled() ? getProgress(player, true).level : 1; } catch (e) { return 1; }
}

/** Whether a Persona of this Arcana is in the player's stock. */
function arcanaMatch(player, arcana) {
    if (!isPersonasEnabled()) return false;
    try { return getPersonas(player, true).some(p => p.arcana === arcana); } catch (e) { return false; }
}

/**
 * What can be done now: { now, tired, activities: [{ ...activity, effects }],
 * people: [{ name, arcana, rank, points, match, where }] } — or null without a date.
 */
export function freeTimeNow() {
    if (!isFreeTimeEnabled()) return null;
    const m = moment();
    if (!m) return null;
    const player = getPersonaName();
    const level = playerLevel(player);
    const activities = A.availableActivities(getActivities(), m).map(a => ({ ...a, now: A.effectsNow(a, { weather: m.weather, level }) }));
    const people = [];
    if (isConfidantsEnabled() && !m.tired) {
        for (const b of getBonds()) {
            if (b.rank >= CONFIDANT_MAX) continue;
            if (b.def?.when && !A.fits(b.def.when, m.weekday, m.slot)) continue;
            const match = arcanaMatch(player, b.arcana);
            people.push({ name: b.name, arcana: b.arcana, rank: b.rank, progress: b.progress, where: b.def?.where || '', match, points: A.hangoutPoints(match) });
        }
    }
    return { now: m, tired: m.tired, activities, people };
}

// ─── Picking one (the chat box) ─────────────────────────────────────────────

let pending = null; // { kind, id, name, text, at: { date, slot } }

export function getPendingFreeTime() {
    return pending ? { ...pending } : null;
}

function chatBox() {
    return document.getElementById('send_textarea');
}

function fillChatBox(text) {
    const ta = chatBox();
    if (!ta) return false;
    ta.value = text;
    try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { /* old browser */ }
    try { ta.focus(); ta.setSelectionRange(text.length, text.length); } catch (e) { /* not focusable */ }
    return true;
}

/** Puts an activity's line in the chat box. Returns { text } or { error }. */
export function pickActivity(id) {
    const ft = freeTimeNow();
    if (!ft) return { error: 'Set a date in the calendar first.' };
    const a = ft.activities.find(x => x.id === id);
    if (!a) return { error: ft.tired ? 'Too tired for that now — only rest.' : 'Not open at this time.' };
    const player = getPersonaName() || 'I';
    const text = A.activityText(a.text, { user: player, slot: K.slotName(ft.now.slot).toLowerCase(), where: a.where });
    pending = { kind: 'activity', id: a.id, name: a.name, text, at: { date: ft.now.date, slot: ft.now.slot } };
    if (!fillChatBox(text)) return { error: 'The chat box is not there.' };
    notifyStatsChanged({ source: 'calendar' });
    return { text };
}

/** Puts a hangout with a Confidant in the chat box. */
export function pickHangout(name) {
    const ft = freeTimeNow();
    if (!ft) return { error: 'Set a date in the calendar first.' };
    const p = ft.people.find(x => x.name.toLowerCase() === String(name).toLowerCase());
    if (!p) return { error: `${name} is not around now.` };
    const player = getPersonaName() || 'I';
    const text = A.activityText(null, { user: player, slot: K.slotName(ft.now.slot).toLowerCase(), who: p.name, where: p.where });
    pending = { kind: 'hangout', id: p.name, name: p.name, text, at: { date: ft.now.date, slot: ft.now.slot } };
    if (!fillChatBox(text)) return { error: 'The chat box is not there.' };
    notifyStatsChanged({ source: 'calendar' });
    return { text };
}

export function cancelFreeTime() {
    if (!pending) return;
    const ta = chatBox();
    if (ta && ta.value === pending.text) fillChatBox('');
    pending = null;
    notifyStatsChanged({ source: 'calendar' });
}

/** Whether the sent message is still the picked line (edited is fine). */
function stillThePick(message, p) {
    const sent = String(message || '').replace(/[*_]/g, '').toLowerCase();
    const want = p.text.replace(/[*_]/g, '').toLowerCase();
    const head = want.slice(0, Math.min(18, want.length));
    return sent.includes(head) || sent.includes(p.name.toLowerCase());
}

// ─── Applying it (on send) ──────────────────────────────────────────────────

function applyEffects(player, e) {
    const out = { social: [], money: 0, hp: 0, sp: 0 };
    if (isSocialEnabled()) {
        const pts = getSocialPoints(player);
        for (const [id, n] of Object.entries(e.social || {})) {
            const stat = SOCIAL_STATS.find(s => s.id === id);
            if (!stat || !n) continue;
            const before = pts[id] || 0;
            const after = clampPoints(before + n);
            if (after === before) continue;
            setSocialPoints(player, id, after);
            const a = rankInfo(stat, before);
            const b = rankInfo(stat, after);
            out.social.push({ name: stat.name, add: after - before, rank: b.rank, title: b.title, rankUp: b.rank > a.rank });
        }
    }
    if (e.money && isMoneyEnabled() && hasPurse(player, true)) {
        setMoney(player, true, (getMoney(player, true) || 0) + e.money);
        out.money = e.money;
    }
    const sheet = activeStats(getStatSheet(player, true));
    const cur = getCurrentStatValues(player, true, sheet);
    for (const [k, id] of [['hp', 'health'], ['sp', 'mana']]) {
        if (!e[k] || !sheet.some(s => s.id === id)) continue;
        setCurrentStatValue(player, true, id, Math.min(100, (Number(cur[id]) || 0) + e[k]), { persist: false });
        out[k] = e[k];
    }
    return out;
}

/** What the AI is told for the reply to this message. */
function promptNote(player, slot, done) {
    const next = K.slotName(K.nextSlot({ date: '2000-01-01', slot }).slot).toLowerCase();
    const what = done.kind === 'hangout'
        ? `${player} spent the ${K.slotName(slot).toLowerCase()} with ${done.name}${done.match ? ' and felt a stronger bond than usual' : ''} (their bond grew).`
        : `${player} spent the ${K.slotName(slot).toLowerCase()} on: ${done.name}${done.desc ? ` (${done.desc})` : ''}.`;
    return `[FREE TIME — ${what} The game has already applied it: narrate that time briefly in the story, give no social stat or Confidant points for it, and end the scene in the ${next}.]`;
}

/**
 * MESSAGE_SENT: if the message is the picked line, apply the activity and
 * move the calendar on. Clears the previous free-time note otherwise.
 */
export function onFreeTimeMessageSent() {
    try { setExtensionPrompt(SLOT_PROMPT, '', extension_prompt_types.IN_CHAT, 0, false); } catch (e) { /* no slot */ }
    const p = pending;
    if (!p) return null;
    const idx = Array.isArray(chat) ? chat.length - 1 : -1;
    const msg = idx >= 0 ? chat[idx] : null;
    pending = null;
    if (!msg || !msg.is_user || !stillThePick(msg.mes, p)) { notifyStatsChanged({ source: 'calendar' }); return null; }
    const now = getNow();
    if (!now || now.date !== p.at.date || now.slot !== p.at.slot) return null;
    const player = getPersonaName();
    let done;
    if (p.kind === 'activity') {
        const a = getActivities().find(x => x.id === p.id);
        if (!a) return null;
        const e = A.effectsNow(a, { weather: getDay(now.date)?.weather || '', level: playerLevel(player) });
        const got = applyEffects(player, e);
        done = { kind: 'activity', name: a.name, desc: A.describeEffects({ social: Object.fromEntries(got.social.map(s => [SOCIAL_STATS.find(x => x.name === s.name)?.id, s.add])), money: got.money, hp: got.hp, sp: got.sp }), social: got.social };
    } else {
        const bond = getBonds().find(b => b.name === p.id);
        if (!bond) return null;
        const match = arcanaMatch(player, bond.arcana);
        const pts = A.hangoutPoints(match);
        const r = addConfidantPoints(bond.name, pts);
        done = { kind: 'hangout', name: bond.name, arcana: bond.arcana, match, points: pts, rankUp: r?.ranksGained ? r.rec.rank : 0 };
        if (match) { try { globalThis.toastr?.info(`A Persona of the ${bond.arcana} Arcana is with you: you feel a stronger bond with ${bond.name}.`, 'Confidant', { timeOut: 5000 }); } catch (e) { /* no toasts */ } }
    }
    recordMessageEvent(idx, 'activity', { kind: done.kind, name: done.name, desc: done.desc || '', arcana: done.arcana || '', match: !!done.match, points: done.points || 0, slot: now.slot });
    if (done.social?.length) recordMessageEvent(idx, 'social', done.social);
    if (done.kind === 'hangout' && done.rankUp) recordMessageEvent(idx, 'bonds', [{ name: done.name, arcana: done.arcana, rank: done.rankUp, kind: 'up' }]);
    try { setExtensionPrompt(SLOT_PROMPT, promptNote(player, now.slot, done), extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM); } catch (e) { /* no slot */ }
    advance('slot');
    notifyStatsChanged({ source: 'calendar' });
    console.log(`[Dooms Tracker] Free time: ${done.kind} "${done.name}" applied${done.desc ? ` (${done.desc})` : ''}${done.points ? ` (+${done.points} bond points${done.match ? ', Arcana bonus' : ''})` : ''}`);
    return done;
}

/** For the prompt when worn out (the slot after a dungeon). */
export function buildFreeTimePromptForGeneration() {
    if (!isFreeTimeEnabled() || !isTired()) return '';
    const player = getPersonaName() || 'The player';
    return `WORN OUT — ${player} is exhausted after the Otherworld: there is no energy for anything but resting this ${K.slotName(getNow().slot).toLowerCase()}.`;
}
