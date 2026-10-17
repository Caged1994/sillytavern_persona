/**
 * Combat — pure model.
 *
 * Turn-based fights where the numbers come from the extension, not from the
 * AI: hit chance, damage, defence, healing, statuses, initiative, enemy
 * behaviour, flight and rewards are all computed here from the characters'
 * attributes, equipment and skills. The AI only invents the enemies, labels
 * skills the first time (see "profiles") and tells the story afterwards.
 *
 * No SillyTavern imports: plain data in, plain data out, so it can be tested
 * outside the browser. Randomness comes from state.rng (a number that
 * advances with every roll), so a fight is reproducible and can be saved and
 * resumed. Storage, UI and prompts live elsewhere.
 *
 * Shapes
 *   profile   what an action does:
 *             { type: 'damage'|'heal'|'status'|'mana'|'cure'|'revive'|'gear'|'none',
 *               power: 'light'|'medium'|'heavy',
 *               stat:  attribute id the effect scales with ('none' for flat effects),
 *               target:'enemy'|'enemies'|'ally'|'allies'|'self',
 *               status: a STATUSES id applied by the action (optional),
 *               atk, def: bonuses of a piece of gear (type 'gear') }
 *   action    { id, label, icon, kind: 'basic'|'spell'|'ability'|'item',
 *               profile, manaCost (points of the SP bar), cooldown (turns),
 *               qty (items) }
 *   combatant { id, name, side: 'party'|'enemy', isUser, icon, level, attrs,
 *               maxHp, hp, mana (0–100, null when SP is not tracked),
 *               armor, atkBonus, actions, statuses, cooldowns, guard, down,
 *               affinities { element: ''|'wk'|'rs'|'nu'|'dr'|'rp' }, knocked,
 *               walls/breaks { element: turns }, baton, known { element: true } }
 *
 * Persona rules (P3/P4/P5):
 *   - Every damaging action has an element; the target's affinity to it
 *     decides the result: Weak ×1.25, Resist ×0.5, Null blocks, Drain heals
 *     the target, Repel sends the damage back. Almighty ignores affinities.
 *   - Hitting a weakness, a critical hit (Phys/Gun) or a "technical" (an
 *     element that exploits an ailment the target has) knocks the target
 *     down and gives the attacker "1 More": another action at once. A
 *     knocked-down fighter cannot dodge and gets up at the start of their
 *     turn. (Enemy criticals hurt but do not knock down.)
 *   - During a 1 More, a party member can Baton Pass it to an ally who has
 *     not had it in this chain (+50% damage and healing per pass), or, when
 *     every enemy is down, launch an All-Out Attack.
 *   - Skills from the Persona skill database (type 'skill', see
 *     skillModel.js) carry their own power, hits, accuracy, crit, ailment
 *     and costs (SP, or HP for Phys skills).
 */
import { BOND_IDS, followUpChance, harisenChance } from './bondModel.js';

// ─── Tuning ─────────────────────────────────────────────────────────────────

export const TUNING = {
    // Calibrated for the 1–99 Persona scale: a character starts around 10 in
    // every attribute and gains about 0.6 per attribute per level (3 points
    // a level over five attributes), so ~40 at level 50 and ~70 at level 99.
    // HP, damage and healing all grow with level as well as attributes, so a
    // fight between equals takes 4–6 hits at any level.
    hpBase: 30, hpPerEn: 3, hpPerLevel: 6,
    // Hit and flee chances compare the two sides' Agility as a ratio, so they
    // mean the same at level 1 and at level 99.
    // As in the games, most attacks land: ~90% between equals, magic a bit more.
    hitBase: 0.9, hitSpread: 0.3, hitMin: 0.25, hitMax: 0.98, spellAccuracy: 0.05,
    critChance: 0.05, critPerLu: 0.15, critMax: 0.25, critMult: 1.5,
    dmgBase: 5, dmgPerAttr: 1.0, dmgPerLevel: 1.5,
    varMin: 0.85, varMax: 1.15,
    // Armour is weighed against the attacker's own attribute; gear grows
    // with the wearer's level (+5% per level) so a good weapon still counts later.
    defPerEn: 0.5, defPerAtk: 1.0, defK: 10, magicArmorShare: 0.5, gearPerLevel: 0.05,
    aoeMult: 0.65,
    powerMult: { light: 1, medium: 1.5, heavy: 2.2 },
    healBase: 5, healPerAttr: 1.0, healPerLevel: 1.5, healMult: 1.5,
    itemHealPct: { light: 0.25, medium: 0.45, heavy: 0.7 },
    itemMana: { light: 15, medium: 30, heavy: 50 },
    itemBomb: { light: 12, medium: 22, heavy: 38 }, bombPerLevel: 2,
    revivePct: { light: 0.2, medium: 0.35, heavy: 0.5 },
    cooldown: { light: 0, medium: 1, heavy: 3 },
    statusChance: 0.6,
    statusTurns: 3,
    dotPct: { burn: 0.07, poison: 0.06, bleed: 0.05 },
    regenPct: 0.06,
    weakenMult: 0.75, empowerMult: 1.3,
    vulnerableMult: 1.25, shieldMult: 0.6, guardMult: 0.5,
    fleeBase: 0.5, fleeSpread: 0.6, fleeMin: 0.2, fleeMax: 0.9, fleeBossPenalty: 0.3,
    // Enemy strength by category: attribute scale, hit points scale, XP tier, money.
    tiers: {
        minion: { attr: 0.8, hp: 0.5, xp: 'small', money: 3, moneyCap: 20, label: 'Minion' },
        normal: { attr: 0.95, hp: 1.0, xp: 'medium', money: 8, moneyCap: 60, label: 'Normal' },
        elite: { attr: 1.15, hp: 1.9, xp: 'large', money: 25, moneyCap: 200, label: 'Elite' },
        boss: { attr: 1.4, hp: 3.2, xp: 'epic', money: 80, moneyCap: 800, label: 'Boss' },
    },
    // Each party member after the first adds this much to enemy hit points.
    hpPerExtraHero: 0.45,
    affinityWin: 3, affinityFlee: -2,
    maxLog: 300,
    // Persona rules.
    weakMult: 1.25, resistMult: 0.5,
    skillPowerRef: 40, skillPowerMin: 0.5, skillPowerMax: 4.5, skillCritCap: 0.6,
    batonStep: 0.5, batonMax: 3, allOutMult: 1.3, chargeMult: 2.5,
    ailmentTurns: 3, bossAilmentMult: 0.5, buffTurns: 3,
    swiftHit: 0.12, dizzyHitMult: 0.5, rageAtkMult: 1.5, rageInMult: 1.3, maybeSkipChance: 0.5,
    drainPerLevel: 0.1, drainSp: 6,
};

export const POWERS = ['light', 'medium', 'heavy'];
export const TIERS = Object.keys(TUNING.tiers);
export const ATTRIBUTE_IDS = ['st', 'ma', 'en', 'ag', 'lu'];
// Everything but Magic counts as physical when it comes to armour.
const PHYSICAL = new Set(['st', 'en', 'ag', 'lu']);
export const TARGETS = ['enemy', 'enemies', 'ally', 'allies', 'self'];
export const PROFILE_TYPES = ['damage', 'heal', 'status', 'mana', 'cure', 'revive', 'gear', 'none', 'skill'];
/** Elements of damage (Persona 5's ten plus Almighty). */
export const ELEMENTS = ['phys', 'gun', 'fire', 'ice', 'elec', 'wind', 'psy', 'nuke', 'bless', 'curse', 'almighty'];
const PHYS_ELEMENTS = new Set(['phys', 'gun']);
export const AFFINITY_VALUES = ['', 'wk', 'rs', 'nu', 'dr', 'rp'];

/** The statuses a fight knows. `bad` ones are harmful and cured by 'cure'. */
export const STATUSES = {
    burn: { icon: '🔥', name: 'Burning', bad: true, dot: true },
    poison: { icon: '☠️', name: 'Poisoned', bad: true, dot: true },
    bleed: { icon: '🩸', name: 'Bleeding', bad: true, dot: true },
    stun: { icon: '💫', name: 'Stunned', bad: true },
    weaken: { icon: '⬇️', name: 'Weakened', bad: true },
    vulnerable: { icon: '🎯', name: 'Vulnerable', bad: true },
    shield: { icon: '🛡️', name: 'Shielded', bad: false },
    empower: { icon: '⬆️', name: 'Empowered', bad: false },
    regen: { icon: '💚', name: 'Regenerating', bad: false },
    // Persona ailments.
    freeze: { icon: '🧊', name: 'Frozen', bad: true, skip: true, ailment: true },
    shock: { icon: '⚡', name: 'Shocked', bad: true, skip: true, ailment: true },
    sleep: { icon: '💤', name: 'Asleep', bad: true, skip: true, ailment: true },
    dizzy: { icon: '😵', name: 'Dizzy', bad: true, ailment: true },
    confuse: { icon: '❓', name: 'Confused', bad: true, maybeSkip: true, ailment: true, mental: true },
    fear: { icon: '😱', name: 'Afraid', bad: true, maybeSkip: true, ailment: true, mental: true },
    forget: { icon: '🫥', name: 'Forgetful', bad: true, sealed: true, ailment: true, mental: true },
    rage: { icon: '💢', name: 'Enraged', bad: true, sealed: true, ailment: true, mental: true },
    despair: { icon: '😞', name: 'Despairing', bad: true, skip: true, ailment: true, mental: true },
    brainwash: { icon: '🌀', name: 'Brainwashed', bad: true, maybeSkip: true, ailment: true, mental: true },
    // -kaja / -kunda and the like.
    swift: { icon: '💨', name: 'Swift', bad: false },
    sluggish: { icon: '🐌', name: 'Sluggish', bad: true },
    charged: { icon: '💪', name: 'Charged', bad: false },
    focused: { icon: '🔮', name: 'Concentrating', bad: false },
    tetrakarn: { icon: '🔷', name: 'Physical mirror', bad: false },
    makarakarn: { icon: '🔶', name: 'Magic mirror', bad: false },
};
/** The game's ailment names → statuses here. */
export const AILMENT_STATUS = {
    burn: 'burn', freeze: 'freeze', shock: 'shock', dizzy: 'dizzy', sleep: 'sleep', confuse: 'confuse',
    fear: 'fear', forget: 'forget', rage: 'rage', despair: 'despair', brainwash: 'brainwash', hunger: 'weaken',
    poison: 'poison', charm: 'brainwash', distress: 'vulnerable', panic: 'confuse', silence: 'forget', mute: 'forget',
    exhaustion: 'weaken', enervation: 'weaken',
};
/** Ailment → elements that turn a hit on it into a "technical" (crit-like, knocks down). */
export const TECHNICAL = {
    burn: ['wind', 'nuke'], freeze: ['phys', 'gun', 'nuke'], shock: ['phys', 'gun', 'nuke'], sleep: ['phys', 'gun'],
    confuse: ['psy'], fear: ['psy'], forget: ['psy'], rage: ['psy'], despair: ['psy'], brainwash: ['psy'],
};
export const STATUS_IDS = Object.keys(STATUSES);

