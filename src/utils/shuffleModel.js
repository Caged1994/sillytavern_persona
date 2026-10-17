/**
 * Shuffle Time (Persona 3 / Persona 4) — pure rules.
 *
 * After a won fight there is a chance of Shuffle Time: a handful of cards is
 * dealt face up, turned and shuffled (as in Persona 4), and the player takes
 * one. The deck holds:
 *   Persona cards  a Persona of a defeated Shadow (or one from the Compendium
 *                  near the player's level), at its base level and never
 *                  above the player's;
 *   Minor Arcana   (Persona 3) Cups heal the party's HP and SP, Coins give
 *                  money, Wands extra XP, Swords a weapon.
 * Minor cards have a rank (I–III) that sets how much they give.
 */
export const SUITS = {
    cups: { name: 'Cups', icon: '🍷', what: 'heals the party' },
    coins: { name: 'Coins', icon: '🪙', what: 'money' },
    wands: { name: 'Wands', icon: '🪄', what: 'extra XP' },
    swords: { name: 'Swords', icon: '🗡️', what: 'a weapon' },
};
export const SUIT_IDS = Object.keys(SUITS);
export const RANKS = ['I', 'II', 'III'];
export const DECK_SIZE = 4;
export const BASE_CHANCE = 0.3;
export const MAX_CHANCE = 0.9;

/** What a minor card of a rank gives, as multipliers or amounts. */
export const RANK_VALUES = {
    cups: [0.25, 0.5, 1],       // share of max HP and SP restored
    coins: [1, 2, 3],           // × the fight's money (at least a level-based sum)
    wands: [0.5, 1, 2],         // × the fight's XP, added on top
    swords: [3, 5, 7],          // attack of the weapon
};

const WEAPON_NAMES = [
    [1, ['Rusty Blade', 'Old Knuckles', 'Wooden Staff']],
    [15, ['Steel Blade', 'Iron Knuckles', 'Hunter\'s Bow']],
    [35, ['Silver Saber', 'Tempered Fists', 'Moon Spear']],
    [55, ['Mythril Edge', 'Dragon Knuckles', 'Star Lance']],
    [75, ['Orichalcum Fang', 'Gaia Gauntlets', 'Heaven\'s Spear']],
];

/**
 * The chance of Shuffle Time after a fight (0 unless won): 30%, +30% when
 * an All-Out Attack ended it, +20% when nobody in the party was hurt, +10%
 * for a fight won within two rounds — at most 90%.
 * @returns {{ chance: number, reasons: string[] }}
 */
