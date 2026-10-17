#!/usr/bin/env node
/**
 * Confidant abilities test: the teammate ladder and lorebook ranks, Baton
 * Pass behind the bond, Follow Up, Endure, Protect, Harisen Recovery, the
 * combat setup from the chat, the prompt and the Persona Awakening.
 *
 * Usage:  node tools/bond-test.mjs     (from the repo root)
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


const B = await import(`${DES}/src/utils/bondModel.js`);
const M = await import(`${DES}/src/utils/combatModel.js`);
const CM = await import(`${DES}/src/utils/confidantModel.js`);
const PM = await import(`${DES}/src/utils/personaModel.js`);
const Pe = await import(`${DES}/src/systems/features/characterPersonas.js`);
const Comp = await import(`${DES}/src/systems/features/personaCompendium.js`);
const Cf = await import(`${DES}/src/systems/features/characterConfidants.js`);
const CA = await import(`${DES}/src/systems/features/confidantAbilities.js`);
const Cb = await import(`${DES}/src/systems/features/combat.js`);

// ── 1. The ladder ──
const ladder = B.bondAbilities(5);
check('six abilities, by rank', ladder.map(a => a.id).join() === 'baton,followup,endure,harisen,protect,awaken' && ladder[0].rank === 2 && ladder[5].rank === 10);
check('rank 5: Baton Pass and Follow Up', B.unlockedIds(5).join() === 'baton,followup');
check('rank 10: all of them', B.unlockedIds(10).length === 6);
check('not a teammate: none', B.bondAbilities(10, null, { teammate: false }).length === 0);
const ryu = CM.parseConfidantEntry({ comment: 'Confidant: Ryuji', content: 'Arcana: Chariot\nRank 1 unlocks: Baton Pass\nRank 3 unlocks: Follow Up\nRank 5 unlocks: discounts on recovery items\nRank 10 unlocks: Captain Kidd evolves into Seiten Taisei' });
const rr = B.abilityRanks(ryu);
check('lorebook lines move the ranks', rr.baton === 1 && rr.followup === 3 && rr.awaken === 10 && rr.endure === 6);
check('...and unrelated unlocks do not', rr.harisen === 7 && rr.protect === 8);
check('the evolution is read from the text', B.evolutionTarget(ryu) === 'Seiten Taisei' && B.evolutionTarget(null) === '');
check('chances: Follow Up 30%→50%, Harisen 35%→50%', B.followUpChance(4) === 0.3 && B.followUpChance(10) === 0.5 && B.harisenChance(7) === 0.35 && B.harisenChance(10) === 0.5);
const aw = B.awakenInPlace({ name: 'X', stats: { st: 98, ma: 5, en: 5, ag: 5, lu: 5 }, affinities: { ice: 'wk', fire: 'rs' } });
check('in-place Awakening: weaknesses go, stats +2 (max 99)', aw.affinities.ice === '' && aw.affinities.fire === 'rs' && aw.stats.st === 99 && aw.stats.ma === 7 && aw.awakened);

// ── 2. In a fight ──
const fighter = (id, name, extra = {}) => M.makeCombatant({ id, name, side: 'party', level: 20, attrs: { st: 20, ma: 20, en: 20, ag: 20, lu: 20 }, ...extra });
const foe = (id, extra = {}) => M.makeCombatant({ id, name: 'Shadow ' + id, side: 'enemy', level: 20, attrs: { st: 20, ma: 20, en: 20, ag: 20, lu: 20 }, ...extra });
const fight = (party, enemies, seed = 7, batonBond = true) => {
    const s = M.createCombat({ combatants: [...party, ...enemies], seed });
    s.batonBond = batonBond;
    M.startCombat(s);
    return s;
};
// Baton Pass
let s = fight([fighter('u', 'Joker', { isUser: true }), fighter('a', 'Ann', { bond: { rank: 2, abilities: ['baton'] } }), fighter('b', 'Bram', { bond: { rank: 1, abilities: [] } })], [foe('e1')]);
s.order = ['u', 'a', 'b', 'e1']; s.turn = 0; s.pendingMore = 'u'; M.advance(s);
check('in a 1 More the leader passes only to teammates with Baton Pass', M.inOneMore(s) && M.batonTargets(s).join() === 'a');
M.batonPass(s, 'a');
check('...who can pass it back to the leader', M.batonTargets(s).join() === 'u' || M.batonTargets(s).length === 0);
s = fight([fighter('u', 'Joker', { isUser: true }), fighter('b', 'Bram')], [foe('e1')], 7, false);
s.order = ['u', 'b', 'e1']; s.turn = 0; s.pendingMore = 'u'; M.advance(s);
check('with Confidants off Baton Pass is free', M.batonTargets(s).join() === 'b');

// Endure
s = fight([fighter('u', 'Joker', { isUser: true }), fighter('a', 'Ann', { bond: { rank: 6, abilities: ['endure'] } })], [foe('e1', { attrs: { st: 99, ma: 20, en: 20, ag: 99, lu: 20 } })]);
const ann = M.getCombatant(s, 'a'); ann.hp = 5;
let ev = [];
for (let i = 0; i < 20 && !ev.some(e => e.ability === 'endure'); i++) ev = M.performAction(s, 'e1', 'basic', 'a');
check('Endure: a fatal blow leaves 1 HP', ann.hp === 1 && !ann.down && ev.some(e => e.ability === 'endure'));
for (let i = 0; i < 20 && !ann.down; i++) M.performAction(s, 'e1', 'basic', 'a');
check('...only once a fight', ann.down);

// Protect
s = fight([fighter('u', 'Joker', { isUser: true }), fighter('a', 'Ann', { bond: { rank: 8, abilities: ['protect'] } })], [foe('e1', { attrs: { st: 99, ma: 20, en: 20, ag: 99, lu: 20 } })]);
const joker = M.getCombatant(s, 'u'); joker.hp = 3;
ev = [];
for (let i = 0; i < 20 && !ev.some(e => e.ability === 'protect'); i++) ev = M.performAction(s, 'e1', 'basic', 'u');
check('Protect: the teammate takes the fatal blow', joker.hp === 3 && !joker.down && ev.some(e => e.ability === 'protect') && M.getCombatant(s, 'a').hp < M.getCombatant(s, 'a').maxHp);
for (let i = 0; i < 20 && !joker.down; i++) M.performAction(s, 'e1', 'basic', 'u');
check('...once a fight', joker.down);

// Follow Up
let fu = 0;
let swings = 0;
for (let seed = 1; seed <= 400; seed++) {
    s = fight([fighter('u', 'Joker', { isUser: true }), fighter('a', 'Ann', { bond: { rank: 4, abilities: ['followup'] } })], [foe('e1', { attrs: { st: 20, ma: 20, en: 99, ag: 20, lu: 20 } })], seed);
    ev = M.performAction(s, 'u', 'basic', 'e1');
    if (ev.some(e => e.type === 'knock')) continue;
    swings++;
    if (ev.some(e => e.ability === 'followup')) fu++;
}
check('Follow Up after about 30% of the leader\'s attacks', swings > 200 && fu / swings > 0.22 && fu / swings < 0.38, `${fu}/${swings}`);
s = fight([fighter('u', 'Joker', { isUser: true }), fighter('a', 'Ann', { bond: { rank: 10, abilities: ['followup'] } })], [foe('e1', { attrs: { st: 20, ma: 20, en: 99, ag: 20, lu: 20 } })], 3);
let teammateFu = false;
for (let i = 0; i < 40; i++) if (M.performAction(s, 'a', 'basic', 'e1').some(e => e.ability === 'followup')) teammateFu = true;
check('...never after a teammate\'s own attack', !teammateFu);

// Harisen Recovery
let cured = 0;
for (let seed = 1; seed <= 200; seed++) {
    s = fight([fighter('u', 'Joker', { isUser: true }), fighter('a', 'Ann', { bond: { rank: 7, abilities: ['harisen'] } })], [foe('e1')], seed);
    s.order = ['e1', 'u', 'a']; s.turn = 0;
    M.getCombatant(s, 'u').statuses = [{ id: 'confuse', turns: 3 }];
    const evs = M.advance(s);
    if (evs.some(e => e.ability === 'harisen')) cured++;
}
check('Harisen Recovery cures the leader about 35% of the time', cured > 45 && cured < 95, String(cured));

// ── 3. From the chat ──
extensionSettings.confidantsEnabled = true;
extensionSettings.personasEnabled = true;
P.setPartyMember('Elena', true);
Cf.startConfidant('Elena', 'Lovers');
Cf.setConfidantRank('Elena', 6);
Cf.startConfidant('Bram', 'Hermit');
Cf.setConfidantRank('Bram', 9);
check('a teammate Confidant brings the abilities of their rank', JSON.stringify(CA.combatBond('Elena', false)?.abilities) === '["baton","followup","endure"]');
check('someone who does not fight with you brings none', CA.combatBond('Bram', false) === null && CA.getBondAbilities('Bram').list.length === 0);
check('the leader brings none', CA.combatBond('Mastera', true) === null);
const enc = Cb.buildEncounter([{ name: 'Mastera', isUser: true }, { name: 'Elena', isUser: false }], [{ name: 'Slime', tier: 'small' }], { seed: 5 });
check('the encounter carries the bond and the Baton rule', enc.batonBond === true && enc.combatants.find(c => c.name === 'Elena')?.bond?.abilities.includes('endure'));
const prompt = Cf.buildConfidantPromptForGeneration();
check('the prompt names the teammate\'s abilities', /Elena \(Lovers 6; [^)]*Baton Pass, Follow Up, Endure/.test(prompt), prompt.slice(0, 300));
extensionSettings.confidantsEnabled = false;
check('with Confidants off nobody has abilities and Baton Pass is free', CA.combatBond('Elena', false) === null && CA.batonNeedsBond() === false);
extensionSettings.confidantsEnabled = true;

// Awakening
const pix = PM.parseCompendiumEntry({ comment: 'Persona: Pixie', content: 'Arcana: Lovers\nLevel: 2\nSt 1 · Ma 3 · En 1 · Ag 3 · Lu 2\nPhys - · Gun Wk · Fire - · Ice Wk · Elec Rs · Wind - · Psy - · Nuke - · Bless - · Curse Wk\nSkills: Zio, Dia' });
const queen = PM.parseCompendiumEntry({ comment: 'Persona: Titania', content: 'Arcana: Lovers\nLevel: 48\nSt 30 · Ma 40 · En 30 · Ag 35 · Lu 30\nSkills: Mediarama, Ziodyne' });
Comp.setCompendiumForTests([pix, queen]);
P.setLevel('Elena', false, 50); P.setLevel('Bram', false, 50);
check('Elena has a Persona', !!Pe.addPersona('Elena', false, { name: 'Pixie', level: 2 }).persona);
check('the Awakening waits for its rank', !CA.awakeningInfo('Elena').can && /rank 10/.test(CA.awakeningInfo('Elena').reason));
Cf.setConfidantRank('Elena', 10);
let r = CA.awakenPersona('Elena');
check('without a named evolution: same Persona, no weaknesses, +2 stats', r.persona?.name === 'Pixie' && r.persona.awakened && r.persona.affinities.ice === '' && r.persona.stats.ma === 5);
check('...once', !CA.awakeningInfo('Elena').can && CA.awakeningInfo('Elena').done && !!CA.awakenPersona('Elena').error);
check('the awakened Persona is the equipped one', Pe.getActivePersona('Elena', false)?.awakened === true);
Cf.setDefinitionsForTests([CM.parseConfidantEntry({ comment: 'Confidant: Bram', content: 'Arcana: Hermit\nRank 9 unlocks: Pixie evolves into Titania' })]);
P.setPartyMember('Bram', true);
Pe.addPersona('Bram', false, { name: 'Pixie', level: 2 });
const info = CA.awakeningInfo('Bram');
check('a lorebook evolution names the new Persona', info.can && info.into === 'Titania' && info.known);
r = CA.awakenPersona('Bram');
check('...which comes from the Compendium, keeping the old skills', r.persona?.name === 'Titania' && r.persona.level === 48 && r.persona.skills.includes('Zio') && r.persona.awakened);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
