/**
 * The Otherworld — places the party explores, kept in the chat. Pure rules.
 *
 * Two kinds, named and dressed by the card or the story:
 *   labyrinth  the great dungeon (Tartarus, Mementos…): floors in blocks;
 *              a block opens at the start, by hand, on a date, when a domain
 *              is cleared, or when the story says so. Floors are new on every
 *              visit; enemies follow the depth, not the party. Each block ends
 *              with a guardian; beating it makes the next block's first floor
 *              a checkpoint. The Reaper comes for those who linger.
 *   domain     a smaller dungeon tied to someone (a Palace, a personal
 *              dungeon): a fixed map of a few areas kept between visits,
 *              safe rooms as checkpoints, its ruler at the end, and a
 *              deadline on the calendar. Missed → it closes (the story is
 *              told); cleared in time → it stays open to revisit.
 *
 * Site: { id, name, kind, theme, ruler, source, status: 'open'|'cleared'|'closed'|'hidden',
 *         appears?, deadline?, areas, level, seed, saved, eventId,
 *         blocks: [{ name, unlocked, cleared, unlock: { type, value } }], floorsPerBlock, levels: [min, max],
 *         deepest, reaper: string|false, requests: [{ id, title, floor, done, source }], closedOn? }
 */
import { parseDate, dayDiff } from './calendarModel.js';

export const KINDS = { labyrinth: 'Labyrinth', domain: 'Domain' };
export const UNLOCKS = ['start', 'manual', 'date', 'site', 'story'];
export const MAX_SITES = 20;
export const MAX_BLOCKS = 12;
export const MAX_AREAS = 4;
export const DEFAULT_FLOORS_PER_BLOCK = 5;
export const MAX_REQUESTS = 12;

const clip = (t, n) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const clampInt = (v, lo, hi, d) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
export const siteKey = (name) => String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

let counter = 0;
export const newId = (p = 'site') => `${p}${Date.now().toString(36)}${(counter = (counter + 1) % 1e5).toString(36)}`;

function normalizeUnlock(u, i) {
    if (i === 0) return { type: 'start' };
    if (!u || typeof u !== 'object') return { type: 'story' };
    const type = UNLOCKS.includes(u.type) ? u.type : 'story';
    return { type, ...(u.value ? { value: clip(u.value, 60) } : {}) };
}

/** A clean site (or null without a name). */
export function normalizeSite(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = clip(raw.name, 60);
    if (!name) return null;
    const kind = raw.kind === 'labyrinth' ? 'labyrinth' : 'domain';
    const site = {
        id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
        name, kind,
        theme: clip(raw.theme, 300),
        ruler: clip(raw.ruler, 60),
        source: ['lorebook', 'ai', 'user'].includes(raw.source) ? raw.source : 'user',
        status: ['open', 'cleared', 'closed', 'hidden'].includes(raw.status) ? raw.status : 'open',
        seed: Number.isFinite(raw.seed) ? raw.seed >>> 0 : (Math.floor(Math.random() * 2 ** 31) || 1),
        requests: (Array.isArray(raw.requests) ? raw.requests : []).map(normalizeRequest).filter(Boolean).slice(0, MAX_REQUESTS),
    };
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw.appears || '')) site.appears = raw.appears;
    if (raw.closedOn) site.closedOn = String(raw.closedOn).slice(0, 10);
    if (kind === 'domain') {
        site.areas = clampInt(raw.areas, 1, MAX_AREAS, 3);
        site.level = clampInt(raw.level, 1, 99, 1);
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw.deadline || '')) site.deadline = raw.deadline;
        site.saved = raw.saved && typeof raw.saved === 'object' ? raw.saved : null;
        if (raw.eventId) site.eventId = String(raw.eventId);
    } else {
        const blocks = Array.isArray(raw.blocks) && raw.blocks.length ? raw.blocks : [{}, {}, {}];
        site.blocks = blocks.slice(0, MAX_BLOCKS).map((b, i) => ({
            name: clip(b?.name, 40),
            unlocked: i === 0 ? true : !!b?.unlocked,
            cleared: !!b?.cleared,
            unlock: normalizeUnlock(b?.unlock, i),
        }));
        site.floorsPerBlock = clampInt(raw.floorsPerBlock, 2, 6, DEFAULT_FLOORS_PER_BLOCK);
        const lv = Array.isArray(raw.levels) ? raw.levels : [1, Math.min(99, 10 + site.blocks.length * 12)];
        const lo = clampInt(lv[0], 1, 99, 1);
        site.levels = [lo, clampInt(lv[1], lo, 99, Math.max(lo, 60))];
        site.deepest = clampInt(raw.deepest, 0, site.blocks.length * site.floorsPerBlock, 0);
        site.reaper = raw.reaper === false || raw.reaper === 'off' ? false : clip(raw.reaper || 'The Reaper', 40);
    }
    return site;
}