/** How much each enemy category counts towards how dangerous a fight is. */
export const THREAT = { minion: 1, normal: 2, elite: 4, boss: 8 };

/**
 * How hard a fight is likely to be for a party, from the enemy categories
 * and the number of fighters (calibrated against simulated fights).
 * @returns {{ id: 'easy'|'fair'|'hard'|'deadly', label: string, ratio: number }}
 */
export function threatRating(tiers, partySize) {
    const threat = (tiers || []).reduce((sum, t) => sum + (THREAT[t] ?? THREAT.normal), 0);
    const ratio = threat / (Math.max(1, partySize) * 2.2);
    const id = ratio < 0.7 ? 'easy' : ratio < 1.2 ? 'fair' : ratio < 1.8 ? 'hard' : 'deadly';
    return { id, label: { easy: 'Easy', fair: 'Fair', hard: 'Hard', deadly: 'Deadly' }[id], ratio };
}

// ─── Small helpers ──────────────────────────────────────────────────────────

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Next random number in [0, 1) — mulberry32 on state.rng. */
export function nextRandom(state) {
    state.rng = (state.rng + 0x6D2B79F5) >>> 0;
    let t = state.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function attrValue(c, id) {
    const v = c?.attrs?.[id];
    return isNum(v) ? v : 10;
}

export function maxHpFor(en, level) {
    return Math.max(10, Math.round(TUNING.hpBase + (isNum(en) ? en : 10) * TUNING.hpPerEn + (level || 1) * TUNING.hpPerLevel));
}

function powerOf(profile) {
    return POWERS.includes(profile?.power) ? profile.power : 'light';
}

export function hasStatus(c, id) {
    return (c.statuses || []).some(s => s.id === id);
}

// ─── Profiles: what an action does ──────────────────────────────────────────

/** Cleans a profile (from the AI or the user); null when unusable. */
export function normalizeProfile(raw, attributeIds = ATTRIBUTE_IDS) {
    if (!raw || typeof raw !== 'object') return null;
    const type = String(raw.type ?? raw.kind ?? '').toLowerCase().trim();
    const t = PROFILE_TYPES.includes(type) ? type : (type === 'attack' ? 'damage' : type === 'buff' || type === 'debuff' ? 'status' : null);
    if (!t) return null;
    const power = POWERS.includes(String(raw.power).toLowerCase()) ? String(raw.power).toLowerCase() : 'light';
    const statRaw = String(raw.stat ?? raw.attribute ?? '').toLowerCase().trim();
    const wantsStat = t === 'damage' || t === 'heal';
    const stat = statRaw === 'none' ? 'none'
        : (attributeIds.includes(statRaw) ? statRaw : (wantsStat ? 'st' : 'none'));
    let target = String(raw.target ?? '').toLowerCase().trim();
    if (!TARGETS.includes(target)) target = t === 'damage' || (t === 'status' && STATUSES[raw.status]?.bad) ? 'enemy' : (t === 'heal' || t === 'mana' || t === 'cure' || t === 'revive' ? 'ally' : 'self');
    const status = STATUS_IDS.includes(String(raw.status ?? '').toLowerCase()) ? String(raw.status).toLowerCase() : undefined;
    if (t === 'skill') {
        // Built by skillModel.profileFromSkill: kept as it is.
        return raw.fx && typeof raw.fx === 'object' ? { ...raw } : null;
    }
    const out = { type: t, power, stat, target };
    if (status) out.status = status;
    const el = String(raw.element ?? '').toLowerCase().trim();
    if (ELEMENTS.includes(el) && t === 'damage') out.element = el;
    if (t === 'status' && !status) return null;
    if (t === 'gear') {
        out.atk = clamp(Math.round(Number(raw.atk) || 0), 0, 15);
        out.def = clamp(Math.round(Number(raw.def) || 0), 0, 15);
    }
    return out;
}

const KEYWORDS = [
    { re: /\b(heal|cure|bandage|medkit|first aid|potion of heal|health potion|healing|cura|guarisc|guarigione|benda|pozione di cura|medikit|pronto soccorso)/i, p: { type: 'heal', stat: 'ma', target: 'ally' } },
    { re: /\b(revive|resurrect|phoenix|rianima|resuscita)/i, p: { type: 'revive', stat: 'none', target: 'ally' } },
    { re: /\b(antidote|remedy|purify|cleanse|antidoto|purifica)/i, p: { type: 'cure', stat: 'none', target: 'ally' } },
    { re: /\b(mana|ether|elixir of mana|energy drink|eter)/i, p: { type: 'mana', stat: 'none', target: 'ally' } },
    { re: /\b(shield|barrier|protect|ward|guard up|scudo|barriera|proteggi)/i, p: { type: 'status', status: 'shield', stat: 'none', target: 'ally' } },
    { re: /\b(haste|rage|bless|empower|inspire|furia|benedi|potenzia|ispira)/i, p: { type: 'status', status: 'empower', stat: 'none', target: 'ally' } },
    { re: /\b(stun|paralyz|freeze|sleep|stordi|paralizz|congela|addorment)/i, p: { type: 'status', status: 'stun', stat: 'none', target: 'enemy' } },
    { re: /\b(weaken|curse|hex|debilit|maledi)/i, p: { type: 'status', status: 'weaken', stat: 'none', target: 'enemy' } },
    { re: /\b(poison|venom|veleno|velen)/i, p: { type: 'damage', status: 'poison', stat: 'ag', target: 'enemy' } },
    { re: /\b(fire|flame|burn|inferno|blaze|explosion|fuoco|fiamma|brucia|esplosion)/i, p: { type: 'damage', status: 'burn', stat: 'ma', target: 'enemy', element: 'fire' } },
    { re: /\b(ice|frost|freez|blizzard|ghiaccio|gelo)/i, p: { type: 'damage', stat: 'ma', target: 'enemy', element: 'ice' } },
    { re: /\b(lightning|thunder|bolt|shock|fulmine|tuono|scossa)/i, p: { type: 'damage', stat: 'ma', target: 'enemy', element: 'elec' } },
    { re: /\b(wind|gale|tornado|gust|vento|raffica)/i, p: { type: 'damage', stat: 'ma', target: 'enemy', element: 'wind' } },
    { re: /\b(holy|light|bless|divine|sacr|luce|santo)/i, p: { type: 'damage', stat: 'ma', target: 'enemy', element: 'bless' } },
    { re: /\b(dark|curse|shadow|hex|oscur|maledi|ombra)/i, p: { type: 'damage', stat: 'ma', target: 'enemy', element: 'curse' } },
    { re: /\b(gun|pistol|rifle|shot|bullet|pistola|fucile|sparo|proiettil)/i, p: { type: 'damage', stat: 'st', target: 'enemy', element: 'gun' } },
    { re: /\b(bleed|slash|rend|sanguin|taglio|squarcia)/i, p: { type: 'damage', status: 'bleed', stat: 'st', target: 'enemy' } },
    { re: /\b(lightning|thunder|bolt|ice|frost|storm|magic|arcane|spell|fulmine|tuono|ghiaccio|tempesta|magia|arcano|incantesimo)/i, p: { type: 'damage', stat: 'ma', target: 'enemy' } },
    { re: /\b(bomb|grenade|dynamite|molotov|bomba|granata|dinamite)/i, p: { type: 'damage', stat: 'none', target: 'enemy' } },
    { re: /\b(sword|blade|dagger|knife|axe|mace|hammer|spear|bow|crossbow|gun|pistol|rifle|club|staff|spada|lama|pugnale|coltello|ascia|mazza|martello|lancia|arco|balestra|pistola|fucile|bastone)/i, p: { type: 'gear', atk: 4, def: 0, stat: 'none', target: 'self' } },
    { re: /\b(armor|armour|helmet|vest|shield|cuirass|plate|mail|jacket|armatura|elmo|giubbotto|corazza|cotta|giacca)/i, p: { type: 'gear', atk: 0, def: 4, stat: 'none', target: 'self' } },
];

/**
 * A best guess from the name and description, for when the AI has not
 * labelled the action (or is not reachable). `kind` is 'spell', 'ability' or
 * 'item'; `effects` the item's attribute bonuses ({ st: 2 }).
 */
export function guessProfile(kind, name, desc = '', { cost = null, effects = null } = {}) {
    const text = `${name || ''} ${desc || ''}`;
    for (const { re, p } of KEYWORDS) {
        if (!re.test(text)) continue;
        if (kind === 'item' && (p.type === 'gear')) continue; // gear is decided below
        if (kind !== 'item' && p.type === 'gear') continue;
        return normalizeProfile({ ...p, power: cost && POWERS.includes(cost) ? cost : 'medium' });
    }
    if (kind === 'item') {
        for (const { re, p } of KEYWORDS) {
            if (p.type === 'gear' && re.test(text)) return normalizeProfile(p);
        }
        const atk = (effects?.st > 0 ? effects.st : 0) + (effects?.ag > 0 ? effects.ag : 0);
        const def = effects?.en > 0 ? effects.en : 0;
        if (atk || def) return normalizeProfile({ type: 'gear', atk: Math.min(atk * 2, 15), def: Math.min(def * 2, 15) });
        return normalizeProfile({ type: 'none' });
    }
    // A skill that only gives always-on bonuses ("En +2") is passive, not an attack.
    if (kind === 'ability' && effects && Object.keys(effects).length) return normalizeProfile({ type: 'none' });
    if (kind === 'spell') return normalizeProfile({ type: 'damage', stat: 'ma', target: 'enemy', power: cost && POWERS.includes(cost) ? cost : 'medium' });
    return normalizeProfile({ type: 'damage', stat: 'st', target: 'enemy', power: 'medium' });
}

/** Whether an item can be used during a fight (consumed or thrown). */
export function isUsableItemProfile(p) {
    return !!p && ['damage', 'heal', 'status', 'mana', 'cure', 'revive'].includes(p.type);
}

// ─── Combatants ─────────────────────────────────────────────────────────────

/** The attack everybody has. */
export function basicAttack(c) {
    const stat = attrValue(c, 'ag') > attrValue(c, 'st') ? 'ag' : 'st';
    return { id: 'basic', label: 'Attack', icon: '⚔️', kind: 'basic', profile: { type: 'damage', power: 'light', stat, target: 'enemy', element: 'phys' }, manaCost: 0, cooldown: 0 };
}

/** A full affinity map (every element) from anything. */
export function normalizeAffinityMap(raw) {
    const out = {};
    for (const el of ELEMENTS) out[el] = '';
    if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) {
            const el = String(k).toLowerCase();
            const val = String(v ?? '').toLowerCase();
            if (ELEMENTS.includes(el) && el !== 'almighty' && AFFINITY_VALUES.includes(val)) out[el] = val;
        }
    }
    return out;
}

