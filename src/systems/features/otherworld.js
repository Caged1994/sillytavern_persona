/**
 * The Otherworld — the places the party explores, kept in the chat (rules in
 * siteModel.js; runs use the dungeon of dungeon.js).
 *
 *   chat_metadata.dooms_tracker.betterStats.otherworld =
 *     { sites: [site], news: [{ name, on }] }
 *
 * Sites come from lorebook entries ("Dungeon: …"), from the story (the AI's
 * "otherworld" key) or by hand. A labyrinth's blocks open at the start, on a
 * date, when a domain is cleared, by hand or when the story says so; a
 * domain closes when its deadline passes uncleared, and stays open to
 * revisit once cleared. Every run takes one time of day on the calendar.
 */
import { chat, chat_metadata } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import { chatStore, saveChatScope, CHAT_SCOPE } from './chatScope.js';
import { notifyStatsChanged, getPersonaName } from './characterStats.js';
import { getProgress, isProgressEnabled } from './characterProgress.js';
import { getActiveWorldNames, loadWorldData } from '../lorebook/lorebookAPI.js';
import { isDungeonEnabled, createDungeon, setRunEndHook } from './dungeon.js';
import * as Cal from './calendar.js';
import * as K from '../../utils/siteModel.js';
import * as D from '../../utils/dungeonModel.js';

export const OTHERWORLD_CHANGED_EVENT = 'dooms:otherworld';

export function isOtherworldEnabled() {
    return isDungeonEnabled() && extensionSettings.otherworldEnabled !== false;
}

export function setOtherworldEnabled(on) {
    extensionSettings.otherworldEnabled = !!on;
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
}

export function isReaperOn() {
    return extensionSettings.reaperEnabled !== false;
}

export function setReaperOn(on) {
    extensionSettings.reaperEnabled = !!on;
    saveSettings();
}

// ─── Storage ────────────────────────────────────────────────────────────────

function store(create = false) {
    const s = chatStore('otherworld', create);
    if (s) {
        if (!Array.isArray(s.sites)) s.sites = [];
        if (!Array.isArray(s.news)) s.news = [];
    }
    return s;
}

const snapshot = () => {
    const s = store();
    return s ? JSON.parse(JSON.stringify({ sites: s.sites, news: s.news })) : { sites: [], news: [] };
};

function restore(snap) {
    const s = store(true);
    if (!s) return;
    s.sites = JSON.parse(JSON.stringify(snap.sites || []));
    s.news = JSON.parse(JSON.stringify(snap.news || []));
}

function changed() {
    saveChatScope();
    notifyStatsChanged({ source: 'otherworld' });
    try { window.dispatchEvent(new CustomEvent(OTHERWORLD_CHANGED_EVENT)); } catch (e) { /* no window */ }
}

function toast(kind, text, title = 'Otherworld') {
    try { globalThis.toastr?.[kind]?.(text, title, { timeOut: 5000 }); } catch (e) { /* no toasts */ }
}

const today = () => { try { return Cal.isCalendarEnabled() ? Cal.getNow()?.date || null : null; } catch (e) { return null; } };
const yearNow = () => (today() ? Number(today().slice(0, 4)) : null);

// ─── Lorebook ───────────────────────────────────────────────────────────────

let book = { list: [], books: [], at: 0 };
let loading = null;

export function refreshSiteBook({ force = false } = {}) {
    if (loading) return loading;
    loading = (async () => {
        const books = [...getActiveWorldNames()];
        const entries = [];
        for (const b of books) {
            try {
                const data = await loadWorldData(b, force);
                entries.push(...Object.values(data?.entries || {}));
            } catch (e) { /* unreadable lorebook: skip */ }
        }
        book = { list: K.parseSiteBook(entries, { year: yearNow() }), books, at: Date.now() };
        try { window.dispatchEvent(new CustomEvent(OTHERWORLD_CHANGED_EVENT)); } catch (e) { /* no window */ }
        return book.list;
    })().finally(() => { loading = null; });
    return loading;
}

