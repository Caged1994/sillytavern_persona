/**
 * The chat with the Persona look (body.des-plook):
 *
 *   - the scene header on the last reply becomes a Persona 4 strip: the date
 *     big ("4/14 Th"), the time of day on black, the weather, the place;
 *   - between replies, a card when the day changes (the old date struck out,
 *     the new one big) or a banner with the new place;
 *   - under a reply, what it changed: social stats raised, bonds formed or
 *     ranked up (recorded on the message, see features/messageEvents.js).
 *
 * Called from sceneHeaders.js on every header update; rebuilds its own
 * elements (.des-pl-*) each time.
 */
import { chat } from '../../../../../../../script.js';
import { getMessageEvents } from '../features/messageEvents.js';
import { isCalendarEnabled, getNow, getEvents } from '../features/calendar.js';
import * as K from '../../utils/calendarModel.js';
import { arcanaNumber } from '../../utils/confidantModel.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "🌧️ Rain" -> the leading emoji (or ''), for the compact header. */
function weatherIcon(w) {
    const m = String(w || '').trim().match(/^(\p{Extended_Pictographic}️?)/u);
    return m ? m[1] : '';
}

function weatherText(w) {
    return String(w || '').replace(/^(\p{Extended_Pictographic}️?)\s*/u, '').trim();
}

/** The date of the scene as "4/14" + "Th", from the calendar or a free-text date. */
function dateParts(dateText) {
    let ymd = null;
    if (isCalendarEnabled()) ymd = getNow()?.date || null;
    if (!ymd && dateText) ymd = K.parseDate(dateText);
    if (!ymd) return null;
    const p = K.splitYmd(ymd);
    return { md: `${p.m}/${p.d}`, wd: K.WEEKDAY_SHORT[K.weekday(ymd)], ymd };
}

/** Time of day: the calendar's slot, else the Info Box's clock read as a slot. */
function slotLabel(timeText) {
    if (isCalendarEnabled()) {
        const now = getNow();
        if (now?.slot) return K.slotName(now.slot);
    }
    const fromClock = timeText ? K.slotFromClock(timeText) : null;
    return fromClock ? K.slotName(fromClock) : (timeText || '');
}

/**
 * The Persona 4 scene strip for the last reply (replaces the grid/stacked/
 * compact/banner headers while the look is on).
 * @param {object} data - extractSceneData() result
 */
export function createPersonaHeaderHTML(data) {
    const d = dateParts(data.date);
    const slot = slotLabel(data.time);
    const icon = weatherIcon(data.weather);
    if (!d && !slot && !data.location && !data.weather) return '';
    return `<div class="dooms-scene-header des-pl-scene">
        ${d ? `<span class="des-pl-date"><b>${esc(d.md)}</b><i>${esc(d.wd)}</i></span>` : ''}
        ${slot ? `<span class="des-pl-slot">${esc(slot)}</span>` : ''}
        ${data.weather ? `<span class="des-pl-wx" title="${esc(data.weather)}">${esc(icon || weatherText(data.weather))}</span>` : ''}
        ${data.location ? `<span class="des-pl-loc">${esc(data.location)}</span>` : ''}
    </div>`;
}

// ─── Between and under replies ─────────────────────────────────────────────

/** Where/when a reply left the story: its calendar record, else its Info Box. */
function whenOf(message) {
    const ev = getMessageEvents(message);
    if (ev.when?.date) return ev.when;
    const sid = message.swipe_id || 0;
    let box = message.extra?.dooms_tracker_swipes?.[sid]?.infoBox;
    if (typeof box === 'string') { try { box = JSON.parse(box); } catch (e) { box = null; } }
    if (!box || typeof box !== 'object') return null;
    const val = (f) => (typeof f === 'string' ? f : f?.value || '');
    const date = K.parseDate(val(box.date));
    const t = box.time;
    const clock = typeof t === 'string' ? t : (t?.start || t?.value || '');
    const w = box.weather;
    return {
        date: date || '',
        slot: clock ? K.slotFromClock(clock) || '' : '',
        place: val(box.location).trim(),
        weather: typeof w === 'object' && w ? [w.emoji, w.forecast].filter(Boolean).join(' ') : (w || ''),
    };
}

function nextDeadline(fromDate) {
    if (!isCalendarEnabled() || !fromDate) return null;
    try {
        return K.upcoming(getEvents(), fromDate, 60).find(e => e.kind === 'deadline' || e.kind === 'exam') || null;
    } catch (e) { return null; }
}