/**
 * Builds a combatant. `healthPct` (0–100) starts them partly wounded;
 * `mana` (SP) is a percentage or null when the SP bar is off.
 */
export function makeCombatant(spec) {
    const attrs = { ...(spec.attrs || {}) };
    for (const id of ATTRIBUTE_IDS) if (!isNum(attrs[id])) attrs[id] = 10;
    const level = Math.max(1, Math.round(spec.level || 1));
    const maxHp = isNum(spec.maxHp) ? Math.max(1, Math.round(spec.maxHp)) : maxHpFor(attrs.en, level);
    let hp = maxHp;
    if (isNum(spec.hp)) hp = clamp(Math.round(spec.hp), 0, maxHp);
    else if (isNum(spec.healthPct)) hp = clamp(Math.round(maxHp * spec.healthPct / 100), 1, maxHp);
    const c = {
        id: spec.id,
        name: String(spec.name || 'Unknown'),
        side: spec.side === 'enemy' ? 'enemy' : 'party',
        isUser: !!spec.isUser,
        icon: spec.icon || (spec.side === 'enemy' ? '👹' : '🙂'),
        level, attrs, maxHp, hp,
        mana: isNum(spec.mana) ? clamp(Math.round(spec.mana * 100) / 100, 0, 100) : null,
        spMax: isNum(spec.spMax) ? spec.spMax : null,
        armor: Math.max(0, Math.round(spec.armor || 0)),
        atkBonus: Math.max(0, Math.round(spec.atkBonus || 0)),
        actions: [],
        statuses: [],
        cooldowns: {},
        guard: false,
        down: hp <= 0,
        stunImmune: 0,
        affinities: normalizeAffinityMap(spec.affinities),
        knocked: false,
        walls: {},
        breaks: {},
        baton: 0,
        known: {},
    };
    if (spec.persona) c.persona = String(spec.persona);
    // Confidant abilities of a teammate (bondModel.js): { rank, abilities: [ids] }.
    if (spec.bond && Array.isArray(spec.bond.abilities)) {
        c.bond = { rank: Math.round(spec.bond.rank) || 0, abilities: spec.bond.abilities.filter(x => BOND_IDS.includes(x)), ranks: { ...(spec.bond.ranks || {}) } };
        c.bondUsed = {};
    }
    if (spec.tier) c.tier = spec.tier;
    if (spec.description) c.description = String(spec.description);
    if (spec.loot) c.loot = spec.loot;
    const extra = Array.isArray(spec.actions) ? spec.actions : [];
    c.actions = [basicAttack(c), ...extra.filter(a => a && a.id && a.id !== 'basic')];
    return c;
}

/**
 * Builds an enemy from the AI's description. The AI picks the category and
 * what the enemy can do; the numbers come from the category and the party's
 * level, so it cannot unbalance the fight.
 * spec: { name, description, icon, tier, levelDelta, focus, attacks: [{ name, power, stat, status, target, type }], loot }
 */
export function buildEnemy(spec, { partyLevel = 1, partySize = 1, id }) {
    const tierId = TIERS.includes(String(spec.tier).toLowerCase()) ? String(spec.tier).toLowerCase() : 'normal';
    const tier = TUNING.tiers[tierId];
    const delta = clamp(Math.round(Number(spec.levelDelta) || 0), -2, 3);
    const level = Math.max(1, partyLevel + delta);
    // Same growth as a character: ~10 at level 1, ~0.6 per level after.
    const base = (10 + (level - 1) * 0.6) * tier.attr;
    const attrs = {};
    for (const a of ATTRIBUTE_IDS) attrs[a] = Math.round(base);
    const focus = ATTRIBUTE_IDS.includes(String(spec.focus).toLowerCase()) ? String(spec.focus).toLowerCase() : null;
    if (spec.shape && typeof spec.shape === 'object') {
        // A Persona's stat shape (e.g. from the Compendium): same total, its proportions.
        const sum = ATTRIBUTE_IDS.reduce((t, a) => t + (isNum(spec.shape[a]) ? spec.shape[a] : 0), 0);
        if (sum > 0) for (const a of ATTRIBUTE_IDS) attrs[a] = Math.max(1, Math.round(base * 5 * (spec.shape[a] || 0) / sum));
    } else if (focus) attrs[focus] = Math.round(base * 1.25);
    const maxHp = Math.max(8, Math.round(maxHpFor(attrs.en, level) * tier.hp * (1 + TUNING.hpPerExtraHero * Math.max(0, partySize - 1))));
    const primary = focus || 'st';
    const actions = [];
    (Array.isArray(spec.attacks) ? spec.attacks : []).slice(0, 4).forEach((a, i) => {
        // A skill from the database comes with its profile already made.
        if (a && a.profile && a.profile.type === 'skill') {
            actions.push({
                id: `atk${i}`, label: String(a.name || a.profile.skill || `Skill ${i + 1}`).slice(0, 40), icon: a.icon || '💥', kind: 'ability',
                profile: a.profile, manaCost: 0, hpCost: 0, cooldown: TUNING.cooldown[a.profile.power] || 0,
            });
            return;
        }
        const prof = normalizeProfile({
            type: a.type || 'damage',
            power: a.power || 'medium',
            stat: a.stat || primary,
            target: a.target,
            status: a.status,
            element: a.element,
        });
        if (!prof || prof.type === 'gear' || prof.type === 'none') return;
        actions.push({
            id: `atk${i}`, label: String(a.name || `Attack ${i + 1}`).slice(0, 40), icon: a.icon || '💥', kind: 'ability',
            profile: prof, manaCost: 0, cooldown: TUNING.cooldown[prof.power],
        });
    });
    const c = makeCombatant({
        id, side: 'enemy', name: spec.name, icon: spec.icon || '👹', level, attrs, maxHp,
        tier: tierId, description: spec.description, loot: spec.loot, actions,
        affinities: spec.affinities, persona: spec.persona,
    });
    return c;
}

// ─── State ──────────────────────────────────────────────────────────────────

/**
 * A new fight. `combatants` is the party and the enemies; `seed` makes it
 * reproducible. Call startCombat() to roll initiative and begin.
 */
export function createCombat({ combatants, seed = Date.now(), environment = '', title = '' } = {}) {
    return {
        v: 1,
        phase: 'setup', // setup → active → ended
        result: null,   // 'victory' | 'defeat' | 'fled'
        round: 0,
        order: [],
        turn: 0,
        rng: (seed >>> 0) || 1,
        combatants: combatants || [],
        log: [],
        environment, title,
        seq: 0,
    };
}

export const getCombatant = (state, id) => state.combatants.find(c => c.id === id) || null;
export const alive = (state, side) => state.combatants.filter(c => c.side === side && !c.down);
const opposite = (side) => (side === 'party' ? 'enemy' : 'party');

export function currentActor(state) {
    if (state.phase !== 'active') return null;
    if (state.extra && state.extra.actor) return getCombatant(state, state.extra.actor);
    return getCombatant(state, state.order[state.turn]);
}

/** Whether the current actor is in a 1 More (an extra action). */
export function inOneMore(state) {
    return !!(state.phase === 'active' && state.extra && state.extra.actor);
}

function push(state, events, ev) {
    const e = { n: ++state.seq, round: state.round, ...ev };
    events.push(e);
    state.log.push(e);
    if (state.log.length > TUNING.maxLog) state.log.splice(0, state.log.length - TUNING.maxLog);
    return e;
}

/** Rolls initiative (Ag + d10) and opens the first turn. */
export function startCombat(state) {
    const events = [];
    const roll = {};
    for (const c of state.combatants) roll[c.id] = attrValue(c, 'ag') + Math.floor(nextRandom(state) * 10) + 1;
    state.order = state.combatants.filter(c => !c.down)
        .sort((a, b) => (roll[b.id] - roll[a.id]) || (a.side === b.side ? 0 : a.side === 'party' ? -1 : 1))
        .map(c => c.id);
    state.phase = 'active';
    state.round = 1;
    state.turn = 0;
    push(state, events, { type: 'info', text: `Round 1 — ${state.order.map(id => getCombatant(state, id).name).join(', ')}` });
    beginTurn(state, events);
    return events;
}

// ─── Statuses ───────────────────────────────────────────────────────────────

