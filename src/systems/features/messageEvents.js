/**
 * What a reply changed, kept on the message itself so the chat can show it
 * next to that reply (src/systems/rendering/personaChat.js):
 *
 *   chat[i].extra.des_events = { [swipeId]: { social: [...], bonds: [...], when: {...} } }
 *
 *   social: [{ name, add, rank, title, rankUp }]
 *   bonds:  [{ name, arcana, rank, kind: 'new' | 'up' }]
 *   when:   { date: 'YYYY-MM-DD', slot, place, weather }   (the calendar after the reply)
 *
 * Per swipe, so another swipe of the same reply shows its own changes.
 */
import { chat } from '../../../../../../../script.js';

function messageAt(index) {
    const m = typeof index === 'number' ? chat?.[index] : null;
    return m && !m.is_user ? m : null;
}

/** Records one kind of change for the reply at `index` (replacing that kind). */
export function recordMessageEvent(index, kind, value) {
    const m = messageAt(index);
    if (!m) return;
    try {
        if (!m.extra) m.extra = {};
        if (!m.extra.des_events || typeof m.extra.des_events !== 'object') m.extra.des_events = {};
        const sid = m.swipe_id || 0;
        const rec = m.extra.des_events[sid] || (m.extra.des_events[sid] = {});
        if (value === null || value === undefined || (Array.isArray(value) && !value.length)) delete rec[kind];
        else rec[kind] = value;
    } catch (e) { /* cosmetic record */ }
}

/** The changes recorded for a message's shown swipe ({} when none). */
export function getMessageEvents(message) {
    if (!message || message.is_user) return {};
    const sid = message.swipe_id || 0;
    const rec = message.extra?.des_events?.[sid];
    return rec && typeof rec === 'object' ? rec : {};
}