function bookSites() {
    let books = [];
    try { books = [...getActiveWorldNames()]; } catch (e) { books = []; }
    const same = books.length === book.books.length && books.every((b, i) => b === book.books[i]);
    if (!same || Date.now() - book.at > 60000) refreshSiteBook().catch(() => {});
    return book.list;
}

/** For tests: use this list as the lorebook's sites. */
export function setBookSitesForTests(list) {
    let books = [];
    try { books = [...getActiveWorldNames()]; } catch (e) { books = []; }
    book = { list: list || [], books, at: Date.now() };
}

/** Lorebook sites not in the chat yet join it (their progress lives in the chat). */
function syncFromBook(s) {
    let added = 0;
    for (const def of bookSites()) {
        if (s.sites.some(x => K.siteKey(x.name) === K.siteKey(def.name))) continue;
        if (s.sites.length >= K.MAX_SITES) break;
        const site = K.normalizeSite({ ...def, id: undefined });
        s.sites.push(site);
        linkDeadline(site);
        added++;
    }
    return added;
}

// ─── The calendar ───────────────────────────────────────────────────────────

function linkDeadline(site) {
    if (site.kind !== 'domain' || !site.deadline || site.eventId) return;
    try {
        if (!Cal.isCalendarEnabled()) return;
        const r = Cal.addEvent({ date: site.deadline, title: `${site.name} — deadline`, kind: 'deadline', source: site.source === 'lorebook' ? 'ai' : site.source });
        if (r.event) site.eventId = r.event.id;
    } catch (e) { /* calendar unavailable */ }
}

/**
 * Brings the sites up to date with the calendar: hidden ones appear, blocks
 * whose date or condition came open, domains whose deadline passed close.
 * @returns {boolean} whether something changed
 */
export function tick() {
    const s = store();
    if (!s || !isOtherworldEnabled()) return false;
    const now = today();
    let changedAny = syncFromBook(s) > 0;
    const cleared = s.sites.filter(x => x.kind === 'domain' && x.status === 'cleared').map(x => x.name);
    for (const site of s.sites) {
        if (site.status === 'hidden' && site.appears && now && site.appears <= now) {
            site.status = 'open';
            linkDeadline(site);
            toast('info', `${site.name} has appeared.`);
            changedAny = true;
        }
        for (const i of K.dueUnlocks(site, { today: now, clearedSites: cleared })) {
            site.blocks[i].unlocked = true;
            toast('info', `${site.name}: ${site.blocks[i].name || `block ${i + 1}`} is open.`);
            changedAny = true;
        }
        if (K.missedDeadline(site, now)) {
            site.status = 'closed';
            site.closedOn = now;
            site.saved = null;
            s.news.push({ name: site.name, on: now });
            toast('warning', `${site.name} is gone: the deadline passed.`);
            changedAny = true;
        }
    }
    if (s.news.length > 10) s.news.splice(0, s.news.length - 10);
    if (changedAny) changed();
    return changedAny;
}

try { window.addEventListener?.(Cal.CALENDAR_CHANGED_EVENT, () => { try { tick(); } catch (e) { /* no chat */ } }); } catch (e) { /* no window */ }

// ─── Reading ────────────────────────────────────────────────────────────────

export function getSites({ all = false } = {}) {
    const s = store(true);
    if (!s) return [];
    if (syncFromBook(s)) changed();
    const list = s.sites.map(K.normalizeSite).filter(Boolean);
    return all ? list : list.filter(x => x.status !== 'hidden');
}

export function getSite(idOrName) {
    const k = K.siteKey(idOrName);
    return getSites({ all: true }).find(x => x.id === idOrName || K.siteKey(x.name) === k) || null;
}

function editSite(id, fn) {
    const s = store(true);
    const i = s.sites.findIndex(x => x.id === id);
    if (i === -1) return null;
    const next = fn(K.normalizeSite(s.sites[i]));
    if (!next) return null;
    s.sites[i] = K.normalizeSite(next);
    changed();
    return s.sites[i];
}

// ─── Changing them by hand ──────────────────────────────────────────────────

