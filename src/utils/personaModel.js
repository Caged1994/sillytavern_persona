/**
 * Personas — pure model.
 *
 * As in Persona 3, 4 and 5, St, Ma, En, Ag and Lu belong to the Persona,
 * not to its user: the character's attributes are those of the Persona
 * they have equipped. A Persona has a name, an Arcana, a level, those five
 * stats, an affinity to each element and up to eight skills.
 *
 * Where a Persona comes from:
 *   - The Compendium: lorebook entries whose title (or first line) starts
 *     with "Persona:". parseCompendiumEntry reads them; see the format below.
 *   - The AI, when one awakens in the story and the Compendium has no entry:
 *     it picks Arcana, the stat the Persona leans on, affinities and skills;
 *     the numbers come from generateStats so it cannot unbalance anything.
 *   - The user, from the Stats panel.
 *
 * Compendium entry format (one field per line, order free, extra text ignored):
 *   Persona: Arsène
 *   Arcana: Fool
 *   Level: 1
 *   St 2 · Ma 2 · En 2 · Ag 3 · Lu 1
 *   Phys - · Gun - · Fire - · Ice Wk · Elec - · Wind - · Psy - · Nuke - · Bless Wk · Curse Rs
 *   Skills: Eiha, Cleave
 *   Learns: Lv2 Rakukaja, Lv4 Sukunda
 *   Description: The gentleman thief of the Fool Arcana.
 *
 * Level-ups: every level gives POINTS_PER_LEVEL stat points, spread in
 * proportion to the stats the Persona already has (a Persona keeps its
 * shape as it grows), and teaches the skills its "Learns" list holds for
 * that level.
 */

export const STAT_IDS = ['st', 'ma', 'en', 'ag', 'lu'];
export const STAT_LABELS = { st: 'St', ma: 'Ma', en: 'En', ag: 'Ag', lu: 'Lu' };
export const MIN_STAT = 1;
export const MAX_STAT = 99;
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 99;
export const POINTS_PER_LEVEL = 3;
export const MAX_SKILLS = 8;
/** How many Personas a Wild Card can hold. */
export const MAX_STOCK = 12;

/** The elements of Persona 5 (Gun included); Almighty has no affinity. */
export const ELEMENTS = [
    { id: 'phys', name: 'Phys', icon: '⚔️', aliases: ['physical', 'slash', 'strike', 'pierce'] },
    { id: 'gun', name: 'Gun', icon: '🔫', aliases: ['guns', 'firearm'] },
    { id: 'fire', name: 'Fire', icon: '🔥', aliases: ['agi'] },
    { id: 'ice', name: 'Ice', icon: '❄️', aliases: ['bufu'] },
    { id: 'elec', name: 'Elec', icon: '⚡', aliases: ['electric', 'electricity', 'zio', 'thunder', 'lightning'] },
    { id: 'wind', name: 'Wind', icon: '🌪️', aliases: ['garu'] },
    { id: 'psy', name: 'Psy', icon: '🌀', aliases: ['psychic', 'psi', 'psio'] },
    { id: 'nuke', name: 'Nuke', icon: '☢️', aliases: ['nuclear', 'frei'] },
    { id: 'bless', name: 'Bless', icon: '✨', aliases: ['light', 'hama', 'kouha'] },
    { id: 'curse', name: 'Curse', icon: '💀', aliases: ['dark', 'darkness', 'mudo', 'eiha'] },
];
export const ELEMENT_IDS = ELEMENTS.map(e => e.id);

/** '' is a normal affinity. */
export const AFFINITIES = {
    '': { id: '', label: '—', name: 'Normal' },
    wk: { id: 'wk', label: 'Wk', name: 'Weak' },
    rs: { id: 'rs', label: 'Rs', name: 'Resist' },
    nu: { id: 'nu', label: 'Nu', name: 'Null' },
    dr: { id: 'dr', label: 'Dr', name: 'Drain' },
    rp: { id: 'rp', label: 'Rp', name: 'Repel' },
};
/** The order a click cycles through in the panel. */
export const AFFINITY_CYCLE = ['', 'wk', 'rs', 'nu', 'dr', 'rp'];

export const ARCANA = [
    'Fool', 'Magician', 'Priestess', 'Empress', 'Emperor', 'Hierophant', 'Lovers', 'Chariot',
    'Justice', 'Hermit', 'Fortune', 'Strength', 'Hanged Man', 'Death', 'Temperance', 'Devil',
    'Tower', 'Star', 'Moon', 'Sun', 'Judgement', 'Faith', 'Councillor', 'Aeon', 'Jester',
    'Hunger', 'World',
];