export function shuffleChance(state) {
    if (!state || state.result !== 'victory') return { chance: 0, reasons: [] };
    if (!state.combatants.some(c => c.side === 'enemy' && c.down)) return { chance: 0, reasons: [] };
    const reasons = [];
    let chance = BASE_CHANCE;
    const log = state.log || [];
    const lastAllOut = log.map(e => e.type).lastIndexOf('allout');
    const lastDown = log.map((e, i) => (e.type === 'down' && state.combatants.find(c => c.id === e.target)?.side === 'enemy' ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    if (lastAllOut !== -1 && lastDown > lastAllOut) { chance += 0.3; reasons.push('All-Out Attack finish'); }
    const partyIds = new Set(state.combatants.filter(c => c.side === 'party').map(c => c.id));
    if (!log.some(e => e.type === 'damage' && partyIds.has(e.target) && e.amount > 0)) { chance += 0.2; reasons.push('no damage taken'); }
    if ((state.round || 99) <= 2) { chance += 0.1; reasons.push('quick win'); }
    return { chance: Math.min(MAX_CHANCE, Math.round(chance * 100) / 100), reasons };
}

const nameKey = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Personas the deck may offer: those of the defeated Shadows first, then
 * Compendium ones near the player's level. Never above the player's level,
 * never one already owned, never a party member's own Persona.
 * @returns {object[]} Compendium records
 */
export function personaCandidates(state, compendium, { userLevel = null, owned = [] } = {}) {
    const have = new Set(owned.map(nameKey));
    const fits = (d) => d && (userLevel === null || d.level <= userLevel) && !have.has(nameKey(d.name)) && d.fusion?.kind !== 'party';
    const byName = new Map(compendium.map(d => [nameKey(d.name), d]));
    const fromFight = [];
    for (const e of state.combatants.filter(c => c.side === 'enemy' && c.down)) {
        const d = byName.get(nameKey(e.persona || e.name));
        if (fits(d) && !fromFight.includes(d)) fromFight.push(d);
    }
    const ref = userLevel ?? Math.max(1, ...state.combatants.filter(c => c.side === 'party').map(c => c.level || 1));
    const near = compendium.filter(d => fits(d) && d.fusion?.kind === 'normal' && d.level >= ref - 10 && !fromFight.includes(d));
    return { fromFight, near };
}

/** Rank 1–3, weighted toward the low ones (55 / 32 / 13 %). */
function rollRank(rng) {
    const r = rng();
    return r < 0.55 ? 1 : r < 0.87 ? 2 : 3;
}

export function weaponName(level, rank, rng) {
    let names = WEAPON_NAMES[0][1];
    for (const [min, list] of WEAPON_NAMES) if (level >= min) names = list;
    const base = names[Math.floor(rng() * names.length) % names.length];
    return rank > 1 ? `${base} +${rank - 1}` : base;
}

/**
 * Deals the cards.
 * @param {object} o
 * @param {string[]} o.suits - the minor suits that can be dealt (features that are off are left out)
 * @param {boolean} o.personas - whether Persona cards can be dealt
 * @param {function} o.rng - () => [0, 1)
 * @returns {object[]} cards: { id, kind: 'persona'|'minor', … }
 */
export function dealCards(state, compendium, { userLevel = null, owned = [], suits = SUIT_IDS, personas = true, rng = Math.random, size = DECK_SIZE } = {}) {
    const cards = [];
    if (personas && compendium.length) {
        const { fromFight, near } = personaCandidates(state, compendium, { userLevel, owned });
        const want = rng() < 0.4 ? 2 : 1;
        const pool = [...fromFight];
        const extra = [...near];
        while (pool.length < want && extra.length) pool.push(extra.splice(Math.floor(rng() * extra.length), 1)[0]);
        for (const d of pool.slice(0, want)) {
            cards.push({ kind: 'persona', name: d.name, arcana: d.arcana, level: d.level, fromFight: fromFight.includes(d) });
        }
    }
    const level = userLevel ?? Math.max(1, ...state.combatants.filter(c => c.side === 'party').map(c => c.level || 1));
    while (cards.length < size && suits.length) {
        const suit = suits[Math.floor(rng() * suits.length) % suits.length];
        const rank = rollRank(rng);
        const card = { kind: 'minor', suit, rank };
        if (suit === 'swords') { card.weapon = weaponName(level, rank, rng); card.atk = RANK_VALUES.swords[rank - 1]; }
        cards.push(card);
    }
    // Shuffle the dealt order too, so a Persona is not always first.
    for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards.map((c, i) => ({ ...c, id: `c${i}` }));
}

/** A positions permutation for the face-down shuffle (no card stays put when it can be avoided). */
export function shuffledOrder(n, rng = Math.random) {
    const order = [...Array(n).keys()];
    for (let tries = 0; tries < 10; tries++) {
        for (let i = n - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        if (n < 2 || order.every((v, i) => v !== i)) break;
    }
    return order;
}

/** Card title and one line, for the UI and the story. */
export function describeCard(card, { money = 0, xp = 0, currency = '', level = 1 } = {}) {
    if (card.kind === 'persona') return { title: card.name, line: `${card.arcana || 'Persona'} · Lv ${card.level}` };
    const s = SUITS[card.suit];
    const r = RANK_VALUES[card.suit][card.rank - 1];
    const title = `${RANKS[card.rank - 1]} of ${s.name}`;
    if (card.suit === 'cups') return { title, line: `Restores ${Math.round(r * 100)}% HP and SP to the party` };
    if (card.suit === 'coins') return { title, line: `${coinAmount(card, money, level)}${currency ? ' ' + currency : ''}` };
    if (card.suit === 'wands') return { title, line: `${xp ? `+${wandXp(card, xp)} XP` : 'Extra XP'} to the party` };
    return { title, line: `${card.weapon} (attack ${card.atk})` };
}

/** Money a Coins card gives: × the fight's money, at least 20 × level. */
export function coinAmount(card, fightMoney, level = 1) {
    const base = Math.max(fightMoney || 0, 20 * Math.max(1, level));
    return Math.round(base * RANK_VALUES.coins[card.rank - 1]);
}

/** XP a Wands card adds: × the fight's XP (at least 5). */
export function wandXp(card, fightXp) {
    return Math.max(5, Math.round((fightXp || 0) * RANK_VALUES.wands[card.rank - 1]));
}