export function addSite(raw) {
    const s = store(true);
    if (!s) return { error: 'No chat is open.' };
    const site = K.normalizeSite({ ...raw, id: undefined });
    if (!site) return { error: 'Give the place a name.' };
    if (s.sites.some(x => K.siteKey(x.name) === K.siteKey(site.name))) return { error: `${site.name} is already there.` };
    if (s.sites.length >= K.MAX_SITES) return { error: `At most ${K.MAX_SITES} places.` };
    linkDeadline(site);
    s.sites.push(site);
    changed();
    return { site };
}

export function removeSite(id) {
    const s = store(true);
    const i = s.sites.findIndex(x => x.id === id);
    if (i === -1) return false;
    const [site] = s.sites.splice(i, 1);
    if (site.eventId) { try { Cal.removeEvent(site.eventId); } catch (e) { /* calendar off */ } }
    changed();
    return true;
}

export function setBlockUnlocked(id, block, on = true) {
    return editSite(id, (site) => {
        if (site.kind !== 'labyrinth' || !site.blocks[block] || block === 0) return null;
        site.blocks[block].unlocked = !!on;
        return site;
    });
}

export function addRequest(id, raw) {
    return editSite(id, (site) => {
        if (site.kind !== 'labyrinth' || site.requests.length >= K.MAX_REQUESTS) return null;
        const r = K.normalizeRequest(raw);
        if (!r) return null;
        r.floor = Math.min(r.floor, K.totalFloors(site));
        site.requests.push(r);
        return site;
    });
}

export function removeRequest(id, requestId) {
    return editSite(id, (site) => { site.requests = site.requests.filter(r => r.id !== requestId); return site; });
}

// ─── Runs ───────────────────────────────────────────────────────────────────

/** Where a labyrinth run can start ([{ block, floor, name }]). */
export function startPoints(id) {
    const site = getSite(id);
    return site && site.kind === 'labyrinth' ? K.checkpoints(site) : [];
}

/** Whether a site can be entered, and why not. */
export function canEnter(site) {
    if (!site) return { ok: false, reason: 'No such place.' };
    if (site.status === 'closed') return { ok: false, reason: `${site.name} is gone.` };
    if (site.status === 'hidden') return { ok: false, reason: `${site.name} has not appeared yet.` };
    if (site.kind === 'labyrinth' && !K.checkpoints(site).length) return { ok: false, reason: 'Nothing of it is open yet.' };
    return { ok: true };
}

/** Puts the requests of a labyrinth into the run's floors (one elite fight each). */
function placeRequests(state, site, run) {
    for (const r of site.requests) {
        if (r.done) continue;
        const idx = r.floor - 1 - run.floorOffset;
        const f = state.floors[idx];
        if (!f) continue;
        const room = Object.values(f.rooms).find(x => x.type === 'combat' && !x.request) || Object.values(f.rooms).find(x => x.type === 'empty');
        if (!room) continue;
        room.type = 'combat';
        room.cleared = false;
        room.request = r.id;
        room.requestTitle = r.title;
        room.enemies = [{ tier: 'elite', levelDelta: 1, level: Math.min(99, (run.levels[idx] || 1) + 2), name: r.title.slice(0, 40), description: `The target of a request: ${r.title}.` }];
        room.name = room.name || r.title.slice(0, 40);
    }
}

/**
 * Starts a run. A domain picks up where it was left (at its last safe room);
 * a labyrinth builds fresh floors from the chosen checkpoint.
 * @returns {Promise<{ state, aiError?: string } | { error }>}
 */
