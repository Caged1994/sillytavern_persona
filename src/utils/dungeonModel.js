/**
 * Dungeon — pure model.
 *
 * The program builds the dungeon: how many floors, which rooms exist, how
 * they connect, what each one holds and how dangerous it is. The AI only
 * dresses it afterwards (names, a sentence of description, who the enemies
 * are), so the map is always coherent, costs no tokens to build, and the same
 * seed always gives the same dungeon.
 *
 * State (kept in the chat, plain JSON):
 *   { v, id, seed, rng, title, theme, size, partySize, partyLevel, dressed,
 *     floors: [{ index, name, cols, rows, start, exit, rooms: { id: room } }],
 *     floor, at, from, party, log, danger, steps, phase, result, stats, pendingFight }
 *
 * Room: { id, floor, x, y, type, links, depth, visited, cleared, name, desc,
 *         enemies?, trap?, loot?, rest? }
 */
import { threatRating } from './combatModel.js';

export const SIZES = {
    small: { label: 'Small', rooms: 7, cols: 4, rows: 3 },
    medium: { label: 'Medium', rooms: 10, cols: 5, rows: 4 },
    large: { label: 'Large', rooms: 14, cols: 6, rows: 4 },
};
export const MAX_FLOORS = 3;
/** Places of the Otherworld (sites) may go deeper in one run. */
export const MAX_SITE_FLOORS = 6;

export const ROOM_TYPES = {
    start: { icon: '🚪', label: 'Entrance' },
    empty: { icon: '▫️', label: 'Empty room' },
    combat: { icon: '⚔️', label: 'Enemies' },
    trap: { icon: '⚠️', label: 'Trap' },
    treasure: { icon: '💰', label: 'Treasure' },
    rest: { icon: '🔥', label: 'Safe place' },
    stairs: { icon: '🪜', label: 'Stairs down' },
    gate: { icon: '🌀', label: 'Way on' },
    boss: { icon: '💀', label: 'Boss' },
};
/** Rooms that must be dealt with before walking on (apart from going back). */
export const BLOCKING = new Set(['combat', 'trap', 'boss']);

// Checks use the social stats: spotting a trap, keeping one's nerve, disarming it.
export const TRAP_STATS = ['knowledge', 'guts', 'proficiency'];

/** What camping and resting give back, in points of the HP / SP bars. */
export const REST = { roomHealth: 45, roomMana: 35, campHealth: 25, campMana: 20 };
/** Damage a failed trap or chest deals, in points of the HP bar. */
export const DAMAGE = { trapBase: 12, trapPerFloor: 6, chestBase: 6 };

// ─── Random numbers (mulberry32 on state.rng) ───────────────────────────────