export function normalizeRequest(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const title = clip(raw.title ?? raw.name, 80);
    if (!title) return null;
    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : newId('rq'),
        title,
        floor: clampInt(raw.floor, 1, 99, 1),
        done: !!raw.done,
        source: ['lorebook', 'ai', 'user'].includes(raw.source) ? raw.source : 'user',
    };
}

// ─── Labyrinth ──────────────────────────────────────────────────────────────

export const totalFloors = (site) => site.blocks.length * site.floorsPerBlock;

/** The enemy level on a floor (1-based): from the low to the high end, evenly. */
export function labyrinthLevel(site, floor) {
    const [lo, hi] = site.levels;
    const n = Math.max(1, totalFloors(site) - 1);
    return Math.round(lo + (hi - lo) * Math.min(1, Math.max(0, (floor - 1) / n)));
}

/** Floors one can reach (the unlocked blocks, in a row from the first). */
export function unlockedFloors(site) {
    let n = 0;
    for (const b of site.blocks) { if (!b.unlocked) break; n += site.floorsPerBlock; }
    return n;
}

/** Where a run can start: the first block, and every block whose previous guardian is beaten. */
export function checkpoints(site) {
    const out = [];
    site.blocks.forEach((b, i) => {
        if (!b.unlocked) return;
        if (i === 0 || site.blocks[i - 1].cleared) out.push({ block: i, floor: i * site.floorsPerBlock + 1, name: b.name || `Block ${i + 1}` });
    });
    return out;
}

/**
 * What a run from a block holds: its floors, their levels, where it ends.
 * @returns {{ block, floors, floorOffset, levels: number[], lastIsBoss, guardian }}
 */
export function labyrinthRun(site, block) {
    const b = site.blocks[block];
    const floorOffset = block * site.floorsPerBlock;
    const levels = [];
    for (let i = 0; i < site.floorsPerBlock; i++) levels.push(labyrinthLevel(site, floorOffset + i + 1));
    return { block, floors: site.floorsPerBlock, floorOffset, levels, lastIsBoss: !b.cleared, guardian: !b.cleared };
}

/**
 * Blocks whose condition is met now (date reached, domain cleared).
 * @param {{ today?: string, clearedSites?: string[] }} ctx
 * @returns {number[]} indexes newly opened
 */
export function dueUnlocks(site, { today = null, clearedSites = [] } = {}) {
    if (site.kind !== 'labyrinth') return [];
    const out = [];
    const cleared = new Set(clearedSites.map(siteKey));
    site.blocks.forEach((b, i) => {
        if (b.unlocked) return;
        const u = b.unlock;
        if (u.type === 'date' && today && u.value && dayDiff(u.value, today) >= 0) out.push(i);
        if (u.type === 'site' && u.value && cleared.has(siteKey(u.value))) out.push(i);
    });
    return out;
}

// ─── Domain ─────────────────────────────────────────────────────────────────

/** What a domain run holds: its areas, at the domain's level (a little more each area). */
export function domainRun(site) {
    const levels = [];
    for (let i = 0; i < site.areas; i++) levels.push(Math.min(99, site.level + i));
    return { floors: site.areas, floorOffset: 0, levels, lastIsBoss: site.status !== 'cleared' };
}

/** Days to the deadline from `today` (negative: past), or null. */
export function daysLeft(site, today) {
    return site.deadline && today ? dayDiff(today, site.deadline) : null;
}

/** Whether the deadline has passed with the domain not cleared. */
export function missedDeadline(site, today) {
    const d = daysLeft(site, today);
    return site.kind === 'domain' && site.status === 'open' && d !== null && d < 0;
}

// ─── Lorebook ───────────────────────────────────────────────────────────────

const HEADER = /^\s*(?:dungeon|otherworld|labyrinth|domain|palace)\s*[:\-–]\s*(.+?)\s*$/i;

export function siteEntryName(entry) {
    const t = String(entry?.comment ?? '').match(HEADER);
    if (t) return t[1];
    const first = String(entry?.content ?? '').split(/\r?\n/)[0] || '';
    const m = first.match(HEADER);
    return m ? m[1] : null;
}