export async function enterSite(id, party, { block = 0, useAI = true, generate } = {}) {
    const site = getSite(id);
    const can = canEnter(site);
    if (!can.ok) return { error: can.reason };
    if (!party?.length) return { error: 'Choose who goes in.' };
    const ai = generate ? { generate } : {};
    if (site.kind === 'domain') {
        if (site.saved && site.status === 'open') {
            const st = JSON.parse(JSON.stringify(site.saved));
            st.party = party.map(p => ({ name: p.name, isUser: !!p.isUser }));
            st.partySize = party.length;
            st.phase = 'active';
            st.result = null;
            st.finished = false;
            st.pendingFight = null;
            D.addLog(st, `You return to ${site.name}.`, 'info');
            return { state: st, resumed: true };
        }
        const run = K.domainRun(site);
        const theme = [site.theme, site.ruler ? `It belongs to ${site.ruler}, who waits at its heart.` : ''].filter(Boolean).join(' ');
        const res = await createDungeon(party, { theme: `${site.name}: ${theme}`.trim(), floors: run.floors, size: 'medium', useAI, seed: site.seed, gen: { levels: run.levels, lastIsBoss: run.lastIsBoss, maxFloors: K.MAX_AREAS }, ...ai });
        res.state.title = res.state.title || site.name;
        res.state.site = { id: site.id, kind: 'domain' };
        if (site.ruler) {
            const last = res.state.floors[res.state.floors.length - 1];
            const boss = Object.values(last.rooms).find(r => r.type === 'boss');
            if (boss?.enemies?.[0]) boss.enemies[0] = { ...boss.enemies[0], name: site.ruler.slice(0, 40) };
        }
        return res;
    }
    const cp = K.checkpoints(site).find(c => c.block === block) || K.checkpoints(site)[0];
    const run = K.labyrinthRun(site, cp.block);
    const res = await createDungeon(party, {
        theme: `${site.name}${site.theme ? `: ${site.theme}` : ''} — floors ${run.floorOffset + 1}-${run.floorOffset + run.floors}`,
        floors: run.floors, size: 'medium', useAI, seed: Date.now(),
        gen: { levels: run.levels, floorOffset: run.floorOffset, lastIsBoss: run.lastIsBoss, maxFloors: D.MAX_SITE_FLOORS, reaper: site.reaper && isReaperOn() ? { name: site.reaper } : null },
        ...ai,
    });
    res.state.title = res.state.title || site.name;
    res.state.site = { id: site.id, kind: 'labyrinth', block: cp.block };
    placeRequests(res.state, site, run);
    return res;
}

/** What a run did to its site (called once when the run is closed). */
export function recordRun(state) {
    const ref = state?.site;
    if (!ref) return null;
    const s = store(true);
    const i = s.sites.findIndex(x => x.id === ref.id);
    if (i === -1) return null;
    const site = K.normalizeSite(s.sites[i]);
    const notes = [];
    if (site.kind === 'labyrinth') {
        const reached = (state.floorOffset || 0) + (state.stats?.floors || 1);
        site.deepest = Math.max(site.deepest || 0, reached);
        if (state.result === 'cleared' && state.lastIsBoss !== false && site.blocks[ref.block]) {
            site.blocks[ref.block].cleared = true;
            notes.push(`${site.blocks[ref.block].name || `Block ${ref.block + 1}`} guardian beaten`);
        }
        for (const rid of state.requestsDone || []) {
            const r = site.requests.find(x => x.id === rid);
            if (r && !r.done) { r.done = true; notes.push(`request done: ${r.title}`); }
        }
    } else if (state.result === 'cleared' && site.status === 'open') {
        site.status = 'cleared';
        site.saved = null;
        if (site.eventId) { try { Cal.setEventDone(site.eventId, true); } catch (e) { /* calendar off */ } }
        notes.push(`${site.name} cleared`);
    } else if (site.status === 'open') {
        // Kept for the next visit, back at the last safe room (or the entrance).
        const keep = JSON.parse(JSON.stringify(state));
        const cp = keep.checkpoint;
        if (cp && keep.floors[cp.floor]?.rooms[cp.room]) { keep.floor = cp.floor; keep.at = cp.room; } else { keep.floor = 0; keep.at = keep.floors[0].start; }
        keep.from = null;
        keep.log = keep.log.slice(-20);
        site.saved = keep;
    }
    s.sites[i] = K.normalizeSite(site);
    // A run takes a time of day.
    try { if (Cal.isCalendarEnabled() && Cal.getNow()) Cal.advance('slot'); } catch (e) { /* calendar off */ }
    changed();
    tick();
    return { site: s.sites[i], notes };
}

setRunEndHook(recordRun);

// ─── The AI ─────────────────────────────────────────────────────────────────