// ─── Small helpers ──────────────────────────────────────────────────────────

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const clampInt = (v, lo, hi) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};

export function nameKey(name) {
    return String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** "hanged man" → "Hanged Man"; unknown names are kept as written (other games, homebrew). */
export function normalizeArcana(a) {
    const s = clip(a, 30);
    if (!s) return '';
    const hit = ARCANA.find(x => nameKey(x) === nameKey(s));
    if (hit) return hit;
    if (nameKey(s) === 'judgment') return 'Judgement';
    if (nameKey(s) === 'highpriestess') return 'Priestess';
    if (nameKey(s) === 'wheeloffortune') return 'Fortune';
    return s;
}

export function findElement(label) {
    const k = nameKey(label);
    if (!k) return null;
    return ELEMENTS.find(e => e.id === k || nameKey(e.name) === k || e.aliases.includes(k)) || null;
}

export function normalizeAffinity(v) {
    const k = nameKey(v);
    if (!k || k === 'normal' || k === 'none') return '';
    if (['wk', 'weak', 'weakness'].includes(k)) return 'wk';
    if (['rs', 'res', 'resist', 'resists', 'str', 'strong'].includes(k)) return 'rs';
    if (['nu', 'null', 'nul', 'block', 'immune', 'void'].includes(k)) return 'nu';
    if (['dr', 'drain', 'drains', 'absorb', 'abs'].includes(k)) return 'dr';
    if (['rp', 'repel', 'repels', 'reflect', 'rpl'].includes(k)) return 'rp';
    return '';
}

/** A full affinity map (every element present) from anything. */
export function normalizeAffinities(raw) {
    const out = {};
    for (const id of ELEMENT_IDS) out[id] = '';
    if (!raw || typeof raw !== 'object') return out;
    for (const [k, v] of Object.entries(raw)) {
        const e = findElement(k);
        if (e) out[e.id] = normalizeAffinity(v);
    }
    return out;
}

export function normalizeStats(raw, fallback = 1) {
    const out = {};
    const src = raw && typeof raw === 'object' ? raw : {};
    for (const id of STAT_IDS) {
        const v = src[id] ?? src[STAT_LABELS[id]] ?? src[STAT_LABELS[id].toUpperCase()];
        out[id] = clampInt(v, MIN_STAT, MAX_STAT) ?? fallback;
    }
    return out;
}

function normalizeSkillNames(list) {
    const out = [];
    const seen = new Set();
    for (const s of Array.isArray(list) ? list : []) {
        const n = clip(typeof s === 'object' && s ? s.name : s, 40);
        if (!n || seen.has(nameKey(n))) continue;
        seen.add(nameKey(n));
        out.push(n);
    }
    return out;
}

function normalizeLearns(list) {
    const out = [];
    for (const l of Array.isArray(list) ? list : []) {
        const level = clampInt(l?.level, MIN_LEVEL, MAX_LEVEL);
        const name = clip(l?.name, 40);
        if (level && name) out.push({ level, name });
    }
    return out.sort((a, b) => a.level - b.level);
}

let idCounter = 0;
export function newPersonaId() {
    idCounter = (idCounter + 1) % 1e6;
    return `p${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** A clean Persona record (or null without a name). */
export function normalizePersona(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = clip(raw.name, 40);
    if (!name) return null;
    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : newPersonaId(),
        name,
        arcana: normalizeArcana(raw.arcana),
        level: clampInt(raw.level, MIN_LEVEL, MAX_LEVEL) ?? 1,
        stats: normalizeStats(raw.stats),
        affinities: normalizeAffinities(raw.affinities),
        skills: normalizeSkillNames(raw.skills).slice(0, MAX_SKILLS),
        learns: normalizeLearns(raw.learns),
        desc: clip(raw.desc, 300),
        source: ['compendium', 'ai', 'user'].includes(raw.source) ? raw.source : 'user',
    };
}

// ─── Numbers ────────────────────────────────────────────────────────────────

/** Total stat points of a Persona at a level (10 at level 1, +3 a level). */
export function statTotalAt(level) {
    const L = clampInt(level, MIN_LEVEL, MAX_LEVEL) ?? 1;
    return 10 + POINTS_PER_LEVEL * (L - 1);
}

/**
 * Splits `points` by `weights` (largest remainder), never pushing a stat
 * past MAX_STAT: what does not fit goes to the others.
 */
function distribute(stats, points, weights) {
    const out = { ...stats };
    let left = points;
    for (let guard = 0; left > 0 && guard < 10; guard++) {
        const open = STAT_IDS.filter(id => out[id] < MAX_STAT);
        if (!open.length) break;
        const wsum = open.reduce((s, id) => s + weights[id], 0) || open.length;
        const shares = open.map(id => {
            const exact = left * (weights[id] || (wsum === open.length ? 1 : 0)) / wsum;
            return { id, base: Math.floor(exact), rest: exact - Math.floor(exact) };
        });
        let given = shares.reduce((s, x) => s + x.base, 0);
        shares.sort((a, b) => b.rest - a.rest || STAT_IDS.indexOf(a.id) - STAT_IDS.indexOf(b.id));
        for (let i = 0; given < left && i < shares.length; i++, given++) shares[i].base++;
        let spent = 0;
        for (const s of shares) {
            const room = MAX_STAT - out[s.id];
            const add = Math.min(room, s.base);
            out[s.id] += add;
            spent += add;
        }
        left -= spent;
        if (!spent) break;
    }
    return out;
}

/**
 * Stats for a new Persona at `level`: an even spread, more in `focus`
 * (the stat it leans on) and less in `weak`.
 */
export function generateStats(level, { focus = null, weak = null } = {}) {
    const weights = {};
    for (const id of STAT_IDS) weights[id] = 1;
    if (STAT_IDS.includes(focus)) weights[focus] = 1.6;
    if (STAT_IDS.includes(weak) && weak !== focus) weights[weak] = 0.6;
    const start = {};
    for (const id of STAT_IDS) start[id] = MIN_STAT;
    return distribute(start, statTotalAt(level) - STAT_IDS.length * MIN_STAT, weights);
}

/**
 * The Persona at another level: stats grow (or shrink) in proportion to
 * the ones it has, and skills of the "Learns" list come in.
 * @returns {{ persona: object, learned: string[] }}
 */
export function setPersonaLevel(persona, level) {
    const p = normalizePersona(persona);
    const to = clampInt(level, MIN_LEVEL, MAX_LEVEL) ?? p.level;
    const from = p.level;
    if (to === from) return { persona: p, learned: [] };
    const weights = { ...p.stats };
    if (to > from) {
        p.stats = distribute(p.stats, (to - from) * POINTS_PER_LEVEL, weights);
    } else {
        // Going down: take points back the same way, never below 1.
        let take = (from - to) * POINTS_PER_LEVEL;
        const sum = STAT_IDS.reduce((s, id) => s + p.stats[id], 0) || 1;
        for (const id of STAT_IDS) {
            const cut = Math.min(p.stats[id] - MIN_STAT, Math.round(take * p.stats[id] / sum));
            p.stats[id] -= cut;
        }
    }
    p.level = to;
    const learned = [];
    if (to > from) {
        for (const l of p.learns) {
            if (l.level > from && l.level <= to && !p.skills.some(s => nameKey(s) === nameKey(l.name)) && p.skills.length < MAX_SKILLS) {
                p.skills.push(l.name);
                learned.push(l.name);
            }
        }
    }
    return { persona: p, learned };
}

/** "weak Ice, Bless; resists Curse; drains Elec" — '' when all normal. */
export function describeAffinities(aff) {
    const a = normalizeAffinities(aff);
    const groups = { wk: 'weak', rs: 'resists', nu: 'nullifies', dr: 'drains', rp: 'repels' };
    const parts = [];
    for (const [k, word] of Object.entries(groups)) {
        const els = ELEMENTS.filter(e => a[e.id] === k).map(e => e.name);
        if (els.length) parts.push(`${word} ${els.join(', ')}`);
    }
    return parts.join('; ');
}

/** "St 3 Ma 4 En 3 Ag 5 Lu 2" */
export function describeStats(stats) {
    const s = normalizeStats(stats);
    return STAT_IDS.map(id => `${STAT_LABELS[id]} ${s[id]}`).join(' ');
}

// ─── Compendium (lorebook entries) ──────────────────────────────────────────

const HEADER = /^\s*persona\s*[:\-–]\s*(.+?)\s*$/i;

/** Whether a lorebook entry is a Persona entry; returns its name or null. */
export function compendiumName(entry) {
    const title = String(entry?.comment ?? '');
    let m = title.match(HEADER);
    if (m) return clip(m[1], 40);
    const first = String(entry?.content ?? '').split(/\r?\n/).find(l => l.trim());
    m = first ? first.match(HEADER) : null;
    return m ? clip(m[1], 40) : null;
}

/**
 * Reads a Persona out of a lorebook entry ({ comment, content }), or null
 * when the entry is not one.
 */
export function parseCompendiumEntry(entry) {
    const name = compendiumName(entry);
    if (!name) return null;
    const lines = String(entry?.content ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const field = (re) => {
        for (const l of lines) { const m = l.match(re); if (m) return m[1].trim(); }
        return '';
    };
    const arcana = normalizeArcana(field(/^arcana\s*[:=]\s*(.+)$/i));
    const level = clampInt(field(/^(?:level|lv\.?|lvl)\s*[:=]?\s*(\d+)/i), MIN_LEVEL, MAX_LEVEL) ?? 1;

    // Stats: the line naming at least three of St/Ma/En/Ag/Lu with a number.
    const stats = {};
    for (const l of lines) {
        const found = [...l.matchAll(/\b(st|ma|en|ag|lu)\b\s*[:=]?\s*(\d{1,2})\b/gi)];
        if (found.length >= 3) {
            for (const f of found) stats[f[1].toLowerCase()] = Number(f[2]);
            break;
        }
    }
    // Affinities: lines naming elements followed by Wk/Rs/Nu/Dr/Rp (or "-").
    const affinities = {};
    const affRe = /([A-Za-z]+)\s*[:=]?\s*(wk|weak|rs|resist|str|nu|null|block|dr|drain|absorb|rp|repel|reflect|-|—|–)(?=[\s·,;|/)]|$)/gi;
    for (const l of lines) {
        const found = [...l.matchAll(affRe)].filter(f => findElement(f[1]));
        if (found.length >= 2 || /^affinit/i.test(l)) {
            for (const f of found) affinities[findElement(f[1]).id] = normalizeAffinity(f[2]);
        }
    }
    const list = (s) => s.split(/[,;·]/).map(x => x.trim()).filter(Boolean);
    const skills = list(field(/^skills?\s*[:=]\s*(.+)$/i));
    const learns = [...field(/^learns?\s*[:=]\s*(.+)$/i).matchAll(/lv\.?\s*(\d+)\s*[:\-]?\s*([^,;·]+)/gi)]
        .map(m => ({ level: Number(m[1]), name: m[2].trim() }));
    const desc = field(/^(?:description|desc)\s*[:=]\s*(.+)$/i);

    const p = normalizePersona({ name, arcana, level, stats, affinities, skills, learns, desc, source: 'compendium' });
    // An entry without stats gets the even spread of its level.
    if (Object.keys(stats).length < 3) p.stats = generateStats(level);
    return p;
}

/** Every Persona in a list of lorebook entries (the first of a name wins). */
export function parseCompendium(entries) {
    const out = [];
    const seen = new Set();
    for (const e of entries || []) {
        if (!e || e.disable) continue;
        const p = parseCompendiumEntry(e);
        if (!p || seen.has(nameKey(p.name))) continue;
        seen.add(nameKey(p.name));
        out.push(p);
    }
    return out;
}

/** A Compendium Persona copied for a character, at its own level or `level` if higher. */
export function personaFromCompendium(def, { level = null } = {}) {
    let p = normalizePersona({ ...def, id: undefined, source: 'compendium' });
    const want = clampInt(level, MIN_LEVEL, MAX_LEVEL);
    if (want && want > p.level) p = setPersonaLevel(p, want).persona;
    return p;
}

/** A Persona the AI (or the user) described, with program-made stats. */
export function personaFromDescription(raw, { level = 1 } = {}) {
    const L = clampInt(raw?.level, MIN_LEVEL, MAX_LEVEL) ?? clampInt(level, MIN_LEVEL, MAX_LEVEL) ?? 1;
    const focus = STAT_IDS.includes(String(raw?.focus).toLowerCase()) ? String(raw.focus).toLowerCase() : null;
    const weak = STAT_IDS.includes(String(raw?.weak).toLowerCase()) ? String(raw.weak).toLowerCase() : null;
    return normalizePersona({
        name: raw?.name,
        arcana: raw?.arcana,
        level: L,
        stats: generateStats(L, { focus, weak }),
        affinities: raw?.affinities,
        skills: Array.isArray(raw?.skills) ? raw.skills : (typeof raw?.skills === 'string' ? raw.skills.split(',') : []),
        desc: raw?.desc ?? raw?.description,
        source: raw?.source || 'ai',
    });
}

// ─── The AI's "personas" key ────────────────────────────────────────────────

/**
 * → [{ name, add: [descriptions], equip: string|null, learn: [skill names] }].
 * Accepts {"Joker": {"add": {...}|[...], "equip": "Pixie", "learn": ["Zio"]}}
 * and [{"name": "Joker", ...}]; "awaken" is read as "add".
 */
export function normalizeAIPersonas(raw) {
    let data = raw;
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { return []; }
    }
    if (!data || typeof data !== 'object') return [];
    const out = [];
    const push = (name, v) => {
        if (typeof name !== 'string' || !name.trim() || !v || typeof v !== 'object') return;
        const addRaw = v.add ?? v.awaken ?? v.obtain ?? v.new;
        const add = (Array.isArray(addRaw) ? addRaw : addRaw ? [addRaw] : [])
            .map(a => (typeof a === 'string' ? { name: a } : a))
            .filter(a => a && typeof a === 'object' && clip(a.name, 40));
        const equip = typeof v.equip === 'string' ? clip(v.equip, 40) : (typeof v.switch === 'string' ? clip(v.switch, 40) : null);
        const learnRaw = v.learn ?? v.learns ?? v.skills;
        const learn = normalizeSkillNames(Array.isArray(learnRaw) ? learnRaw : typeof learnRaw === 'string' ? [learnRaw] : []);
        if (add.length || equip || learn.length) out.push({ name: name.trim(), add, equip, learn });
    };
    if (Array.isArray(data)) {
        for (const e of data) if (e && typeof e === 'object') push(e.name ?? e.character, e);
    } else {
        for (const [k, v] of Object.entries(data)) push(k, v);
    }
    return out;
}

/** One line for a character's equipped Persona. */
export function describePersona(p) {
    const aff = describeAffinities(p.affinities);
    return `${p.name} (${p.arcana || 'unknown Arcana'}, Lv ${p.level}) ${describeStats(p.stats)}${aff ? ` | ${aff}` : ''}${p.skills.length ? ` | skills: ${p.skills.join(', ')}` : ''}`;
}

/**
 * The prompt section.
 * @param {Array<{name, isUser, wildCard, active, others: string[]}>} owners - scene characters with Personas
 * @param {string[]} compendium - Persona names in the Compendium
 */
export function buildPersonaPrompt({ owners = [], wildCards = [], compendium = [], compact = true, standalone = false } = {}) {
    const where = standalone ? 'start your reply with ONE JSON code block with' : 'add to the same tracker JSON object';
    let out = compact
        ? 'PERSONAS (a character\'s St/Ma/En/Ag/Lu are those of the Persona they have equipped):\n'
        : 'PERSONAS — as in Persona 3/4/5, a character\'s St, Ma, En, Ag and Lu are those of the Persona they have equipped, and its affinities decide what hurts it:\n';
    if (owners.length) {
        out += owners.map(o => `- ${o.name}${o.wildCard ? ' [Wild Card]' : ''}: ${o.active ? describePersona(o.active) : 'none equipped'}${o.others.length ? `. Also holds: ${o.others.join(', ')}` : ''}`).join('\n') + '\n';
    } else {
        out += '- Nobody has awakened a Persona yet.\n';
    }
    const ex = '{"Name": {"add": {"name": "Pixie", "arcana": "Lovers", "focus": "ma", "affinities": {"Elec": "rs", "Gun": "wk"}, "skills": ["Zio", "Dia"]}}}';
    out += compact
        ? `When someone awakens or obtains a Persona, ${where} "personas": ${ex} (focus = the stat it leans on; affinities wk/rs/nu/dr/rp over Phys, Gun, Fire, Ice, Elec, Wind, Psy, Nuke, Bless, Curse). The program sets the numbers. `
        : `When a character awakens a Persona or obtains a new one, ${where} "personas": ${ex} — "focus" is the stat it leans on (st, ma, en, ag or lu); affinities use wk (weak), rs (resist), nu (null), dr (drain), rp (repel) over Phys, Gun, Fire, Ice, Elec, Wind, Psy, Nuke, Bless and Curse. The program sets every number. `;
    out += wildCards.length
        ? `Only a Wild Card (${wildCards.join(', ')}) can hold several and switch: {"Name": {"equip": "Pixie"}}; for anyone else a new Persona replaces the old one (an evolution). `
        : 'A character holds one Persona; a new one replaces it (an evolution). ';
    out += 'When the story teaches the equipped Persona a skill: {"Name": {"learn": ["Zio"]}}. Leave the key out when nothing changes.';
    if (compendium.length) out += `\nKnown Personas (use these names when one fits): ${compendium.slice(0, 60).join(', ')}.`;
    return out.trim();
}