function dayCardHTML(prev, cur) {
    const p = K.splitYmd(cur.date);
    const old = prev?.date ? K.splitYmd(prev.date) : null;
    const due = nextDeadline(cur.date);
    return `<div class="des-pl-when des-pl-day">
        ${old ? `<span class="des-pl-day-old">${old.m}/${old.d}</span>` : ''}
        <span class="des-pl-day-new">${p.m}/${p.d}<small>${esc(K.WEEKDAYS[K.weekday(cur.date)])}</small></span>
        ${cur.weather ? `<span class="des-pl-day-wx" title="${esc(cur.weather)}">${esc(weatherIcon(cur.weather) || weatherText(cur.weather))}</span>` : ''}
        <span class="des-pl-day-tags">
            ${cur.slot ? `<span class="des-pl-tag is-light">${esc(K.slotName(cur.slot))}</span>` : ''}
            ${cur.place ? `<span class="des-pl-tag is-light">${esc(cur.place)}</span>` : ''}
            ${due ? `<span class="des-pl-tag">${esc(due.title)} · ${esc(due.days === 0 ? 'today' : `${due.days} day${due.days === 1 ? '' : 's'}`)}</span>` : ''}
        </span>
    </div>`;
}

function placeBannerHTML(cur) {
    return `<div class="des-pl-when des-pl-place"><span class="des-pl-place-line"></span><span class="des-pl-place-name">${esc(cur.place)}</span><span class="des-pl-place-line"></span></div>`;
}

function notesHTML(ev) {
    const out = [];
    const a = ev.activity;
    if (a) {
        out.push(a.kind === 'hangout'
            ? `<div class="des-pl-note is-free"><span class="des-pl-note-tag">${esc(K.slotName(a.slot || 'afternoon'))}</span>
                <span>Time with ${esc(a.name)}${a.arcana ? ` · ${esc(a.arcana)}` : ''}</span><span class="des-pl-note-up">+${esc(a.points)}${a.match ? ' — a stronger bond' : ''}</span></div>`
            : `<div class="des-pl-note is-free"><span class="des-pl-note-tag">${esc(K.slotName(a.slot || 'afternoon'))}</span>
                <span>${esc(a.name)}</span>${a.desc ? `<span class="des-pl-note-up">${esc(a.desc)}</span>` : ''}</div>`);
    }
    for (const s of ev.social || []) {
        out.push(`<div class="des-pl-note"><span class="des-pl-note-tag">${esc(s.name)}</span>
            <span class="des-pl-note-up">▲ +${esc(s.add)}${s.rankUp ? ` — rank ${esc(s.rank)}: ${esc(s.title)}` : ''}</span></div>`);
    }
    for (const b of ev.bonds || []) {
        const num = arcanaNumber(b.arcana);
        out.push(`<div class="des-pl-bond${b.kind === 'new' ? ' is-new' : ''}">
            <span class="des-pl-card"><small>${esc(b.arcana)}</small><b>${esc(num)}</b></span>
            <span class="des-pl-bond-text">
                <i>${b.kind === 'new' ? 'I am thou… thou art I… thou hast established a new bond.' : 'Thou art I… and I am thou…'}</i>
                <b>${esc(b.arcana)} <em>Rank ${esc(b.rank)}</em> — ${esc(b.name)}</b>
            </span>
            <span class="des-pl-pips">${Array.from({ length: 10 }, (_, i) => `<i class="${i < b.rank ? 'on' : ''}"></i>`).join('')}</span>
        </div>`);
    }
    return out.length ? `<div class="des-pl-notes">${out.join('')}</div>` : '';
}

/** Rebuilds the day/place cards and the notes for every rendered message. */
export function renderPersonaChat() {
    $('.des-pl-when, .des-pl-notes').remove();
    if (!Array.isArray(chat)) return;
    let prev = null;
    $('#chat .mes').each(function () {
        const $mes = $(this);
        const id = parseInt($mes.attr('mesid'), 10);
        const message = Number.isFinite(id) ? chat[id] : null;
        if (!message || message.is_system) return;
        if (message.is_user) {
            // Free time: what the picked activity gave, under the line that spent it.
            const notes = notesHTML(getMessageEvents(message));
            if (notes) {
                const $text = $mes.find('.mes_text').first();
                if ($text.length) $text.after(notes); else $mes.append(notes);
            }
            return;
        }
        const cur = whenOf(message);
        if (cur) {
            const dayChanged = cur.date && prev?.date && cur.date !== prev.date;
            const placeChanged = cur.place && prev?.place && cur.place.toLowerCase() !== prev.place.toLowerCase();
            if (dayChanged) $mes.before(dayCardHTML(prev, cur));
            else if (placeChanged) $mes.before(placeBannerHTML(cur));
            prev = { ...(prev || {}), ...Object.fromEntries(Object.entries(cur).filter(([, v]) => v)) };
        }
        const notes = notesHTML(getMessageEvents(message));
        if (notes) {
            const $text = $mes.find('.mes_text').first();
            if ($text.length) $text.after(notes); else $mes.append(notes);
        }
    });
}

/** Takes the look's chat elements away (look switched off). */
export function removePersonaChat() {
    $('.des-pl-when, .des-pl-notes').remove();
}
