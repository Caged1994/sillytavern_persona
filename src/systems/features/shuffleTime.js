/**
 * Shuffle Time — the card draw after a won fight (rules in shuffleModel.js).
 *
 * The draw lives on the fight's state (state.shuffle) while the end screen is
 * open: { chance, reasons, cards, phase: 'show' | 'pick' | 'done', picked, text }.
 * Closing the window without picking loses it, as in the games.
 */
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { getPersonaName, getStatSheet, getCurrentStatValues, setCurrentStatValue, notifyStatsChanged } from './characterStats.js';
import { saveChatScope } from './chatScope.js';
import { isCombatEnabled, grantSpoils, setItemGear } from './combat.js';
import { awardPartyXp, isXpEnabled } from './characterProgress.js';
import { isMoneyEnabled, getCurrency } from './characterMoney.js';
import { isEquipmentEnabled } from './characterEquipment.js';
import { getPersonaRecord, addPersona, personaLevelCap, isPersonasEnabled } from './characterPersonas.js';
import { getCompendium } from './personaCompendium.js';
import { activeStats } from '../../utils/statsModel.js';
import { MAX_STOCK } from '../../utils/personaModel.js';
import * as S from '../../utils/shuffleModel.js';

export function isShuffleEnabled() {
    return isCombatEnabled() && extensionSettings.shuffleTimeEnabled !== false;
}

export function setShuffleEnabled(on) {
    extensionSettings.shuffleTimeEnabled = !!on;
    saveSettings();
}

function playerLevel(player) {
    const cap = personaLevelCap(player, true);
    return cap === null ? null : cap;
}

/** The suits that make sense with the features that are on. */
export function availableSuits() {
    return S.SUIT_IDS.filter(id => (id === 'coins' ? isMoneyEnabled() : id === 'wands' ? isXpEnabled() : id === 'swords' ? isEquipmentEnabled() : true));
}

/** Whether the player can take a Persona card (a Wild Card with room). */
function canTakePersona(player) {
    if (!isPersonasEnabled()) return false;
    const rec = getPersonaRecord(player, true);
    return rec.wildCard && rec.list.length < MAX_STOCK;
}

/**
 * Rolls for Shuffle Time after a fight; deals the cards when it comes.
 * @returns {object|null} state.shuffle, or null
 */
export function rollShuffle(state, { rng = Math.random, report = null } = {}) {
    if (!isShuffleEnabled() || !state || state.shuffle) return state?.shuffle || null;
    const { chance, reasons } = S.shuffleChance(state);
    if (!chance || rng() >= chance) return null;
    const player = getPersonaName();
    if (!player) return null;
    const owned = isPersonasEnabled() ? getPersonaRecord(player, true).list.map(p => p.name) : [];
    const cards = S.dealCards(state, getCompendium(), {
        userLevel: playerLevel(player), owned, suits: availableSuits(), personas: canTakePersona(player), rng,
    });
    if (!cards.length) return null;
    state.rewardsForShuffle = { money: report?.rewards?.money || 0, xp: report?.rewards?.xp || 0 };
    state.shuffle = { chance, reasons, cards, phase: 'show', picked: null, text: '', order: cards.map((_, i) => i) };
    return state.shuffle;
}

/** Turns the cards face down and mixes them (the P4 shuffle). */
export function shuffleCards(state, { rng = Math.random } = {}) {
    const sh = state?.shuffle;
    if (!sh || sh.phase !== 'show') return sh;
    sh.order = S.shuffledOrder(sh.cards.length, rng);
    sh.phase = 'pick';
    return sh;
}

/** What a card would give, worded for the UI. */
export function cardLabel(state, card) {
    const r = state?.rewardsForShuffle || {};
    const cur = getCurrency();
    return S.describeCard(card, { money: r.money || 0, xp: r.xp || 0, currency: cur ? (cur.symbol || cur.name) : '', level: playerLevel(getPersonaName() || '') || 1 });
}

/**
 * Takes the card at a face-down position. Applies it and returns the text.
 * @returns {{ text: string } | { error: string }}
 */
export function takeCard(state, position, report = null) {
    const sh = state?.shuffle;
    if (!sh || sh.phase !== 'pick') return { error: 'No Shuffle Time now.' };
    const card = sh.cards[sh.order[position]];
    if (!card) return { error: 'No such card.' };
    const player = getPersonaName();
    const rewards = report?.rewards || state.rewardsForShuffle || {};
    let text = '';
    if (card.kind === 'persona') {
        const res = addPersona(player, true, { name: card.name, level: card.level });
        text = res.error ? `${card.name} slipped away (${res.error})` : `${player} obtained the Persona ${card.name} (${card.arcana} Lv ${res.persona.level})`;
    } else if (card.suit === 'cups') {
        const share = S.RANK_VALUES.cups[card.rank - 1] * 100;
        const healed = [];
        for (const c of state.combatants.filter(x => x.side === 'party')) {
            const sheet = activeStats(getStatSheet(c.name, c.isUser));
            const cur = getCurrentStatValues(c.name, c.isUser, sheet);
            for (const id of ['health', 'mana']) {
                if (!sheet.some(s => s.id === id)) continue;
                setCurrentStatValue(c.name, c.isUser, id, Math.min(100, (Number(cur[id]) || 0) + share), { persist: false });
            }
            healed.push(c.name);
        }
        text = `the party recovered ${share}% HP and SP`;
    } else if (card.suit === 'coins') {
        const amount = S.coinAmount(card, rewards.money || 0, playerLevel(player) || 1);
        const got = grantSpoils({ money: amount });
        text = got.money ? `${player} found ${got.money}${getCurrency() ? ' ' + (getCurrency().symbol || getCurrency().name) : ''} more` : 'a few coins, gone';
    } else if (card.suit === 'wands') {
        const xp = S.wandXp(card, rewards.xp || 0);
        if (isXpEnabled()) awardPartyXp(xp, { reason: 'Shuffle Time — Wands', source: 'ai' });
        text = `the party gained ${xp} extra XP`;
    } else if (card.suit === 'swords') {
        const got = grantSpoils({ items: [card.weapon] });
        if (got.items.length) setItemGear(player, true, card.weapon, card.atk, 0);
        text = got.items.length ? `${player} obtained the weapon ${card.weapon}` : 'a weapon, lost';
    }
    sh.phase = 'done';
    sh.picked = card.id;
    sh.text = card.kind === 'persona' ? text : `${S.describeCard(card).title}: ${text}`;
    saveChatScope();
    notifyStatsChanged({ source: 'shuffle' });
    return { text: sh.text, card };
}

/** Passes on the cards. */
export function skipShuffle(state) {
    const sh = state?.shuffle;
    if (!sh || sh.phase === 'done') return;
    sh.phase = 'done';
    sh.picked = null;
    sh.text = '';
}