/**
 * A site from a lorebook entry:
 *   Dungeon: Tartarus
 *   Kind: labyrinth            (or domain)
 *   Theme: a tower that grows out of the school at midnight
 *   Blocks: 6 · Floors per block: 5 · Levels: 1-70
 *   Block 2 opens: after Kamoshida's Castle   (or: on May 5, 2016 · story · start)
 *   Reaper: The Reaper         (or: off)
 *   Ruler: Kamoshida · Areas: 3 · Level: 8 · Deadline: May 2, 2016 · Appears: April 12, 2016
 */
export function parseSiteEntry(entry, { year = null } = {}) {
    const name = siteEntryName(entry);
    if (!name) return null;
    const lines = String(entry?.content ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const field = (re) => { for (const l of lines) { const m = l.match(re); if (m) return m[1].trim(); } return ''; };
    const kindRaw = field(/^kind\s*[:=]\s*(.+)$/i).toLowerCase();
    const header = String(entry?.comment ?? '') + ' ' + (lines[0] || '');
    const kind = /labyrinth|mega|tower|endless/.test(kindRaw) || (!kindRaw && /labyrinth/i.test(header)) ? 'labyrinth' : 'domain';
    const date = (s) => (s ? parseDate(s, { year }) : null);
    const raw = {
        name, kind, source: 'lorebook',
        theme: field(/^(?:theme|description)\s*[:=]\s*(.+)$/i),
        ruler: field(/^(?:ruler|master|owner|boss)\s*[:=]\s*(.+)$/i),
    };
    const appears = date(field(/^appears?\s*[:=]\s*(.+)$/i));
    if (appears) { raw.appears = appears; raw.status = 'hidden'; }
    if (kind === 'domain') {
        raw.areas = field(/^areas?\s*[:=]\s*(\d+)/i);
        raw.level = field(/^level\s*[:=]\s*(\d+)/i);
        raw.deadline = date(field(/^deadline\s*[:=]\s*(.+)$/i));
    } else {
        const n = clampInt(field(/^blocks?\s*[:=]\s*(\d+)/i), 1, MAX_BLOCKS, 3);
        raw.floorsPerBlock = field(/^floors?\s+per\s+block\s*[:=]\s*(\d+)/i);
        const lv = field(/^levels?\s*[:=]\s*(\d+)\s*[-–to]+\s*(\d+)/i) ? lines.map(l => l.match(/^levels?\s*[:=]\s*(\d+)\s*[-–to]+\s*(\d+)/i)).find(Boolean) : null;
        if (lv) raw.levels = [Number(lv[1]), Number(lv[2])];
        const reaper = field(/^reaper\s*[:=]\s*(.+)$/i);
        if (reaper) raw.reaper = /^(off|no|none|false)$/i.test(reaper) ? false : reaper;
        raw.blocks = [];
        for (let i = 0; i < n; i++) {
            const open = field(new RegExp(`^block\\s*${i + 1}\\s*(?:opens?|unlocks?)\\s*[:=]\\s*(.+)$`, 'i'));
            const bname = field(new RegExp(`^block\\s*${i + 1}\\s*(?:name)?\\s*[:=]\\s*(?!.*opens?)(.+)$`, 'i'));
            let unlock = { type: i === 0 ? 'start' : 'story' };
            if (open) {
                const d = /^on\b/i.test(open) || parseDate(open, { year }) ? date(open.replace(/^on\s+/i, '')) : null;
                if (/^(start|open|always)$/i.test(open)) unlock = { type: 'start' };
                else if (d) unlock = { type: 'date', value: d };
                else if (/^after\s+/i.test(open)) unlock = { type: 'site', value: open.replace(/^after\s+/i, '') };
                else if (/^(manual|by hand)$/i.test(open)) unlock = { type: 'manual' };
                else unlock = { type: 'story' };
            }
            raw.blocks.push({ name: bname, unlocked: i === 0 || unlock.type === 'start', unlock });
        }
    }
    return normalizeSite(raw);
}

export function parseSiteBook(entries, opts = {}) {
    const out = [];
    const seen = new Set();
    for (const e of entries || []) {
        if (!e || e.disable) continue;
        const s = parseSiteEntry(e, opts);
        if (!s || seen.has(siteKey(s.name))) continue;
        seen.add(siteKey(s.name));
        out.push(s);
    }
    return out;
}

// ─── The AI ─────────────────────────────────────────────────────────────────

/**
 * The "otherworld" key: { new?: {name, kind, ruler, theme, deadline, areas},
 * unlock?: "Labyrinth" | {site, block}, request?: {site, title, floor}, appear?: "Name" }.
 */
export function normalizeAIOtherworld(raw, { year = null } = {}) {
    let v = raw;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return null; } }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const out = { add: [], unlock: [], requests: [], appear: [] };
    for (const n of [].concat(v.new || v.add || [])) {
        if (!n || typeof n !== 'object' || !clip(n.name, 60)) continue;
        out.add.push({
            name: n.name, kind: n.kind === 'labyrinth' ? 'labyrinth' : 'domain', ruler: n.ruler, theme: n.theme ?? n.description,
            deadline: n.deadline ? parseDate(n.deadline, { year }) : null, areas: n.areas, source: 'ai',
        });
    }
    for (const u of [].concat(v.unlock || [])) {
        if (typeof u === 'string' && clip(u, 60)) out.unlock.push({ site: u });
        else if (u && typeof u === 'object' && clip(u.site, 60)) out.unlock.push({ site: u.site, block: Number.isFinite(Number(u.block)) ? Number(u.block) - 1 : null });
    }
    for (const r of [].concat(v.request || v.requests || [])) {
        if (r && typeof r === 'object' && clip(r.site, 60) && clip(r.title, 80)) out.requests.push({ site: r.site, title: r.title, floor: r.floor });
    }
    for (const a of [].concat(v.appear || [])) if (typeof a === 'string' && clip(a, 60)) out.appear.push(a);
    return out.add.length || out.unlock.length || out.requests.length || out.appear.length ? out : null;
}