function applyStatus(state, events, source, target, id, turns = TUNING.statusTurns) {
    const def = STATUSES[id];
    if (!def || target.down) return false;
    if (id === 'stun' || id === 'freeze' || id === 'shock') {
        if (target.stunImmune > 0 || (target.tier === 'boss' && nextRandom(state) < 0.5)) {
            push(state, events, { type: 'resist', actor: source?.id, target: target.id, text: `${target.name} resists being stunned.` });
            return false;
        }
        turns = 1;
    }
    const cur = target.statuses.find(s => s.id === id);
    if (cur) cur.turns = Math.max(cur.turns, turns);
    else target.statuses.push({ id, turns });
    push(state, events, { type: 'status', actor: source?.id, target: target.id, status: id, text: `${target.name} is ${def.name.toLowerCase()} ${def.icon}` });
    return true;
}

function atkMult(c) {
    let m = 1;
    if (hasStatus(c, 'weaken')) m *= TUNING.weakenMult;
    if (hasStatus(c, 'empower')) m *= TUNING.empowerMult;
    if (hasStatus(c, 'rage')) m *= TUNING.rageAtkMult;
    if (c.baton) m *= 1 + TUNING.batonStep * c.baton;
    return m;
}

function inMult(c) {
    let m = 1;
    if (c.guard) m *= TUNING.guardMult;
    if (hasStatus(c, 'shield')) m *= TUNING.shieldMult;
    if (hasStatus(c, 'vulnerable')) m *= TUNING.vulnerableMult;
    if (hasStatus(c, 'rage')) m *= TUNING.rageInMult;
    return m;
}

/** The element an action deals damage with. */
export function elementOf(profile) {
    if (!profile) return 'phys';
    if (ELEMENTS.includes(profile.element)) return profile.element;
    if (profile.stat === 'ma' || profile.stat === 'none') return 'almighty';
    return 'phys';
}

/** The target's affinity to an element right now (walls and breaks included). */
export function affinityOf(target, el) {
    if (!target || el === 'almighty' || !ELEMENTS.includes(el)) return '';
    let a = target.affinities?.[el] || '';
    if ((target.breaks?.[el] || 0) > 0 && ['rs', 'nu', 'dr', 'rp'].includes(a)) a = '';
    if ((target.walls?.[el] || 0) > 0 && (a === '' || a === 'wk')) a = 'rs';
    return a;
}

const AFF_WORD = { wk: 'WEAK', rs: 'Resist', nu: 'Block', dr: 'Drain', rp: 'Repel' };

export const hasBond = (c, id) => !!c?.bond?.abilities?.includes(id);

function takeDamage(state, events, c, amount, text, extra = {}) {
    // Protect: a teammate takes the fatal blow meant for the leader (once a fight).
    if (c.isUser && c.side === 'party' && !extra.dot && !extra.protected && amount >= c.hp && c.hp > 0) {
        const guard = alive(state, 'party').find(a => a.id !== c.id && hasBond(a, 'protect') && !a.bondUsed.protect);
        if (guard) {
            guard.bondUsed.protect = true;
            push(state, events, { type: 'bond', ability: 'protect', actor: guard.id, target: c.id, text: `${guard.name} shoves ${c.name} aside and takes the blow! 🫂` });
            takeDamage(state, events, guard, amount, `${guard.name} takes ${amount} damage`, { ...extra, protected: true });
            return;
        }
    }
    // Endure: a teammate holds on at 1 HP (once a fight).
    if (c.side === 'party' && !extra.dot && hasBond(c, 'endure') && !c.bondUsed.endure && amount >= c.hp && c.hp > 1) {
        c.bondUsed.endure = true;
        const taken = c.hp - 1;
        c.hp = 1;
        push(state, events, { type: 'damage', target: c.id, amount: taken, text, ...extra });
        push(state, events, { type: 'bond', ability: 'endure', actor: c.id, text: `${c.name} endures it — still standing with 1 HP! 🛡️` });
        return;
    }
    c.hp = Math.max(0, c.hp - amount);
    push(state, events, { type: 'damage', target: c.id, amount, text, ...extra });
    if (!extra.dot && hasStatus(c, 'sleep')) c.statuses = c.statuses.filter(s => s.id !== 'sleep');
    if (c.hp <= 0 && !c.down) {
        c.down = true;
        c.statuses = [];
        c.guard = false;
        c.knocked = false;
        push(state, events, { type: 'down', target: c.id, text: c.side === 'enemy' ? `${c.name} is defeated! 💀` : `${c.name} falls! 💀` });
    }
}

// ─── Numbers ────────────────────────────────────────────────────────────────

/** (a − b) / (a + b): −1…1, the same at any point of the 1–99 scale. */
function ratioDiff(a, b) {
    const sum = Math.max(1, a) + Math.max(1, b);
    return (Math.max(1, a) - Math.max(1, b)) / sum;
}

/** Gear (weapon attack, armour) scaled by the owner's level. */
function gearValue(c, n) {
    return (n || 0) * (1 + Math.max(0, (c.level || 1) - 1) * TUNING.gearPerLevel);
}

/** Critical hit chance: higher Luck than the target's raises it. */
export function critChance(attacker, defender) {
    const edge = Math.max(0, ratioDiff(attrValue(attacker, 'lu'), attrValue(defender, 'lu')));
    return Math.min(TUNING.critMax, TUNING.critChance + edge * TUNING.critPerLu);
}

export function hitChance(attacker, defender, profile = null) {
    let p = TUNING.hitBase + ratioDiff(attrValue(attacker, 'ag'), attrValue(defender, 'ag')) * TUNING.hitSpread;
    if (profile && profile.stat && !PHYSICAL.has(profile.stat) && profile.stat !== 'none') p += TUNING.spellAccuracy;
    if (profile && isNum(profile.acc)) p *= profile.acc / 95;
    if (hasStatus(attacker, 'swift')) p += TUNING.swiftHit;
    if (hasStatus(attacker, 'sluggish')) p -= TUNING.swiftHit;
    if (hasStatus(attacker, 'dizzy')) p *= TUNING.dizzyHitMult;
    if (hasStatus(defender, 'swift')) p -= TUNING.swiftHit;
    if (hasStatus(defender, 'sluggish')) p += TUNING.swiftHit;
    // A fighter who is down, asleep or frozen cannot dodge.
    if (defender && (defender.knocked || hasStatus(defender, 'sleep') || hasStatus(defender, 'freeze') || hasStatus(defender, 'shock'))) return TUNING.hitMax;
    return clamp(p, TUNING.hitMin, TUNING.hitMax);
}

/** How strong a skill of power `pw` is compared with a plain attack (√ of the power, as in the games). */
export function skillPowerMult(pw) {
    return clamp(Math.sqrt(Math.max(1, pw) / TUNING.skillPowerRef), TUNING.skillPowerMin, TUNING.skillPowerMax);
}

/** Damage before the defender's armour; `roll` is the variation factor. */
function rawDamage(attacker, action, roll, aoe) {
    const p = action.profile;
    const power = powerOf(p);
    let base;
    if (p.stat === 'none') {
        base = TUNING.itemBomb[power] + attacker.level * TUNING.bombPerLevel;
    } else {
        base = TUNING.dmgBase + attrValue(attacker, p.stat) * TUNING.dmgPerAttr + (attacker.level || 1) * TUNING.dmgPerLevel;
        if (PHYSICAL.has(p.stat)) base += gearValue(attacker, attacker.atkBonus);
        base *= isNum(p.pw) ? skillPowerMult(p.pw) : TUNING.powerMult[power];
    }
    base *= atkMult(attacker) * roll;
    if (aoe) base *= TUNING.aoeMult;
    return base;
}

function defenceOf(defender, profile) {
    const physical = !profile || profile.stat === 'none' || PHYSICAL.has(profile.stat);
    return attrValue(defender, 'en') * TUNING.defPerEn + gearValue(defender, defender.armor) * (physical ? 1 : TUNING.magicArmorShare);
}

/** What armour is weighed against: the attacker's attribute (a fixed 10 for items). */
function pierceOf(attacker, profile) {
    const stat = profile && profile.stat && profile.stat !== 'none' ? profile.stat : null;
    return TUNING.defK + (stat ? attrValue(attacker, stat) : 10) * TUNING.defPerAtk;
}

/** How much of the damage a defender shrugs off, as 0–1: { physical, magic }. For the inspect panel. */
export function damageReduction(defender) {
    // Against an attacker as strong as the defender.
    const f = (profile) => { const d = defenceOf(defender, profile); return d / (d + TUNING.defK + attrValue(defender, profile?.stat === 'ma' ? 'ma' : 'st') * TUNING.defPerAtk); };
    return { physical: f(null), magic: f({ stat: 'ma' }) };
}

export function damageAgainst(attacker, action, defender, { roll = 1, crit = false, aoe = false, mult = 1 } = {}) {
    let d = rawDamage(attacker, action, roll, aoe) * (crit ? TUNING.critMult : 1) * mult;
    const def = defenceOf(defender, action.profile);
    d = d * (1 - def / (def + pierceOf(attacker, action.profile))) * inMult(defender);
    return Math.max(1, Math.round(d));
}

export function healAmount(actor, action, target) {
    const p = action.profile;
    const power = powerOf(p);
    const baton = actor.baton ? 1 + TUNING.batonStep * actor.baton : 1;
    if (p.type === 'skill') {
        const fx = p.fx?.k === 'combo' ? (p.fx.of.find(x => x.k === 'heal') || {}) : (p.fx || {});
        if (isNum(fx.pct)) return Math.max(1, Math.round(target.maxHp * fx.pct / 100));
        const pw = isNum(fx.pw) ? fx.pw : 50;
        return Math.max(1, Math.round((TUNING.healBase + attrValue(actor, 'ma') * TUNING.healPerAttr + (actor.level || 1) * TUNING.healPerLevel) * (pw / 50) * TUNING.healMult * baton));
    }
    if (action.kind === 'item' || p.stat === 'none') return Math.max(1, Math.round(target.maxHp * TUNING.itemHealPct[power]));
    return Math.max(1, Math.round((TUNING.healBase + attrValue(actor, p.stat) * TUNING.healPerAttr + (actor.level || 1) * TUNING.healPerLevel) * TUNING.powerMult[power] * TUNING.healMult));
}