export function buildOtherworldPromptForGeneration({ compact = true, standalone = false } = {}) {
    if (!isOtherworldEnabled()) return '';
    tick();
    const now = today();
    const s = store();
    const news = (s?.news || []).filter(n => !now || !n.on || (Date.parse(now) - Date.parse(n.on)) / 86400000 <= 3).map(n => n.name);
    return K.buildOtherworldPrompt({ sites: getSites(), today: now, closedNews: news, compact, standalone });
}

export function buildOtherworldContextSummary() {
    if (!isOtherworldEnabled()) return '';
    const sites = getSites().filter(x => x.status === 'open');
    if (!sites.length) return '';
    const now = today();
    return 'Otherworld: ' + sites.map(x => (x.kind === 'domain' && x.deadline && now ? `${x.name} (${K.daysLeft(x, now)} days left)` : x.name)).join(', ');
}

/** Applies the "otherworld" key of a fresh reply. Returns how many changes. */
export function applyAIOtherworld(raw, messageIndex) {
    if (!isOtherworldEnabled() || raw === null || raw === undefined) return 0;
    const ch = K.normalizeAIOtherworld(raw, { year: yearNow() });
    if (!ch) return 0;
    const before = snapshot();
    let n = 0;
    for (const a of ch.add) {
        const r = addSite({ ...a, level: a.level || partyLevelGuess() });
        if (r.site) { n++; toast('info', `A new place: ${r.site.name}${r.site.deadline ? ` (deadline ${r.site.deadline})` : ''}.`); }
    }
    for (const u of ch.unlock) {
        const site = getSite(u.site);
        if (!site || site.kind !== 'labyrinth') continue;
        const idx = u.block !== null && u.block !== undefined ? u.block : site.blocks.findIndex(b => !b.unlocked);
        if (idx > 0 && setBlockUnlocked(site.id, idx, true)) { n++; toast('info', `${site.name}: ${site.blocks[idx].name || `block ${idx + 1}`} is open.`); }
    }
    for (const r of ch.requests) {
        const site = getSite(r.site);
        if (site && addRequest(site.id, { ...r, source: 'ai' })) n++;
    }
    for (const a of ch.appear) {
        const site = getSite(a);
        if (site && site.status === 'hidden' && editSite(site.id, (x) => { x.status = 'open'; return x; })) { n++; linkDeadline(site); }
    }
    if (!n) return 0;
    try {
        if (chat_metadata) {
            if (!chat_metadata.dooms_tracker) chat_metadata.dooms_tracker = {};
            const prev = chat_metadata.dooms_tracker.otherworldUndo;
            const start = prev && prev.messageIndex === messageIndex ? prev.before : before;
            chat_metadata.dooms_tracker.otherworldUndo = { messageIndex, campaign: CHAT_SCOPE, before: start, after: snapshot() };
        }
    } catch (e) { /* undo is best-effort */ }
    changed();
    return n;
}

/** Before a swipe/regenerate: put back what the replaced reply changed, if untouched since. */
export function revertAIOtherworldForReplacedMessage(replacedIndex) {
    try {
        const rec = chat_metadata?.dooms_tracker?.otherworldUndo;
        if (!rec) return 0;
        const lastIdx = Array.isArray(chat) ? chat.length - 1 : -1;
        const idx = typeof replacedIndex === 'number' ? replacedIndex : lastIdx;
        if (rec.messageIndex !== idx && rec.messageIndex !== idx + 1) return 0;
        delete chat_metadata.dooms_tracker.otherworldUndo;
        if (JSON.stringify(snapshot()) !== JSON.stringify(rec.after)) { saveChatData(); return 0; }
        restore(rec.before);
        saveChatScope();
        notifyStatsChanged({ source: 'undo' });
        saveChatData();
        return 1;
    } catch (e) {
        console.warn('[Dooms Tracker] Otherworld: undo failed', e);
        return 0;
    }
}

/** A new domain from the story sits a little above the player's level. */
function partyLevelGuess() {
    try {
        const p = getPersonaName();
        const lv = p && isProgressEnabled() ? getProgress(p, true).level || 1 : 1;
        return Math.min(99, lv + 2);
    } catch (e) { return 3; }
}