/**
 * The prompt section.
 * @param {object} o
 * @param {object[]} o.sites - visible sites
 * @param {string|null} o.today
 * @param {string[]} o.closedNews - names of domains that closed lately
 */
export function buildOtherworldPrompt({ sites = [], today = null, closedNews = [], compact = true, standalone = false } = {}) {
    const where = standalone ? 'start your reply with ONE JSON code block with' : 'add to the same tracker JSON object';
    let out = 'OTHERWORLD (places the party explores; the program runs them):';
    const lines = [];
    for (const s of sites) {
        if (s.kind === 'labyrinth') {
            const locked = s.blocks.findIndex(b => !b.unlocked);
            lines.push(`- ${s.name} (great labyrinth${s.theme ? `: ${clip(s.theme, 80)}` : ''}): reached floor ${s.deepest || 0} of ${unlockedFloors(s)} open${locked !== -1 ? `; block ${locked + 1} is sealed${s.blocks[locked].unlock.type === 'story' ? ' until the story opens it' : ''}` : ''}${s.requests.filter(r => !r.done).length ? `; requests: ${s.requests.filter(r => !r.done).map(r => `${r.title} (floor ${r.floor})`).join(', ')}` : ''}.`);
        } else {
            const d = daysLeft(s, today);
            lines.push(`- ${s.name} (${s.ruler ? `${s.ruler}'s ` : ''}domain${s.theme ? `: ${clip(s.theme, 80)}` : ''}): ${s.status === 'cleared' ? 'cleared' : d === null ? 'open' : d < 0 ? 'deadline passed' : `${d} day${d === 1 ? '' : 's'} to the deadline`}.`);
        }
    }
    out += lines.length ? '\n' + lines.join('\n') : ' none yet.';
    if (closedNews.length) out += `\nClosed for good (its deadline passed): ${closedNews.join(', ')} — the story should feel the failure.`;
    const ex = '"otherworld": {"new": {"name": "…", "kind": "domain", "ruler": "…", "theme": "…", "deadline": "Month Day, Year", "areas": 3}}';
    out += compact
        ? `\nWhen the story reveals a new dungeon tied to someone, ${where} ${ex}. To open the next sealed part of a labyrinth: "otherworld": {"unlock": "Name"}; a task inside one: "otherworld": {"request": {"site": "Name", "title": "…", "floor": 4}}. Rare; leave the key out otherwise.`
        : `\nWhen the story reveals a new dungeon bound to someone (their distorted inner world, a cursed place), ${where} ${ex} — areas 2-4, the deadline only if the story sets one. When the story opens the next sealed part of a labyrinth: "otherworld": {"unlock": "Name"}. When someone asks the party to do something inside one: "otherworld": {"request": {"site": "Name", "title": "…", "floor": 4}}. These are rare; leave the key out otherwise.`;
    return out;
}