/** What the action would do, for a tooltip: { min, max, hit } or { amount }. */
export function estimateAction(actor, action, target = null) {
    const p = action.profile;
    if (!p) return null;
    if ((p.type === 'damage' || (p.type === 'skill' && p.fx?.k === 'dmg')) && target) {
        const aoe = p.target === 'enemies';
        const aff = affinityOf(target, elementOf(p));
        const known = target.side !== 'enemy' || target.known?.[elementOf(p)];
        const m = !known ? 1 : aff === 'wk' ? TUNING.weakMult : aff === 'rs' ? TUNING.resistMult : (aff === 'nu' || aff === 'rp' || aff === 'dr') ? 0 : 1;
        const hits = Array.isArray(p.hits) ? p.hits : [1, 1];
        return {
            affinity: known ? aff : '?',
            min: Math.round(damageAgainst(actor, action, target, { roll: TUNING.varMin, aoe }) * m) * hits[0],
            max: Math.round(damageAgainst(actor, action, target, { roll: TUNING.varMax, aoe }) * m) * hits[1],
            hit: Math.round(hitChance(actor, target, p) * 100),
        };
    }
    if ((p.type === 'heal' || (p.type === 'skill' && (p.fx?.k === 'heal' || p.fx?.k === 'combo'))) && target) return { amount: healAmount(actor, action, target) };
    return null;
}

// ─── Using actions ──────────────────────────────────────────────────────────

/** { ok, reason } — can this combatant use this action now? */
export function canUse(actor, action) {
    if (!actor || !action) return { ok: false, reason: 'No such action' };
    if (actor.down) return { ok: false, reason: 'Down' };
    if (action.kind === 'item' && !(action.qty > 0)) return { ok: false, reason: 'None left' };
    if (action.manaCost > 0 && actor.mana !== null && actor.mana < action.manaCost) return { ok: false, reason: 'Not enough SP' };
    if (action.hpCost > 0 && actor.hp <= Math.ceil(actor.maxHp * action.hpCost / 100)) return { ok: false, reason: 'Not enough HP' };
    if (action.id !== 'basic' && action.kind !== 'item') {
        const sealed = (actor.statuses || []).find(s => STATUSES[s.id]?.sealed);
        if (sealed) return { ok: false, reason: `${STATUSES[sealed.id].name}: only a plain attack` };
    }
    const cd = actor.cooldowns[action.id] || 0;
    if (cd > 0) return { ok: false, reason: `Ready in ${cd} turn${cd === 1 ? '' : 's'}` };
    return { ok: true, reason: '' };
}

/** Who an action can be aimed at, as combatant ids (empty: no choice needed). */
export function validTargets(state, actor, action) {
    const t = action.profile.target;
    const own = actor.side;
    if (t === 'enemy') return state.combatants.filter(c => c.side === opposite(own) && !c.down).map(c => c.id);
    if (t === 'ally') {
        const revive = action.profile.type === 'revive' || !!action.profile.revive;
        return state.combatants.filter(c => c.side === own && (revive ? c.down : !c.down)).map(c => c.id);
    }
    return [];
}

function resolveTargets(state, actor, action, chosen) {
    const t = action.profile.target;
    if (t === 'self') return [actor];
    if (t === 'enemies') return alive(state, opposite(actor.side));
    if (t === 'allies') return alive(state, actor.side);
    const ids = validTargets(state, actor, action);
    const pick = ids.includes(chosen) ? chosen : ids[0];
    const target = pick ? getCombatant(state, pick) : null;
    return target ? [target] : [];
}

function spend(actor, action) {
    if (action.manaCost > 0 && actor.mana !== null) actor.mana = Math.max(0, Math.round((actor.mana - action.manaCost) * 100) / 100);
    if (action.hpCost > 0) actor.hp = Math.max(1, actor.hp - Math.ceil(actor.maxHp * action.hpCost / 100));
    if (action.cooldown > 0) actor.cooldowns[action.id] = action.cooldown;
    if (action.kind === 'item') action.qty = Math.max(0, (action.qty || 0) - 1);
    actor.guard = false;
}

// ─── Hitting: affinities, knock-downs, ailments ─────────────────────────────

function luckFactor(actor, target) {
    return clamp(1 + ratioDiff(attrValue(actor, 'lu'), attrValue(target, 'lu')), 0.5, 1.5);
}

/** Tries an ailment (the game's name or a status id) on a target. */
function tryAilment(state, events, actor, target, name, pct) {
    const id = AILMENT_STATUS[String(name).toLowerCase()] || (STATUS_IDS.includes(name) ? name : null);
    if (!id || target.down) return false;
    let chance = (pct / 100) * luckFactor(actor, target);
    if (target.tier === 'boss') chance *= TUNING.bossAilmentMult;
    if (nextRandom(state) >= chance) return false;
    return applyStatus(state, events, actor, target, id, STATUSES[id]?.skip && id !== 'sleep' ? 1 : TUNING.ailmentTurns);
}

/** A technical: the element exploits an ailment the target has. */
function isTechnical(target, el) {
    return (target.statuses || []).some(s => (TECHNICAL[s.id] || []).includes(el));
}

/** Damage that comes back to the attacker (Repel, a mirror). */
function reflect(state, events, actor, amount, why) {
    const el = 'almighty';
    if (actor.down) return;
    push(state, events, { type: 'reflect', actor: actor.id, text: why });
    takeDamage(state, events, actor, amount, `${actor.name} takes ${amount} damage.`, { el });
}

/**
 * One hit of a damaging action on one target. Handles mirrors, hit chance,
 * affinities, crits, technicals, knock-downs and the action's ailment.
 * ctx collects what happened: { more, chargeUsed, focusUsed }.
 */
function strike(state, events, actor, target, action, ctx, { aoe = false, ailment = null } = {}) {
    const p = action.profile;
    const el = elementOf(p);
    const physical = PHYS_ELEMENTS.has(el);
    // Tetrakarn / Makarakarn send the first matching attack back.
    const mirror = physical ? 'tetrakarn' : (el !== 'almighty' ? 'makarakarn' : null);
    if (mirror && hasStatus(target, mirror)) {
        target.statuses = target.statuses.filter(s => s.id !== mirror);
        const back = damageAgainst(actor, action, actor, { aoe });
        reflect(state, events, actor, back, `${target.name}'s ${STATUSES[mirror].name.toLowerCase()} repels ${action.label}! ${STATUSES[mirror].icon}`);
        return;
    }
    if (nextRandom(state) >= hitChance(actor, target, p)) {
        push(state, events, { type: 'miss', actor: actor.id, target: target.id, text: `${target.name} avoids it.` });
        return;
    }
    const aff = affinityOf(target, el);
    if (target.side === 'enemy' && el !== 'almighty') target.known[el] = true;
    if (aff === 'nu') {
        push(state, events, { type: 'block', actor: actor.id, target: target.id, el, text: `${target.name} blocks it — Null! 🚫` });
        return;
    }
    const technical = isTechnical(target, el);
    let crit = false;
    if (physical && (aff === '' || aff === 'wk')) {
        const bonus = isNum(p.crit) ? p.crit / 100 : 0;
        crit = technical || hasStatus(target, 'sleep') || nextRandom(state) < Math.min(TUNING.skillCritCap, critChance(actor, target) + bonus);
    }
    let mult = 1;
    if (aff === 'wk' && !target.guard) mult *= TUNING.weakMult;
    if (aff === 'rs') mult *= TUNING.resistMult;
    if (physical && hasStatus(actor, 'charged')) { mult *= TUNING.chargeMult; ctx.chargeUsed = true; }
    if (!physical && hasStatus(actor, 'focused')) { mult *= TUNING.chargeMult; ctx.focusUsed = true; }
    const roll = TUNING.varMin + nextRandom(state) * (TUNING.varMax - TUNING.varMin);
    const dmg = damageAgainst(actor, action, target, { roll, crit, aoe, mult });
    if (aff === 'rp') {
        reflect(state, events, actor, dmg, `${target.name} repels ${action.label}! ↩️`);
        return;
    }
    if (aff === 'dr') {
        const heal = Math.min(dmg, target.maxHp - target.hp);
        target.hp += heal;
        push(state, events, { type: 'heal', actor: actor.id, target: target.id, amount: heal, el, text: `${target.name} absorbs it — Drain! (+${heal} HP)` });
        return;
    }
    const tag = aff === 'wk' && !target.guard ? ' — WEAK!' : aff === 'rs' ? ' — resisted' : technical ? ' — TECHNICAL!' : crit ? ' (critical!)' : '';
    takeDamage(state, events, target, dmg, `${target.name} takes ${dmg} ${el === 'almighty' || el === 'phys' ? '' : el + ' '}damage${tag}`, { actor: actor.id, crit, el, weak: aff === 'wk' });
    if (target.down) return;
    // Weaknesses and technicals knock anyone down; a critical only does when the
    // party lands it (enemy crits just hurt — otherwise plain fights swing too hard).
    const knocks = !target.guard && (aff === 'wk' || technical || (crit && actor.side === 'party'));
    if (knocks && !target.knocked) {
        target.knocked = true;
        ctx.more = true;
        push(state, events, { type: 'knock', actor: actor.id, target: target.id, text: `${target.name} is knocked down! ⬇️` });
    }
    if (ailment) tryAilment(state, events, actor, target, ailment.name, ailment.pct);
}

function revive(state, events, actor, t, pct) {
    if (!t.down) { push(state, events, { type: 'info', text: `${t.name} is already up.` }); return; }
    t.down = false;
    t.knocked = false;
    t.hp = Math.max(1, Math.round(t.maxHp * pct / 100));
    if (!state.order.includes(t.id)) state.order.push(t.id);
    push(state, events, { type: 'heal', actor: actor.id, target: t.id, amount: t.hp, text: `${t.name} is back on their feet! ✨` });
}