export function nextRandom(s) {
    s.rng = (s.rng + 0x6D2B79F5) >>> 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rint = (s, n) => Math.floor(nextRandom(s) * n);
const pick = (s, arr) => arr[rint(s, arr.length)];
function shuffle(s, arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = rint(s, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const clip = (t, max) => {
    const x = String(t ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return x.length > max ? x.slice(0, max - 1).trimEnd() + '…' : x;
};

// ─── Encounters ─────────────────────────────────────────────────────────────

const TIER_WEIGHTS = { minion: 3, normal: 3, elite: 1 };

/**
 * A group of enemy categories whose threat to a party of that size is about
 * `target` (see combatModel.threatRating).
 */
export function composeEncounter(s, { partySize = 1, target = 0.7, allowElite = false, mustInclude = [], maxEnemies = 5 } = {}) {
    const tiers = [...mustInclude];
    const ratio = (list) => threatRating(list, partySize).ratio;
    const options = ['minion', 'normal', ...(allowElite ? ['elite'] : [])];
    while (tiers.length < maxEnemies) {
        if (tiers.length && ratio(tiers) >= target) break;
        const fits = options.filter(t => ratio([...tiers, t]) <= target + 0.2);
        if (!fits.length) break;
        const total = fits.reduce((a, t) => a + TIER_WEIGHTS[t], 0);
        let r = nextRandom(s) * total;
        let chosen = fits[0];
        for (const t of fits) { r -= TIER_WEIGHTS[t]; if (r <= 0) { chosen = t; break; } }
        tiers.push(chosen);
    }
    if (!tiers.length) tiers.push('minion');
    return tiers;
}

const ORDER = ['minion', 'normal', 'elite', 'boss'];
const byDanger = (a, b) => ORDER.indexOf(b) - ORDER.indexOf(a);

function enemySlots(tiers, levelDelta, level = null) {
    return [...tiers].sort(byDanger).map(tier => ({ tier, levelDelta, ...(level ? { level } : {}) }));
}

/** The set level of a floor's enemies (sites), or null (they follow the party). */
export function floorLevel(st, index = st.floor) {
    const l = Array.isArray(st.levels) ? st.levels[index] : null;
    return Number.isFinite(l) ? Math.max(1, Math.min(99, Math.round(l))) : null;
}

// ─── Building the dungeon ───────────────────────────────────────────────────

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const cellKey = (x, y) => `${x},${y}`;

function growLayout(s, cols, rows, n) {
    const start = { x: rint(s, cols), y: rows - 1 };
    const cells = [start];
    const set = new Set([cellKey(start.x, start.y)]);
    const edges = [];
    let guard = 0;
    while (cells.length < n && guard++ < 1000) {
        const from = cells[rint(s, cells.length)];
        for (const [dx, dy] of shuffle(s, DIRS)) {
            const x = from.x + dx, y = from.y + dy;
            if (x < 0 || y < 0 || x >= cols || y >= rows || set.has(cellKey(x, y))) continue;
            cells.push({ x, y });
            set.add(cellKey(x, y));
            edges.push([from, { x, y }]);
            break;
        }
    }
    return { cells, edges };
}

function bfsDepths(rooms, startId) {
    const depth = { [startId]: 0 };
    const queue = [startId];
    while (queue.length) {
        const id = queue.shift();
        for (const l of rooms[id].links) {
            if (depth[l] === undefined) { depth[l] = depth[id] + 1; queue.push(l); }
        }
    }
    return depth;
}

function generateFloor(st, index, total) {
    const size = SIZES[st.size] || SIZES.medium;
    const n = clamp(size.rooms + rint(st, 3) - 1, 5, size.cols * size.rows);
    const { cells, edges } = growLayout(st, size.cols, size.rows, n);
    const rooms = {};
    const byCell = {};
    cells.forEach((c, i) => {
        const id = `f${index}r${i + 1}`;
        byCell[cellKey(c.x, c.y)] = id;
        rooms[id] = { id, floor: index, x: c.x, y: c.y, type: 'empty', links: [], depth: 0, visited: false, cleared: false, name: '', desc: '' };
    });
    const link = (a, b) => {
        if (!rooms[a].links.includes(b)) rooms[a].links.push(b);
        if (!rooms[b].links.includes(a)) rooms[b].links.push(a);
    };
    for (const [a, b] of edges) link(byCell[cellKey(a.x, a.y)], byCell[cellKey(b.x, b.y)]);
    // A few loops, so the map is not only a tree.
    const loops = [];
    for (const c of cells) {
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
            const o = byCell[cellKey(c.x + dx, c.y + dy)];
            const me = byCell[cellKey(c.x, c.y)];
            if (o && !rooms[me].links.includes(o)) loops.push([me, o]);
        }
    }
    for (const [a, b] of shuffle(st, loops).slice(0, 2)) if (nextRandom(st) < 0.6) link(a, b);

    const startId = `f${index}r1`;
    const depths = bfsDepths(rooms, startId);
    const ids = Object.keys(rooms);
    for (const id of ids) rooms[id].depth = depths[id] ?? 0;
    const maxDepth = Math.max(...ids.map(id => rooms[id].depth), 1);

    // The way on: the farthest room.
    const far = ids.filter(id => id !== startId && rooms[id].depth === maxDepth);
    const exitId = pick(st, far.length ? far : ids.filter(id => id !== startId));
    const isLast = index === total - 1;
    rooms[startId].type = 'start';
    rooms[exitId].type = isLast ? (st.lastIsBoss === false ? 'gate' : 'boss') : 'stairs';

    const free = ids.filter(id => id !== startId && id !== exitId);
    const take = (id) => free.splice(free.indexOf(id), 1);
    // Treasure sits in dead ends, deepest first.
    const deadEnds = free.filter(id => rooms[id].links.length === 1).sort((a, b) => rooms[b].depth - rooms[a].depth);
    const treasures = n >= 12 ? 2 : 1;
    for (const id of deadEnds.slice(0, treasures)) { rooms[id].type = 'treasure'; take(id); }
    if (!ids.some(id => rooms[id].type === 'treasure') && free.length) { const id = pick(st, free); rooms[id].type = 'treasure'; take(id); }
    // A safe place about half way in.
    if (free.length > 2) {
        const half = Math.round(maxDepth / 2);
        const id = [...free].sort((a, b) => Math.abs(rooms[a].depth - half) - Math.abs(rooms[b].depth - half))[0];
        rooms[id].type = 'rest';
        take(id);
    }
    // The rest: enemies, traps and empty rooms.
    const weights = [['combat', 40], ['trap', 16], ['empty', 28]];
    const wTotal = weights.reduce((a, [, w]) => a + w, 0);
    for (const id of free) {
        let r = nextRandom(st) * wTotal;
        for (const [t, w] of weights) { r -= w; if (r <= 0) { rooms[id].type = t; break; } }
    }
    // At least a couple of fights per floor.
    const wantFights = Math.max(2, Math.round(n * 0.3));
    let fights = ids.filter(id => rooms[id].type === 'combat').length;
    for (const id of shuffle(st, free)) {
        if (fights >= wantFights) break;
        if (rooms[id].type === 'empty') { rooms[id].type = 'combat'; fights++; }
    }

    // What each room holds.
    const levelBase = index;
    const setLevel = floorLevel(st, index);
    for (const id of ids) {
        const room = rooms[id];
        const frac = room.depth / maxDepth;
        if (room.type === 'combat') {
            const target = clamp(0.55 + 0.35 * frac + 0.25 * index, 0.5, 1.3);
            const tiers = composeEncounter(st, { partySize: st.partySize, target, allowElite: target > 0.85 });
            room.enemies = enemySlots(tiers, clamp(levelBase + (frac > 0.6 ? 1 : 0) - 1, -2, 3), setLevel ? setLevel + (frac > 0.6 ? 1 : 0) : null);
        } else if (room.type === 'boss') {
            const tiers = st.partySize >= 3
                ? composeEncounter(st, { partySize: st.partySize, target: 1.2 + 0.1 * index, allowElite: true, mustInclude: ['boss'] })
                : composeEncounter(st, { partySize: st.partySize, target: 1.3, allowElite: true, mustInclude: ['elite'] });
            room.enemies = enemySlots(tiers, clamp(levelBase + 1, -2, 3), setLevel ? setLevel + 2 : null);
        } else if (room.type === 'trap') {
            const diffs = ['easy', 'medium', 'hard', 'extreme'];
            const base = clamp(index + (frac > 0.5 ? 1 : 0), 0, 2);
            room.trap = {
                stat: pick(st, TRAP_STATS),
                difficulty: diffs[clamp(base + rint(st, 2), 0, 3)],
                damage: DAMAGE.trapBase + DAMAGE.trapPerFloor * index,
                desc: '',
            };
        } else if (room.type === 'treasure') {
            const locked = nextRandom(st) < 0.55;
            room.loot = {
                money: Math.round((20 + 18 * index) * (0.8 + nextRandom(st) * 0.5)),
                items: [],
                locked,
                lockStat: 'proficiency',
                lockDifficulty: ['easy', 'medium', 'hard'][clamp(index, 0, 2)],
                forceStat: 'guts',
            };
        } else if (room.type === 'rest') {
            room.rest = { health: REST.roomHealth, mana: REST.roomMana };
        }
    }
    rooms[startId].visited = true;
    rooms[startId].cleared = true;
    return { index, name: '', cols: size.cols, rows: size.rows, start: startId, exit: exitId, rooms };
}

/**
 * Builds a dungeon (not yet entered). The same seed gives the same dungeon.
 * @param {{seed?: number, floors?: number, size?: string, partySize?: number, partyLevel?: number, theme?: string}} o
 */
export function generateDungeon({ seed = Date.now(), floors = 1, size = 'medium', partySize = 1, partyLevel = 1, theme = '', levels = null, floorOffset = 0, lastIsBoss = true, maxFloors = MAX_FLOORS, reaper = null } = {}) {
    const s = (seed >>> 0) || 1;
    const st = {
        v: 1,
        id: `dg-${s.toString(36)}`,
        seed: s,
        rng: s,
        title: '',
        theme: clip(theme, 400),
        size: SIZES[size] ? size : 'medium',
        partySize: Math.max(1, Math.round(partySize) || 1),
        partyLevel: Math.max(1, Math.round(partyLevel) || 1),
        dressed: false,
        floors: [],
        floor: 0,
        at: null,
        from: null,
        party: [],
        log: [],
        danger: 0,
        steps: 0,
        phase: 'active',
        result: null,
        stats: { fights: 0, traps: 0, trapsFailed: 0, chests: 0, rests: 0, floors: 1, xp: 0, money: 0, items: [] },
        pendingFight: null,
        seq: 0,
        // Sites: set enemy levels per floor, the number shown for floor 1, whether the
        // last floor ends in a boss or a way on, a checkpoint, the Reaper.
        levels: Array.isArray(levels) ? levels.map(l => Math.max(1, Math.min(99, Math.round(l) || 1))) : null,
        floorOffset: Math.max(0, Math.round(floorOffset) || 0),
        lastIsBoss: lastIsBoss !== false,
        checkpoint: null,
        floorSteps: 0,
        reaper: reaper && typeof reaper === 'object' ? { name: clip(reaper.name || 'The Reaper', 40), after: Math.max(4, Math.round(reaper.after) || 0), met: 0 } : null,
    };
    const total = clamp(Math.round(floors) || 1, 1, Math.max(1, Math.min(MAX_SITE_FLOORS, maxFloors)));
    for (let i = 0; i < total; i++) st.floors.push(generateFloor(st, i, total));
    st.at = st.floors[0].start;
    if (st.reaper && !st.reaper.after) st.reaper.after = Math.round(roomCount(st, 0) * 1.6);
    return st;
}

// ─── Looking around ─────────────────────────────────────────────────────────

export const floorOf = (st, index = st.floor) => st.floors[index];
export const getRoom = (st, id, floor = st.floor) => st.floors[floor]?.rooms[id] || null;
export const currentRoom = (st) => getRoom(st, st.at);
export const roomCount = (st, floor = st.floor) => Object.keys(st.floors[floor]?.rooms || {}).length;
export const isLastFloor = (st) => st.floor >= st.floors.length - 1;

/** Whether a room still has to be dealt with before walking on. */
export const blocksExit = (room) => !!room && BLOCKING.has(room.type) && !room.cleared;

/**
 * The rooms to draw: the ones visited and their neighbours, which show only
 * as an unknown space until entered.
 * @returns {Array<{room, known: boolean, here: boolean, reachable: boolean}>}
 */
export function visibleRooms(st) {
    const f = floorOf(st);
    const here = currentRoom(st);
    const out = [];
    for (const room of Object.values(f.rooms)) {
        const known = !!room.visited;
        const seen = known || room.links.some(l => f.rooms[l].visited);
        if (!seen) continue;
        out.push({ room, known, here: room.id === st.at, reachable: !!here && canMove(st, room.id).ok });
    }
    return out;
}

/** Links to draw: between two rooms, when at least one of them is known. */
export function visibleLinks(st) {
    const f = floorOf(st);
    const out = [];
    for (const room of Object.values(f.rooms)) {
        for (const l of room.links) {
            if (room.id < l && (room.visited || f.rooms[l].visited)) out.push([room.id, l]);
        }
    }
    return out;
}

// ─── Moving ─────────────────────────────────────────────────────────────────

export function canMove(st, toId) {
    if (st.phase !== 'active') return { ok: false, reason: 'The dungeon is over.' };
    const here = currentRoom(st);
    const to = getRoom(st, toId);
    if (!here || !to || toId === st.at) return { ok: false, reason: '' };
    if (!here.links.includes(toId)) return { ok: false, reason: 'There is no way through from here.' };
    if (st.pendingFight) return { ok: false, reason: 'A fight is still going on.' };
    if (blocksExit(here) && toId !== st.from) return { ok: false, reason: here.type === 'trap' ? 'The trap is still there — deal with it first, or step back.' : 'The enemies block the way — beat them, or step back.' };
    return { ok: true, reason: '' };
}

function log(st, text, type = 'info') {
    st.log.push({ n: st.seq++, type, text: clip(text, 400) });
    if (st.log.length > 200) st.log.splice(0, st.log.length - 200);
}
export { log as addLog };

/** Walks into a neighbouring room. @returns {{ok: boolean, reason?: string, room?: object, first?: boolean}} */
export function move(st, toId) {
    const check = canMove(st, toId);
    if (!check.ok) return check;
    const room = getRoom(st, toId);
    const first = !room.visited;
    st.from = st.at;
    st.at = toId;
    room.visited = true;
    st.steps++;
    st.floorSteps = (st.floorSteps || 0) + 1;
    if (room.type === 'rest') st.checkpoint = { floor: st.floor, room: room.id };
    log(st, `${first ? 'You enter' : 'You return to'} ${room.name || ROOM_TYPES[room.type].label}.`, 'move');
    return { ok: true, room, first };
}

/** Takes the stairs of the current room to the next floor's entrance. */
export function descend(st) {
    const here = currentRoom(st);
    if (!here || here.type !== 'stairs' || isLastFloor(st) || st.phase !== 'active') return { ok: false };
    st.floor++;
    const f = floorOf(st);
    st.at = f.start;
    st.from = null;
    st.floorSteps = 0;
    f.rooms[f.start].visited = true;
    st.stats.floors = Math.max(st.stats.floors, st.floor + 1);
    log(st, `You go down to ${f.name || `floor ${displayFloor(st)}`}.`, 'move');
    return { ok: true, floor: st.floor };
}

/** The floor number shown (sites count from their first floor). */
export function displayFloor(st, index = st.floor) {
    return (st.floorOffset || 0) + index + 1;
}

// ─── The Reaper ─────────────────────────────────────────────────────────────

/**
 * Lingering on a floor of a site that has the Reaper: after `after` steps a
 * warning, and from then on each step may bring it. Stairs reset the count.
 * @returns {{ steps, after, warn: boolean, chance: number } | null}
 */
export function reaperState(st) {
    if (!st.reaper) return null;
    const steps = st.floorSteps || 0;
    const after = st.reaper.after;
    const over = steps - after;
    return { steps, after, warn: steps >= after - 3, chance: over < 0 ? 0 : clamp(0.25 + 0.1 * over, 0, 0.6) };
}

/** Rolls for the Reaper after a step. */
export function rollReaper(st) {
    const r = reaperState(st);
    return !!r && r.chance > 0 && nextRandom(st) < r.chance;
}

/** The Reaper's spec: far above the party, a boss. */
export function reaperSpec(st) {
    const top = Math.max(...(st.levels || [st.partyLevel || 1]), st.partyLevel || 1);
    return {
        name: st.reaper?.name || 'The Reaper', icon: '💀', tier: 'boss', level: Math.min(99, Math.max(top + 25, 60)),
        description: 'It came because you stayed too long.', focus: 'ma',
        attacks: [{ name: 'Megidolaon', power: 'heavy', stat: 'ma', target: 'enemies', element: 'almighty' }, { name: 'Gun Barrage', power: 'heavy', stat: 'st', target: 'enemies', element: 'gun' }],
    };
}

// ─── Rooms ──────────────────────────────────────────────────────────────────

/** The enemy specs of a room, ready for the combat window. */
export function roomEnemies(room) {
    return (room.enemies || []).map(e => ({ ...e }));
}

/** The chance of a wandering group finding you as you camp, rising with each camp. */
export function ambushChance(st) {
    return clamp(0.1 + 0.15 * st.danger, 0, 0.6);
}

/** Camping: rolls whether a group finds you, and raises the danger. */
export function rollCamp(st) {
    const chance = ambushChance(st);
    const ambush = nextRandom(st) < chance;
    st.danger++;
    return { ambush, chance };
}

/** An ambush: a group sized for the floor and how deep you are. */
export function ambushTiers(st) {
    const f = floorOf(st);
    const maxDepth = Math.max(...Object.values(f.rooms).map(r => r.depth), 1);
    const frac = (currentRoom(st)?.depth || 0) / maxDepth;
    const target = clamp(0.5 + 0.3 * frac + 0.2 * st.floor, 0.5, 1.1);
    return composeEncounter(st, { partySize: st.partySize, target, allowElite: false });
}

/** Enemy specs for a group met on the road (nothing to name them: plain table names). */
export function wanderingSpecs(st, tiers) {
    const taken = new Set();
    const delta = clamp(st.floor - 1 + (st.partyLevel > 8 ? 1 : 0), -2, 3);
    return [...tiers].sort(byDanger).map(tier => {
        const pool = ENEMY_NAMES[tier] || ENEMY_NAMES.normal;
        let name = pool.find(n => !taken.has(n)) || pick(st, pool);
        if (taken.has(name)) { let i = 2; while (taken.has(`${name} ${i}`)) i++; name = `${name} ${i}`; }
        taken.add(name);
        const lv = floorLevel(st);
        return { name, icon: ENEMY_ICONS[tier] || '👹', description: 'Roaming the dark.', tier, levelDelta: delta, ...(lv ? { level: lv } : {}), attacks: (ATTACKS[tier] || ATTACKS.normal).map(a => ({ ...a })) };
    });
}

// ─── Dressing (names and descriptions) ──────────────────────────────────────

const NAMES = {
    start: ['The way in'],
    empty: ['Dusty corridor', 'Collapsed gallery', 'Bare cell', 'Old storeroom', 'Dripping passage', 'Quiet chamber'],
    combat: ['Guard room', 'Bone-strewn hall', 'Gloomy barracks', 'Broken crossing', 'Watchers\' den'],
    trap: ['Narrow passage', 'Tiled hall', 'Whispering gallery', 'Rotten bridge'],
    treasure: ['Forgotten vault', 'Hidden alcove', 'Sealed storeroom'],
    rest: ['Quiet alcove', 'Old shrine', 'Dry corner'],
    stairs: ['Stairs down'],
    boss: ['The last chamber', 'Throne of the deep'],
};
const DESCS = {
    start: 'The entrance. Daylight is still behind you.',
    empty: 'Nothing here but dust and old stone.',
    combat: 'Something is waiting here.',
    trap: 'The floor and walls look wrong. Something is set to catch the careless.',
    treasure: 'A chest sits in the dust, waiting.',
    rest: 'A calm spot where no one seems to come. You could rest here.',
    stairs: 'A worn stair leads further down.',
    boss: 'The air is heavy. This is where it ends.',
};
const ENEMY_NAMES = {
    minion: ['Cave rat', 'Restless bones', 'Skulking thing', 'Crawler', 'Pale lurker'],
    normal: ['Dungeon guard', 'Hollow knight', 'Ghoul', 'Stone sentry', 'Gaunt hunter'],
    elite: ['Warden', 'Brute', 'Bone captain'],
    boss: ['Keeper of the Deep', 'The Hollow King', 'The Last Warden'],
};
const ENEMY_ICONS = { minion: '🐀', normal: '💀', elite: '👹', boss: '👑' };
const ATTACKS = {
    minion: [{ name: 'Gnaw', power: 'light', stat: 'st' }],
    normal: [{ name: 'Strike', power: 'medium', stat: 'st' }],
    elite: [{ name: 'Crush', power: 'heavy', stat: 'st' }, { name: 'Strike', power: 'medium', stat: 'st' }],
    boss: [{ name: 'Rend', power: 'heavy', stat: 'st' }, { name: 'Dark wave', power: 'medium', stat: 'ma', status: 'weaken' }],
};
const TRAP_DESCS = ['A hidden pressure plate.', 'A tripwire in the dark.', 'Darts set in the walls.', 'A floor that gives way.'];
const CHEST_ITEMS = ['Old trinket', 'Tarnished ring', 'Healing herbs', 'Silver locket'];

/** Fills in anything the AI left empty, so a dungeon is playable without it. */
export function fillDressing(st) {
    st.floors.forEach((f, i) => {
        if (!f.name) f.name = st.floors.length > 1 ? `Floor ${i + 1}` : (st.title || 'The dungeon');
        for (const id of Object.keys(f.rooms)) {
            const room = f.rooms[id];
            if (!room.name) room.name = pick(st, NAMES[room.type] || NAMES.empty);
            if (!room.desc) room.desc = DESCS[room.type] || '';
            if (room.type === 'combat' || room.type === 'boss') {
                const taken = new Set();
                room.enemies = (room.enemies || []).map(e => {
                    const out = { ...e };
                    if (!out.name) {
                        const pool = ENEMY_NAMES[out.tier] || ENEMY_NAMES.normal;
                        out.name = pool.find(n => !taken.has(n)) || pick(st, pool);
                    }
                    taken.add(out.name);
                    if (!out.icon) out.icon = ENEMY_ICONS[out.tier] || '👹';
                    if (!Array.isArray(out.attacks) || !out.attacks.length) out.attacks = (ATTACKS[out.tier] || ATTACKS.normal).map(a => ({ ...a }));
                    return out;
                });
                // The same name twice in one room is told apart.
                const seen = {};
                for (const e of room.enemies) {
                    seen[e.name] = (seen[e.name] || 0) + 1;
                    if (seen[e.name] > 1) e.name = `${e.name} ${seen[e.name]}`;
                }
            }
            if (room.type === 'trap' && room.trap && !room.trap.desc) room.trap.desc = pick(st, TRAP_DESCS);
            if (room.type === 'treasure' && room.loot && !room.loot.items.length && nextRandom(st) < 0.7) room.loot.items = [pick(st, CHEST_ITEMS)];
        }
    });
    if (!st.title) st.title = st.theme || 'The dungeon';
    return st;
}

/**
 * Merges the AI's dressing into the dungeon. The AI cannot change the
 * structure: it can only name rooms, describe them, and say who the enemies
 * are (their category comes from the structure, never from the AI).
 * @param {object} st
 * @param {object} d - { title, floors: [{name}], rooms: { id: {...} } }
 * @param {(raw: any) => Array} [normalizeSpecs] - cleans a list of enemy specs
 * @returns {number} how many rooms were dressed
 */
export function applyDressing(st, d, normalizeSpecs = (x) => (Array.isArray(x) ? x : [])) {
    if (!d || typeof d !== 'object') return 0;
    if (typeof d.title === 'string' && d.title.trim()) st.title = clip(d.title, 60);
    if (Array.isArray(d.floors)) d.floors.forEach((f, i) => { if (st.floors[i] && f && typeof f.name === 'string' && f.name.trim()) st.floors[i].name = clip(f.name, 40); });
    const rooms = d.rooms && typeof d.rooms === 'object' ? d.rooms : {};
    let count = 0;
    for (const f of st.floors) {
        for (const id of Object.keys(f.rooms)) {
            const room = f.rooms[id];
            const raw = rooms[id];
            if (!raw || typeof raw !== 'object') continue;
            let touched = false;
            if (typeof raw.name === 'string' && raw.name.trim()) { room.name = clip(raw.name, 40); touched = true; }
            const desc = raw.description ?? raw.desc;
            if (typeof desc === 'string' && desc.trim()) { room.desc = clip(desc, 220); touched = true; }
            if ((room.type === 'combat' || room.type === 'boss') && Array.isArray(raw.enemies)) {
                const specs = normalizeSpecs(raw.enemies);
                room.enemies = room.enemies.map((slot, i) => {
                    const spec = specs[i];
                    return spec ? { ...spec, tier: slot.tier, levelDelta: slot.levelDelta, ...(slot.level ? { level: slot.level } : {}) } : slot;
                });
                touched = true;
            }
            if (room.type === 'trap' && room.trap) {
                const t = raw.trap ?? raw.description;
                if (typeof t === 'string' && t.trim()) room.trap.desc = clip(t, 160);
            }
            if (room.type === 'treasure' && room.loot) {
                const items = Array.isArray(raw.items) ? raw.items : (Array.isArray(raw.loot?.items) ? raw.loot.items : []);
                room.loot.items = items.filter(x => typeof x === 'string' && x.trim()).slice(0, 2).map(x => clip(x, 40));
            }
            if (touched) count++;
        }
    }
    st.dressed = count > 0;
    return count;
}

// ─── Summary ────────────────────────────────────────────────────────────────

export function exploredCount(st) {
    let seen = 0, total = 0;
    for (const f of st.floors) for (const r of Object.values(f.rooms)) { total++; if (r.visited) seen++; }
    return { seen, total };
}

/** A compact record of the run for the AI that tells the story. */
export function summarizeForNarration(st) {
    const { seen, total } = exploredCount(st);
    return {
        title: st.title,
        theme: st.theme,
        result: st.result,
        floors: st.floors.length,
        floorsReached: st.stats.floors,
        firstFloor: (st.floorOffset || 0) + 1,
        reaperMet: st.reaper?.met || 0,
        rooms: `${seen}/${total}`,
        steps: st.steps,
        fights: st.stats.fights,
        trapsMet: st.stats.traps,
        trapsFailed: st.stats.trapsFailed,
        chests: st.stats.chests,
        xp: st.stats.xp,
        money: st.stats.money,
        items: st.stats.items,
        highlights: st.log.filter(e => e.type === 'highlight').slice(-10).map(e => e.text),
        party: st.party.map(p => p.name),
    };
}
