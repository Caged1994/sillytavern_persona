#!/usr/bin/env node
/**
 * Shuffle Time test: the chance after a fight, the cards dealt (Persona
 * cards from the fight or near the level, never above it or owned; minor
 * suits only for features that are on), the face-down shuffle, each card.
 *
 * Usage:  node tools/shuffle-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const SANDBOX = '/tmp/des-load-check';
const DES = `${SANDBOX}/scripts/extensions/third-party/DES`;

execFileSync(process.execPath, ['tools/load-check.mjs'], { stdio: 'pipe' });
const scriptStub = `${SANDBOX}/script.js`;
writeFileSync(scriptStub, readFileSync(scriptStub, 'utf8')
    .replace('export const chat_metadata = anything;', 'export const chat_metadata = {};')
    .replace('export const chat = anything;', 'export const chat = [];'));

const anything = new Proxy(function () {}, {
    get(t, p) {
        if (p === Symbol.toPrimitive) return () => 'stub';
        if (p === 'then') return undefined;
        if (p === Symbol.iterator) return function* () {};
        return anything;
    },
    apply() { return anything; },
    construct() { return {}; },
});
globalThis.__DES_ANYTHING__ = anything;
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = anything;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 8, maxTouchPoints: 0 }, configurable: true });
globalThis.jQuery = anything;
globalThis.$ = anything;
const toasts = [];
globalThis.toastr = { success: (m) => toasts.push(m), info: (m) => toasts.push(m), warning: () => {} };
globalThis.SillyTavern = anything;
globalThis.requestAnimationFrame = () => 0;
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.dispatchEvent = () => true;

const { extensionSettings, committedTrackerData } = await import(`${DES}/src/core/state.js`);
const { chat, chat_metadata } = await import(`${SANDBOX}/script.js`);
// Data belongs to the chat: another chat is another dooms_tracker blob.
const savedChats = [];
const otherChat = () => { savedChats.push(chat_metadata.dooms_tracker); chat_metadata.dooms_tracker = {}; };
const backToChat = () => { chat_metadata.dooms_tracker = savedChats.pop(); };
const S = await import(`${DES}/src/systems/features/characterStats.js`);
const Eq = await import(`${DES}/src/systems/features/characterEquipment.js`);
const Ab = await import(`${DES}/src/systems/features/characterAbilities.js`);
const P = await import(`${DES}/src/systems/features/characterProgress.js`);
const R = await import(`${DES}/src/systems/features/rpgMode.js`);
const X = await import(`${DES}/src/utils/xpModel.js`);
const { parseResponse } = await import(`${DES}/src/systems/generation/parser.js`);
const pb = await import(`${DES}/src/systems/generation/promptBuilder.js`);

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const Cd = await import(`${DES}/src/systems/features/characterConditions.js`);
const Mo = await import(`${DES}/src/systems/features/characterMoney.js`);
const Af = await import(`${DES}/src/systems/features/characterAffinity.js`);
const So = await import(`${DES}/src/systems/features/characterSocial.js`);
const MoM = await import(`${DES}/src/utils/moneyModel.js`);
const AfM = await import(`${DES}/src/utils/affinityModel.js`);
const AbM = await import(`${DES}/src/utils/abilityModel.js`);
const Mod = await import(`${DES}/src/systems/features/characterModifiers.js`);

extensionSettings.enabled = true;
extensionSettings.userCharacters = { Mastera: {} };
extensionSettings.activeUserCharacter = 'Mastera';
extensionSettings.lorebook = { campaigns: {}, activeCampaignId: null };
extensionSettings.showInfoBox = true;
extensionSettings.showCharacterThoughts = true;
extensionSettings.showQuests = false;
extensionSettings.compactPrompts = true;
extensionSettings.customTrackerPrompt = '';
extensionSettings.knownCharacters = { Elena: {}, Bram: {} };
committedTrackerData.characterThoughts = JSON.stringify({ characters: [{ name: 'Elena' }, { name: 'Bram' }, { name: 'Mastera' }] });
for (const [n, u] of [['Mastera', true], ['Elena', false], ['Bram', false]]) { Eq.cancelStartingGear(n, u); Ab.cancelStartingAbilities(n, u); }
for (const n of ['Elena', 'Bram']) S.saveStatSheet(n, false, S.getStatSheet(n, false), { pending: false });
// Satiety, Energy, Hygiene and Morale start switched off, and a switched-off bar brings no condition.
S.setCurrentStatValue('Mastera', true, 'satiety', 5);
check('bars that start switched off bring no condition', !Cd.getConditions('Mastera', true).some(c => c.source === 'auto'));
S.setCurrentStatValue('Mastera', true, 'satiety', 80);
// The rules below need them on.
for (const id of ['satiety', 'energy', 'hygiene', 'morale']) S.setStatEnabled(id, true);


const SM = await import(`${DES}/src/utils/shuffleModel.js`);
const M = await import(`${DES}/src/utils/combatModel.js`);
const PM = await import(`${DES}/src/utils/personaModel.js`);
const Pe = await import(`${DES}/src/systems/features/characterPersonas.js`);
const Comp = await import(`${DES}/src/systems/features/personaCompendium.js`);
const Sh = await import(`${DES}/src/systems/features/shuffleTime.js`);
const Cb = await import(`${DES}/src/systems/features/combat.js`);

const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const fighter = (id, name, extra = {}) => M.makeCombatant({ id, name, side: 'party', level: 20, attrs: { st: 20, ma: 20, en: 20, ag: 20, lu: 20 }, ...extra });
const foe = (id, extra = {}) => M.makeCombatant({ id, name: 'Shadow ' + id, side: 'enemy', level: 18, attrs: { st: 20, ma: 20, en: 20, ag: 20, lu: 20 }, ...extra });
const won = ({ allOut = false, hurt = true, rounds = 4, enemies = [foe('e1')] } = {}) => {
    const s = M.createCombat({ combatants: [fighter('u', 'Mastera', { isUser: true }), ...enemies], seed: 3 });
    s.phase = 'ended'; s.result = 'victory'; s.round = rounds;
    for (const e of enemies) e.down = true;
    s.log = [];
    if (hurt) s.log.push({ type: 'damage', target: 'u', amount: 12 });
    if (allOut) s.log.push({ type: 'allout' });
    for (const e of enemies) s.log.push({ type: 'down', target: e.id });
    return s;
};

// ── 1. The chance ──
check('30% after a plain win', SM.shuffleChance(won()).chance === 0.3);
check('+30% All-Out finish, +20% unhurt, +10% quick: capped at 90%', SM.shuffleChance(won({ allOut: true, hurt: false, rounds: 2 })).chance === 0.9 && SM.shuffleChance(won({ allOut: true })).chance === 0.6);
check('nothing after a defeat', SM.shuffleChance({ ...won(), result: 'defeat' }).chance === 0);

// ── 2. The cards ──
const mk = (name, arcana, level, kind = 'normal') => ({ ...PM.parseCompendiumEntry({ comment: `Persona: ${name}`, content: `Arcana: ${arcana}\nLevel: ${level}` }), fusion: { kind, parts: [] } });
const comp = [mk('Pixie', 'Lovers', 2), mk('Jack Frost', 'Magician', 11), mk('Orobas', 'Hierophant', 17), mk('Lilim', 'Devil', 32), mk('Hermes', 'Chariot', 1, 'party'), mk('Yoshitsune', 'Tower', 18, 'special')];
const st = won({ enemies: [foe('e1', { persona: 'Orobas' }), foe('e2', { persona: 'Lilim' })] });
const cand = SM.personaCandidates(st, comp, { userLevel: 20, owned: ['Jack Frost'] });
const S_near = () => SM.personaCandidates(st, comp, { userLevel: 20, owned: [] }).near.map(d => d.name);
check('Persona cards: the defeated Shadows\' first, never above your level', cand.fromFight.map(d => d.name).join() === 'Orobas');
check('...then normal ones near your level, never owned, a party member\'s or a special one', cand.near.length === 0 && S_near().join() === 'Jack Frost');
const deck = SM.dealCards(st, comp, { userLevel: 20, owned: [], rng: seq(0.1, 0.5, 0.9, 0.3, 0.7) });
check('four cards, with a Persona card', deck.length === 4 && deck.some(c => c.kind === 'persona'));
check('no Persona cards when they cannot be taken', SM.dealCards(st, comp, { personas: false }).every(c => c.kind === 'minor'));
check('only the suits asked for', SM.dealCards(st, comp, { personas: false, suits: ['cups'] }).every(c => c.suit === 'cups'));
const sw = SM.dealCards(st, [], { personas: false, suits: ['swords'], userLevel: 40, rng: seq(0.95) })[0];
check('a Swords card names a weapon fit for the level, its rank sets the attack', /Silver|Tempered|Moon/.test(sw.weapon) && sw.rank === 3 && sw.atk === 7, JSON.stringify(sw));
check('the shuffle moves every card', SM.shuffledOrder(4, seq(0.1, 0.9, 0.4, 0.6, 0.2)).every((v, i) => v !== i));
check('Coins: × the fight\'s money, at least 20 × level', SM.coinAmount({ suit: 'coins', rank: 2 }, 0, 10) === 400 && SM.coinAmount({ suit: 'coins', rank: 1 }, 500, 10) === 500);
check('Wands: × the fight\'s XP', SM.wandXp({ suit: 'wands', rank: 3 }, 40) === 80 && SM.wandXp({ suit: 'wands', rank: 1 }, 0) === 5);

// ── 3. In a chat ──
extensionSettings.combatEnabled = true;
extensionSettings.shuffleTimeEnabled = true;
Comp.setCompendiumForTests(comp);
P.setLevel('Mastera', true, 20);
check('Mastera starts with a Persona', !!Pe.addPersona('Mastera', true, 'Pixie').persona);
let fight = won({ allOut: true, hurt: false, rounds: 1, enemies: [foe('e1', { persona: 'Orobas' })] });
check('a low roll misses Shuffle Time', Sh.rollShuffle(won(), { rng: () => 0.95 }) === null);
let sh = Sh.rollShuffle(fight, { rng: seq(0.05, 0.1, 0.5, 0.9, 0.3, 0.7, 0.2), report: { rewards: { money: 100, xp: 40 } } });
check('a good roll deals the cards face up', sh && sh.phase === 'show' && sh.cards.length === 4);
Sh.shuffleCards(fight, { rng: seq(0.1, 0.9, 0.4) });
check('shuffling turns them down', fight.shuffle.phase === 'pick');
const posOf = (pred) => fight.shuffle.order.findIndex(i => pred(fight.shuffle.cards[i]));
let pos = posOf(c => c.kind === 'persona');
let res = Sh.takeCard(fight, pos);
check('taking a Persona card adds it at its base level', /obtained the Persona Orobas/.test(res.text) && Pe.getPersonas('Mastera', true).some(p => p.name === 'Orobas' && p.level === 17), res.text);
check('...and the draw is over', fight.shuffle.phase === 'done' && !!Sh.takeCard(fight, 0).error);
const deal = (suit, rank = 1) => {
    const f = won();
    f.shuffle = { cards: [{ id: 'c0', kind: 'minor', suit, rank, ...(suit === 'swords' ? { weapon: 'Steel Blade', atk: 3 } : {}) }], order: [0], phase: 'pick' };
    f.rewardsForShuffle = { money: 100, xp: 40 };
    return f;
};
SM.SUIT_IDS; // the four suits
Mo.setMoney && Mo.setMoney('Mastera', true, 0);
res = Sh.takeCard(deal('coins', 2), 0);
check('Coins give money (at least 20 × level, × rank)', /found 800/.test(res.text), res.text);
res = Sh.takeCard(deal('swords'), 0);
check('Swords give a weapon with its attack', Eq.getEquipment('Mastera', true).some(i => i.name === 'Steel Blade'), res.text);
check('...that fights as gear', Cb.getItemCombat('Mastera', true, { name: 'Steel Blade' })?.atk === 3, JSON.stringify(Cb.getItemCombat('Mastera', true, { name: 'Steel Blade' })));
res = Sh.takeCard(deal('wands', 3), 0);
check('Wands give extra XP', /80 extra XP/.test(res.text), res.text);
res = Sh.takeCard(deal('cups', 2), 0);
check('Cups heal the party', /50% HP and SP/.test(res.text), res.text);
const skip = won(); skip.shuffle = { cards: [], order: [], phase: 'pick' };
Sh.skipShuffle(skip);
check('passing ends it with nothing', skip.shuffle.phase === 'done' && skip.shuffle.text === '');
extensionSettings.shuffleTimeEnabled = false;
check('switched off: never', Sh.rollShuffle(won({ allOut: true }), { rng: () => 0 }) === null);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