const KAJA = { atk: 'empower', def: 'shield', agi: 'swift' };
const KUNDA = { atk: 'weaken', def: 'vulnerable', agi: 'sluggish' };

/** One effect of a database skill on its targets. */
function applySkillFx(state, events, actor, action, fx, targets, ctx) {
    const p = action.profile;
    const aoe = p.target === 'enemies';
    switch (fx.k) {
    case 'dmg': {
        const [lo, hi] = Array.isArray(fx.hits) ? fx.hits : [1, 1];
        for (const t of targets) {
            const hits = lo + Math.floor(nextRandom(state) * (hi - lo + 1));
            for (let i = 0; i < hits && !t.down && !actor.down; i++) {
                strike(state, events, actor, t, action, ctx, { aoe, ailment: i === 0 && p.ail ? p.ail : null });
            }
        }
        break;
    }
    case 'kill': {
        for (const t of targets) {
            const aff = affinityOf(t, fx.el);
            if (t.side === 'enemy') t.known[fx.el] = true;
            if (t.tier === 'boss' || ['rs', 'nu', 'dr', 'rp'].includes(aff)) {
                push(state, events, { type: 'block', actor: actor.id, target: t.id, text: `${t.name} is unaffected.` });
                continue;
            }
            const chance = (fx.pct / 100) * (aff === 'wk' ? 1.5 : 1) * luckFactor(actor, t);
            if (nextRandom(state) < chance) takeDamage(state, events, t, t.hp, `${t.name} is wiped out! ☠️`, { actor: actor.id });
            else push(state, events, { type: 'miss', actor: actor.id, target: t.id, text: `${t.name} withstands it.` });
        }
        break;
    }
    case 'halve': {
        for (const t of targets) {
            const aff = affinityOf(t, fx.el || 'almighty');
            if (t.tier === 'boss' || aff === 'nu' || aff === 'rp' || aff === 'dr' || nextRandom(state) >= (fx.pct || 100) / 100) {
                push(state, events, { type: 'miss', actor: actor.id, target: t.id, text: `${t.name} is unaffected.` });
                continue;
            }
            const cut = Math.floor(t.hp / 2);
            if (cut > 0) takeDamage(state, events, t, cut, `${t.name} loses half their HP (${cut}).`, { actor: actor.id });
        }
        break;
    }
    case 'drain': {
        const t = targets[0];
        if (!t) break;
        const amount = Math.max(1, Math.round(fx.pw * (1 + (actor.level || 1) * TUNING.drainPerLevel)));
        takeDamage(state, events, t, amount, `${t.name} is drained of ${amount} HP.`, { actor: actor.id });
        if (fx.what === 'sp' && actor.mana !== null) {
            actor.mana = Math.min(100, actor.mana + TUNING.drainSp);
            push(state, events, { type: 'mana', actor: actor.id, target: actor.id, amount: TUNING.drainSp, text: `${actor.name} regains ${TUNING.drainSp} SP 💧` });
        } else if (fx.what !== 'sp') {
            const heal = Math.min(amount, actor.maxHp - actor.hp);
            actor.hp += heal;
            if (heal) push(state, events, { type: 'heal', actor: actor.id, target: actor.id, amount: heal, text: `${actor.name} recovers ${heal} HP 💚` });
        }
        break;
    }
    case 'heal': {
        for (const t of targets) {
            if (fx.revive) { revive(state, events, actor, t, fx.revive); continue; }
            if (t.down) continue;
            if (fx.cure) {
                const before = t.statuses.length;
                const ids = fx.cure.includes('all') ? null : new Set(fx.cure.map(n => AILMENT_STATUS[String(n).toLowerCase()]).filter(Boolean));
                t.statuses = t.statuses.filter(s => !(STATUSES[s.id]?.bad && (!ids || ids.has(s.id))));
                push(state, events, { type: 'cure', actor: actor.id, target: t.id, text: before !== t.statuses.length ? `${t.name} is cured ✨` : `${t.name} had nothing to cure.` });
                continue;
            }
            if (fx.sp) {
                if (t.mana === null) continue;
                const amount = Math.min(fx.sp, 100 - t.mana);
                t.mana += amount;
                push(state, events, { type: 'mana', actor: actor.id, target: t.id, amount, text: `${t.name} regains ${amount} SP 💧` });
                continue;
            }
            const amount = Math.min(healAmount(actor, { ...action, profile: { ...p, fx } }, t), t.maxHp - t.hp);
            t.hp += amount;
            push(state, events, { type: 'heal', actor: actor.id, target: t.id, amount, text: `${t.name} recovers ${amount} HP 💚` });
        }
        break;
    }
    case 'kaja':
        for (const t of targets) for (const st of fx.stats || []) if (KAJA[st]) applyStatus(state, events, actor, t, KAJA[st], TUNING.buffTurns);
        break;
    case 'kunda':
        for (const t of targets) for (const st of fx.stats || []) if (KUNDA[st]) applyStatus(state, events, actor, t, KUNDA[st], TUNING.buffTurns);
        break;
    case 'dekaja':
        for (const t of targets) {
            t.statuses = t.statuses.filter(s => !['empower', 'shield', 'swift', 'charged', 'focused'].includes(s.id));
            push(state, events, { type: 'cure', actor: actor.id, target: t.id, text: `${t.name}'s boosts are wiped away.` });
        }
        break;
    case 'dekunda':
        for (const t of targets) {
            t.statuses = t.statuses.filter(s => !['weaken', 'vulnerable', 'sluggish'].includes(s.id));
            push(state, events, { type: 'cure', actor: actor.id, target: t.id, text: `${t.name}'s penalties are lifted.` });
        }
        break;
    case 'charge':
        applyStatus(state, events, actor, actor, fx.what === 'phys' ? 'charged' : 'focused', 99);
        break;
    case 'karn':
        for (const t of targets) applyStatus(state, events, actor, t, fx.what === 'phys' ? 'tetrakarn' : 'makarakarn', TUNING.buffTurns);
        break;
    case 'wall':
        for (const t of targets) {
            t.walls[fx.el] = TUNING.buffTurns;
            push(state, events, { type: 'status', actor: actor.id, target: t.id, text: `${t.name} is shielded from ${fx.el} 🧱` });
        }
        break;
    case 'break':
        for (const t of targets) {
            t.breaks[fx.el] = TUNING.buffTurns;
            push(state, events, { type: 'status', actor: actor.id, target: t.id, text: `${t.name}'s ${fx.el} resistance is broken 💔` });
        }
        break;
    case 'ail':
        for (const t of targets) {
            if (!tryAilment(state, events, actor, t, fx.ail, fx.pct)) push(state, events, { type: 'miss', actor: actor.id, target: t.id, text: `${t.name} resists.` });
        }
        break;
    case 'combo':
        for (const part of fx.of || []) applySkillFx(state, events, actor, action, part, targets, ctx);
        break;
    default:
        push(state, events, { type: 'info', text: 'Nothing happens.' });
    }
}

/**
 * Uses an action. Returns the events (and moves nothing along: call
 * advance() afterwards to end the turn — or, after a knock-down, to open the
 * 1 More). `targetId` is the chosen target for single-target actions.
 */
export function performAction(state, actorId, actionId, targetId = null) {
    const events = [];
    if (state.phase !== 'active') return events;
    const actor = getCombatant(state, actorId);
    const action = actor?.actions.find(a => a.id === actionId);
    const check = canUse(actor, action);
    if (!check.ok) {
        push(state, events, { type: 'info', text: `${actor?.name || 'Someone'} cannot do that: ${check.reason}.` });
        return events;
    }
    const targets = resolveTargets(state, actor, action, targetId);
    if (!targets.length) {
        push(state, events, { type: 'info', text: 'There is no valid target.' });
        return events;
    }
    spend(actor, action);
    const p = action.profile;
    const verb = `${actor.name} uses ${action.label}`;
    const aoe = p.target === 'enemies';
    const single = p.target === 'enemy' || p.target === 'ally';
    const ctx = { more: false };

    if (p.type === 'skill') {
        push(state, events, { type: 'use', actor: actor.id, el: p.element, text: `${verb}${single ? ` on ${targets[0].name}` : ''}.` });
        applySkillFx(state, events, actor, action, p.fx, targets, ctx);
    } else if (p.type === 'damage') {
        push(state, events, { type: 'use', actor: actor.id, el: elementOf(p), text: `${verb}${aoe ? '' : ` on ${targets[0].name}`}.` });
        for (const t of targets) {
            strike(state, events, actor, t, action, ctx, { aoe, ailment: p.status ? { name: p.status, pct: TUNING.statusChance * 100 } : null });
        }
    } else if (p.type === 'heal') {
        push(state, events, { type: 'use', actor: actor.id, text: `${verb}${p.target === 'allies' ? '' : ` on ${targets[0].name}`}.` });
        for (const t of targets) {
            const amount = Math.min(healAmount(actor, action, t), t.maxHp - t.hp);
            t.hp += amount;
            push(state, events, { type: 'heal', actor: actor.id, target: t.id, amount, text: `${t.name} recovers ${amount} HP 💚` });
        }
    } else if (p.type === 'status') {
        push(state, events, { type: 'use', actor: actor.id, text: `${verb}${p.target === 'self' || p.target === 'allies' || p.target === 'enemies' ? '' : ` on ${targets[0].name}`}.` });
        const bad = STATUSES[p.status]?.bad;
        for (const t of targets) {
            if (bad && t.side !== actor.side && nextRandom(state) >= hitChance(actor, t, p)) {
                push(state, events, { type: 'miss', actor: actor.id, target: t.id, text: `${t.name} resists.` });
                continue;
            }
            applyStatus(state, events, actor, t, p.status);
        }
    } else if (p.type === 'mana') {
        push(state, events, { type: 'use', actor: actor.id, text: `${verb} on ${targets[0].name}.` });
        for (const t of targets) {
            if (t.mana === null) { push(state, events, { type: 'info', text: `${t.name} has no SP.` }); continue; }
            const amount = Math.min(TUNING.itemMana[powerOf(p)], 100 - t.mana);
            t.mana += amount;
            push(state, events, { type: 'mana', actor: actor.id, target: t.id, amount, text: `${t.name} regains ${amount} SP 💧` });
        }
    } else if (p.type === 'cure') {
        push(state, events, { type: 'use', actor: actor.id, text: `${verb} on ${targets[0].name}.` });
        for (const t of targets) {
            const before = t.statuses.length;
            t.statuses = t.statuses.filter(s => !STATUSES[s.id]?.bad);
            push(state, events, { type: 'cure', actor: actor.id, target: t.id, text: before !== t.statuses.length ? `${t.name} is cleansed ✨` : `${t.name} had nothing to cure.` });
        }
    } else if (p.type === 'revive') {
        push(state, events, { type: 'use', actor: actor.id, text: `${verb} on ${targets[0].name}.` });
        for (const t of targets) revive(state, events, actor, t, TUNING.revivePct[powerOf(p)] * 100);
    }
    followUp(state, events, actor, p, targets, ctx);
    // A Charge / Concentrate is spent by the attack that used it.
    if (ctx.chargeUsed) actor.statuses = actor.statuses.filter(s => s.id !== 'charged');
    if (ctx.focusUsed) actor.statuses = actor.statuses.filter(s => s.id !== 'focused');
    if (!checkEnd(state, events) && ctx.more && !actor.down) state.pendingMore = actor.id;
    return events;
}

/** Follow Up: after the leader's single-target attack that did not knock the foe down. */
function followUp(state, events, actor, p, targets, ctx) {
    if (!actor.isUser || actor.side !== 'party' || ctx.more || state.phase !== 'active') return;
    const attack = p.type === 'damage' || (p.type === 'skill' && p.fx?.k === 'dmg');
    if (!attack || targets.length !== 1) return;
    const foe = targets[0];
    if (foe.side !== 'enemy' || foe.down || foe.knocked) return;
    const mates = alive(state, 'party')
        .filter(a => a.id !== actor.id && hasBond(a, 'followup') && !a.knocked && !a.statuses.some(s => STATUSES[s.id]?.skip || STATUSES[s.id]?.bad))
        .sort((a, b) => (b.bond.rank || 0) - (a.bond.rank || 0));
    const mate = mates[0];
    if (!mate || nextRandom(state) >= followUpChance(mate.bond.rank, mate.bond.ranks?.followup)) return;
    push(state, events, { type: 'bond', ability: 'followup', actor: mate.id, target: foe.id, text: `Follow Up! ${mate.name} jumps in ⚔️` });
    const sub = { more: false };
    strike(state, events, mate, foe, basicAttack(mate), sub);
    if (sub.more) ctx.more = true;
}

// ─── 1 More: Baton Pass and All-Out Attack ──────────────────────────────────

/** Allies the current 1 More can be passed to. */
export function batonTargets(state) {
    if (!inOneMore(state)) return [];
    const actor = currentActor(state);
    if (!actor || actor.side !== 'party') return [];
    // With Confidants on (state.batonBond), only the leader and teammates whose bond has Baton Pass take part.
    const can = (c) => !state.batonBond || c.isUser || hasBond(c, 'baton');
    if (!can(actor)) return [];
    const passed = state.extra.passed || [];
    return alive(state, 'party').filter(c => c.id !== actor.id && !c.knocked && !passed.includes(c.id) && can(c)).map(c => c.id);
}

/** Hands the 1 More to an ally: they act now, stronger (+50% per pass). */
export function batonPass(state, toId) {
    const events = [];
    if (!batonTargets(state).includes(toId)) return events;
    const from = currentActor(state);
    const to = getCombatant(state, toId);
    state.extra.passed = [...(state.extra.passed || []), from.id];
    to.baton = Math.min(TUNING.batonMax, (from.baton || 0) + 1);
    from.baton = 0;
    state.extra.actor = to.id;
    push(state, events, { type: 'baton', actor: from.id, target: to.id, text: `Baton Pass! ${from.name} → ${to.name} (+${Math.round(TUNING.batonStep * to.baton * 100)}%) 🤝` });
    return events;
}

/** Whether the current actor can launch an All-Out Attack (a party 1 More, every enemy down). */
export function canAllOut(state) {
    if (!inOneMore(state)) return false;
    const actor = currentActor(state);
    const foes = alive(state, 'enemy');
    return !!actor && actor.side === 'party' && foes.length > 0 && foes.every(e => e.knocked);
}

/** Everyone standing piles on every enemy that is down. Ends the 1 More. */
export function allOutAttack(state) {
    const events = [];
    if (!canAllOut(state)) return events;
    const party = alive(state, 'party');
    push(state, events, { type: 'allout', text: `ALL-OUT ATTACK! ${party.map(c => c.name).join(', ')} rush in! 💥` });
    for (const e of alive(state, 'enemy')) {
        let total = 0;
        for (const c of party) {
            const roll = TUNING.varMin + nextRandom(state) * (TUNING.varMax - TUNING.varMin);
            total += damageAgainst(c, basicAttack(c), e, { roll, mult: TUNING.allOutMult });
        }
        takeDamage(state, events, e, total, `${e.name} takes ${total} damage.`, { allOut: true });
        e.knocked = false;
    }
    state.pendingMore = null;
    for (const c of state.combatants) c.baton = 0;
    state.extra = { ...state.extra, done: true };
    checkEnd(state, events);
    return events;
}

/** Guard for the round: incoming damage is halved until the next turn. */
export function defend(state, actorId) {
    const events = [];
    const actor = getCombatant(state, actorId);
    if (state.phase !== 'active' || !actor || actor.down) return events;
    actor.guard = true;
    push(state, events, { type: 'defend', actor: actor.id, text: `${actor.name} braces for impact 🛡️` });
    return events;
}

export function fleeChance(state) {
    const avg = (side) => { const l = alive(state, side); return l.length ? l.reduce((s, c) => s + attrValue(c, 'ag'), 0) / l.length : 10; };
    let p = TUNING.fleeBase + ratioDiff(avg('party'), avg('enemy')) * TUNING.fleeSpread;
    if (state.combatants.some(c => c.side === 'enemy' && !c.down && c.tier === 'boss')) p -= TUNING.fleeBossPenalty;
    return clamp(p, TUNING.fleeMin, TUNING.fleeMax);
}

/** Tries to run. Success ends the fight as 'fled'. */
export function attemptFlee(state, actorId) {
    const events = [];
    const actor = getCombatant(state, actorId);
    if (state.phase !== 'active' || !actor || actor.down) return events;
    actor.guard = false;
    if (nextRandom(state) < fleeChance(state)) {
        push(state, events, { type: 'flee', actor: actor.id, text: `${actor.name} leads the retreat — the party escapes! 🏃` });
        state.phase = 'ended';
        state.result = 'fled';
    } else {
        push(state, events, { type: 'flee', actor: actor.id, text: `${actor.name} tries to run, but is cut off!` });
    }
    return events;
}

// ─── Turns ──────────────────────────────────────────────────────────────────

/** Why the fight is over, or null. */
export function checkEnd(state, events = []) {
    if (state.phase !== 'active') return state.result;
    if (!alive(state, 'enemy').length) {
        state.phase = 'ended'; state.result = 'victory';
        push(state, events, { type: 'end', text: 'Victory! 🎉' });
    } else if (!alive(state, 'party').length) {
        state.phase = 'ended'; state.result = 'defeat';
        push(state, events, { type: 'end', text: 'The party has fallen…' });
    }
    return state.result;
}

/** Start of a turn: damage/healing over time, cooldowns, a stunned turn is skipped. */
function beginTurn(state, events) {
    for (let guard = 0; guard < state.order.length * 2 + 2 && state.phase === 'active'; guard++) {
        const actor = currentActor(state);
        if (!actor || actor.down) { stepIndex(state, events); continue; }
        actor.guard = false;
        for (const id of Object.keys(actor.cooldowns)) {
            if (actor.cooldowns[id] > 0) actor.cooldowns[id]--;
            if (actor.cooldowns[id] <= 0) delete actor.cooldowns[id];
        }
        if (actor.stunImmune > 0) actor.stunImmune--;
        for (const s of [...actor.statuses]) {
            const def = STATUSES[s.id];
            if (def?.dot) {
                const dmg = Math.max(2, Math.round(actor.maxHp * TUNING.dotPct[s.id]));
                takeDamage(state, events, actor, dmg, `${actor.name} suffers ${dmg} damage from ${def.name.toLowerCase()} ${def.icon}`, { dot: true });
            } else if (s.id === 'regen') {
                const heal = Math.min(Math.max(2, Math.round(actor.maxHp * TUNING.regenPct)), actor.maxHp - actor.hp);
                if (heal > 0) { actor.hp += heal; push(state, events, { type: 'heal', target: actor.id, amount: heal, text: `${actor.name} regenerates ${heal} HP 💚` }); }
            }
        }
        if (checkEnd(state, events)) return;
        if (actor.down) { stepIndex(state, events); continue; }
        // Knocked down: they get back up at the start of their turn (as in P4/P5).
        if (actor.knocked) {
            actor.knocked = false;
            push(state, events, { type: 'info', actor: actor.id, text: `${actor.name} gets back up.` });
        }
        // Harisen Recovery: a teammate may snap the leader out of an ailment.
        if (actor.isUser && actor.side === 'party' && actor.statuses.some(s => STATUSES[s.id]?.bad)) {
            const mate = alive(state, 'party').filter(a => a.id !== actor.id && hasBond(a, 'harisen')).sort((a, b) => b.bond.rank - a.bond.rank)[0];
            if (mate && nextRandom(state) < harisenChance(mate.bond.rank, mate.bond.ranks?.harisen)) {
                actor.statuses = actor.statuses.filter(s => !STATUSES[s.id]?.bad);
                push(state, events, { type: 'bond', ability: 'harisen', actor: mate.id, target: actor.id, text: `${mate.name} snaps ${actor.name} out of it! 💫` });
            }
        }
        const skip = actor.statuses.find(s => STATUSES[s.id]?.skip || s.id === 'stun');
        const maybe = !skip && actor.statuses.find(s => STATUSES[s.id]?.maybeSkip);
        if (skip || (maybe && nextRandom(state) < TUNING.maybeSkipChance)) {
            const st = skip || maybe;
            const def = STATUSES[st.id];
            push(state, events, { type: 'skip', actor: actor.id, text: `${actor.name} is ${def.name.toLowerCase()} and loses the turn ${def.icon}` });
            // One-turn locks wear off at once and protect for a while.
            if (st.id === 'stun' || st.id === 'freeze' || st.id === 'shock') {
                actor.statuses = actor.statuses.filter(s => s.id !== st.id);
                actor.stunImmune = 2;
            }
            tickStatuses(actor);
            stepIndex(state, events);
            continue;
        }
        return;
    }
}

function tickStatuses(actor) {
    for (const s of actor.statuses) s.turns--;
    actor.statuses = actor.statuses.filter(s => s.turns > 0);
    for (const bag of [actor.walls, actor.breaks]) {
        if (!bag) continue;
        for (const el of Object.keys(bag)) if (--bag[el] <= 0) delete bag[el];
    }
}

function stepIndex(state, events) {
    // The order may have gained a revived member; keep it, skip the fallen.
    state.turn++;
    if (state.turn >= state.order.length) {
        state.turn = 0;
        state.round++;
        push(state, events, { type: 'info', text: `Round ${state.round}` });
    }
}

/** Ends the current turn and opens the next one. Returns the events. */
export function advance(state) {
    const events = [];
    if (state.phase !== 'active') { state.extra = null; state.pendingMore = null; return events; }
    if (checkEnd(state, events)) return events;
    // A knock-down earned an extra action: the same fighter goes again.
    if (state.pendingMore) {
        const c = getCombatant(state, state.pendingMore);
        state.pendingMore = null;
        if (c && !c.down) {
            const base = state.extra && !state.extra.done ? state.extra.base : state.order[state.turn];
            const passed = state.extra && !state.extra.done ? state.extra.passed || [] : [];
            state.extra = { actor: c.id, base, passed };
            push(state, events, { type: 'onemore', actor: c.id, text: `1 MORE! ${c.name} acts again ⭐` });
            return events;
        }
    }
    // End of the turn (and of any 1 More chain in it).
    if (state.extra) {
        for (const c of state.combatants) c.baton = 0;
        state.extra = null;
    }
    const actor = currentActor(state);
    if (actor && !actor.down) tickStatuses(actor);
    if (checkEnd(state, events)) return events;
    stepIndex(state, events);
    beginTurn(state, events);
    return events;
}

// ─── Enemy behaviour ────────────────────────────────────────────────────────

/** What an enemy does this turn: { actionId, targetId } or { defend: true }. */
export function chooseEnemyAction(state, enemy) {
    const usable = enemy.actions.filter(a => canUse(enemy, a).ok);
    const foes = alive(state, opposite(enemy.side));
    const allies = alive(state, enemy.side);
    const weights = [];
    for (const a of usable) {
        const p = a.profile;
        let w = a.id === 'basic' ? 1 : 2;
        if (p.type === 'skill') {
            const k = p.fx?.k;
            const hurt = allies.some(c => c.hp / c.maxHp < 0.4);
            if (['dmg', 'kill', 'halve', 'drain'].includes(k)) {
                // Prefer an element someone on the other side is weak to.
                const el = elementOf(p);
                w = foes.some(c => affinityOf(c, el) === 'wk') ? 5 : foes.every(c => ['nu', 'rp', 'dr'].includes(affinityOf(c, el))) ? 0 : 2;
            } else if (k === 'heal' || (k === 'combo' && p.fx.of?.some(x => x.k === 'heal'))) w = hurt ? 4 : 0;
            else if (k === 'kaja' || k === 'charge' || k === 'karn' || k === 'wall') w = 1;
            else if (k === 'kunda' || k === 'break' || k === 'ail') w = 1.5;
            else w = 0.5;
            if (w > 0) weights.push({ a, w });
            continue;
        }
        if (p.type === 'heal') {
            const hurt = allies.some(c => c.hp / c.maxHp < 0.4);
            w = hurt ? 4 : 0;
        } else if (p.type === 'status') {
            const bad = STATUSES[p.status]?.bad;
            const pool = bad ? foes : allies;
            w = pool.every(c => hasStatus(c, p.status)) ? 0 : 2;
        } else if (p.type === 'mana' || p.type === 'cure' || p.type === 'revive' || p.type === 'gear' || p.type === 'none') {
            w = 0;
        }
        if (w > 0) weights.push({ a, w });
    }
    if (!weights.length) weights.push({ a: enemy.actions[0], w: 1 });
    let total = weights.reduce((s, x) => s + x.w, 0);
    let r = nextRandom(state) * total;
    let chosen = weights[0].a;
    for (const x of weights) { r -= x.w; if (r <= 0) { chosen = x.a; break; } }
    let targetId = null;
    const p = chosen.profile;
    if (p.target === 'enemy') {
        // Weak and hurt targets attract attacks; those who block it are avoided.
        const el = p.type === 'damage' || p.type === 'skill' ? elementOf(p) : null;
        const pool = foes.map(c => {
            const aff = el ? affinityOf(c, el) : '';
            const w = aff === 'wk' ? 4 : ['nu', 'rp', 'dr'].includes(aff) ? 0.05 : aff === 'rs' ? 0.5 : 1;
            return { c, w: w + (c.hp / c.maxHp < 0.35 ? 1.5 : 0) };
        });
        total = pool.reduce((s, x) => s + x.w, 0);
        r = nextRandom(state) * total;
        targetId = pool[0]?.c.id ?? null;
        for (const x of pool) { r -= x.w; if (r <= 0) { targetId = x.c.id; break; } }
    } else if (p.target === 'ally') {
        const hurt = [...allies].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        targetId = hurt?.id ?? enemy.id;
    }
    return { actionId: chosen.id, targetId };
}

/** Plays the current enemy's turn (without ending it). */
export function runEnemyTurn(state) {
    const enemy = currentActor(state);
    if (!enemy || enemy.side !== 'enemy') return [];
    const { actionId, targetId } = chooseEnemyAction(state, enemy);
    return performAction(state, enemy.id, actionId, targetId);
}

// ─── Ending ─────────────────────────────────────────────────────────────────

/** hit points → the HP bar (0–100); the fallen keep 1%. */
export function hpToHealthPct(c) {
    if (c.down || c.hp <= 0) return Math.min(1, Math.round(100 / Math.max(1, c.maxHp) * 100) / 100);
    return clamp(Math.round((c.hp / c.maxHp) * 10000) / 100, 0.01, 100);
}

/** SP in points for display ({ cur, max }), or null when SP is not tracked. */
export function spPoints(c) {
    if (c.mana === null || !isNum(c.spMax)) return null;
    return { cur: Math.round(c.mana * c.spMax / 100), max: c.spMax };
}

/** What each party member carries out of the fight. */
export function partyOutcome(state) {
    return state.combatants.filter(c => c.side === 'party').map(c => ({
        id: c.id,
        name: c.name,
        isUser: c.isUser,
        healthPct: hpToHealthPct(c),
        manaPct: c.mana,
        down: c.down,
        statuses: c.statuses.filter(s => STATUSES[s.id]?.bad && s.turns > 0).map(s => ({ id: s.id, name: STATUSES[s.id].name, icon: STATUSES[s.id].icon })),
        // What was used up: { actionId: qty left } for items.
        itemsLeft: Object.fromEntries(c.actions.filter(a => a.kind === 'item').map(a => [a.id, a.qty])),
    }));
}

/**
 * XP, money and loot for the enemies that fell (nothing unless the party won).
 * `tierXp` is the XP table ({ small, medium, large, epic }); `partyLevel` the
 * party's average level.
 */
export function computeRewards(state, { tierXp = { small: 10, medium: 25, large: 50, epic: 100 }, partyLevel = 1 } = {}) {
    const out = { xp: 0, money: 0, items: [], defeated: [] };
    if (state.result !== 'victory') return out;
    for (const e of state.combatants.filter(c => c.side === 'enemy' && c.down)) {
        const tier = TUNING.tiers[e.tier] || TUNING.tiers.normal;
        const factor = clamp(e.level / Math.max(1, partyLevel), 0.5, 2);
        const xp = Math.round((tierXp[tier.xp] ?? 0) * factor);
        out.xp += xp;
        const asked = isNum(e.loot?.money) ? e.loot.money : null;
        const money = asked !== null ? clamp(Math.round(asked * 100) / 100, 0, tier.moneyCap) : Math.round(tier.money * factor);
        out.money += money;
        const items = Array.isArray(e.loot?.items) ? e.loot.items.filter(x => typeof x === 'string' && x.trim()).slice(0, 2) : [];
        out.items.push(...items.map(s => s.trim().slice(0, 40)));
        out.defeated.push({ name: e.name, tier: e.tier || 'normal', xp, money });
    }
    out.money = Math.round(out.money * 100) / 100;
    out.items = [...new Set(out.items)].slice(0, 4);
    return out;
}

/** A compact record of the fight for the AI that tells the story. */
export function summarizeForNarration(state, rewards = null) {
    const party = state.combatants.filter(c => c.side === 'party');
    const enemies = state.combatants.filter(c => c.side === 'enemy');
    const notable = state.log.filter(e => e.crit || e.weak || ['down', 'flee', 'status', 'heal', 'knock', 'onemore', 'baton', 'allout', 'reflect', 'block'].includes(e.type)).slice(-16).map(e => e.text);
    return {
        result: state.result,
        rounds: state.round,
        environment: state.environment || '',
        party: party.map(c => ({ name: c.name, hp: `${c.hp}/${c.maxHp}`, down: c.down })),
        enemies: enemies.map(c => ({ name: c.name, defeated: c.down })),
        highlights: notable,
        rewards: rewards ? { xp: rewards.xp, money: rewards.money, items: rewards.items } : null,
    };
}
