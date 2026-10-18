#!/usr/bin/env node
/**
 * Velvet Room test: the fusion rules (Arcana chart, same-Arcana, special and
 * treasure fusions), unlocks, level limits, Confidant bonus levels, skill
 * inheritance and the swap in the stock, over the real Compendium.
 *
 * Usage:  node tools/velvet-test.mjs     (from the repo root)
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

const PM = await import(`${DES}/src/utils/personaModel.js`);
const F = await import(`${DES}/src/utils/fusionModel.js`);
const Pe = await import(`${DES}/src/systems/features/characterPersonas.js`);
const Comp = await import(`${DES}/src/systems/features/personaCompendium.js`);
const V = await import(`${DES}/src/systems/features/velvetRoom.js`);
const Cf = await import(`${DES}/src/systems/features/characterConfidants.js`);

const book = JSON.parse(readFileSync('compendium/Persona-Compendium.json', 'utf8'));
const comp = PM.parseCompendium(Object.values(book.entries));
const g = (n) => comp.find(x => x.name === n);
const res = (...names) => F.fusionResult(names.map(g), comp);

// ── 1. Reading the Compendium ──
check('the Compendium has fusion records', comp.length === 328 && comp.every(d => d.fusion));
check('special recipes are read', g('Alice').fusion.kind === 'special' && g('Alice').fusion.parts.join() === 'Belial,Nebiros' && g('Alice').fusion.unlock === 'Maxed Confidant: Death Rank 10');
check('party and treasure Personas are not fusable', g('Hermes').fusion.kind === 'party' && g('Crystal Skull').fusion.kind === 'none' && F.isTreasure('Crystal Skull'));
check('inheritance types are read', g('Alice').fusion.inherits === 'curse' && g('Pixie').fusion.inherits !== '');
check('an entry without a Fusion line fuses the normal way', PM.parseCompendiumEntry({ comment: 'Persona: Homebrew', content: 'Arcana: Star\nLevel: 10' }).fusion.kind === 'normal');
check('unlock lines name the Confidant', JSON.stringify(F.unlockConfidant('Maxed Confidant: Hanged Rank 10')) === '{"arcana":"Hanged Man","rank":10}' && F.unlockConfidant('Story Progression: x') === null);

// ── 2. The rules ──
check('the chart: Fool × Magician = Death, both ways', F.chartArcana('Fool', 'Magician') === 'Death' && F.chartArcana('Magician', 'Fool') === 'Death');
check('P3/P4 Arcana fuse through their own charts', !!F.chartArcana('Aeon', 'Fool') && !!F.chartArcana('Jester', 'Fool'));
let r = res('Arsene', 'Pixie');
check('different Arcana: first of the result Arcana at (1 + 2) / 2 + 1 or above', r.def?.name === 'Agathion' && r.def.arcana === 'Chariot' && r.kind === 'normal', JSON.stringify(r.def?.name));
const lovers = comp.filter(d => d.arcana === 'Lovers' && d.fusion.kind === 'normal').sort((a, b) => a.level - b.level);
const two = lovers.slice(-2);
r = F.fusionResult(two, comp);
check('same Arcana: strongest below the target that is neither parent', r.def && r.def.arcana === 'Lovers' && !two.some(p => p.name === r.def.name) && r.def.level <= (two[0].level + two[1].level) / 2 + 1);
r = F.fusionResult([lovers[0], lovers[1]], comp);
check('same Arcana with nothing weaker: the fusion fails', !!r.error);
r = res('Belial', 'Nebiros');
check('a special recipe beats the chart', r.def?.name === 'Alice' && r.kind === 'special');
const six = g('Izanagi-no-Okami').fusion.parts;
r = F.fusionResult(six.map(g), comp);
check('a six-Persona special fusion', r.def?.name === 'Izanagi-no-Okami' && six.length === 6);
check('three Personas that are no recipe: no fusion', !!res('Arsene', 'Pixie', 'Jack Frost').error);
check('special Personas never come out of a normal fusion', F.allFusions(comp.filter(d => d.level < 30 && d.fusion.kind === 'normal').slice(0, 40), comp).every(x => x.kind === 'special' || x.def.fusion.kind === 'normal'));
r = res('Crystal Skull', 'Pixie');
const row = lovers.map(d => d.name);
check('a treasure moves the Persona inside its Arcana', r.kind === 'treasure' && row.indexOf(r.def.name) - row.indexOf('Pixie') === 1, r.def?.name);
check('two treasures do not fuse', !!res('Crystal Skull', 'Koh-i-Noor').error);
check('the same Persona twice does not fuse', !!F.fusionResult([g('Pixie'), g('Pixie')], comp).error);
check('trained Personas fuse by their base level', F.fusionResult([{ ...g('Arsene'), level: 40 }, g('Pixie')], comp).def?.name === 'Agathion');
check('reverse lookup finds recipes that work', F.recipesFor(g('Agathion'), comp, { limit: 6 }).every(x => res(...x.names).def?.name === 'Agathion') && F.recipesFor(g('Agathion'), comp).length > 0);
check('reverse lookup of a special Persona is its recipe', F.recipesFor(g('Alice'), comp)[0].names.join() === 'Belial,Nebiros');

// ── 3. Skills ──
check('slots grow with the skills the parents know', F.inheritSlots(1) === 1 && F.inheritSlots(4) === 2 && F.inheritSlots(8) === 3 && F.inheritSlots(20) === 4 && F.inheritSlots(0) === 0);
check('inheritance types: a Fire Persona cannot take Ice', F.canInherit('fire', 'Bufu') === false && F.canInherit('fire', 'Agi') === true && F.canInherit('fire', 'Tarukaja') === true);
check('Almighty types take everything, treasures nothing', F.canInherit('almighty', 'Bufu') && !F.canInherit('none', 'Agi'));
const inh = F.inheritance([{ skills: ['Agi', 'Bufu', 'Dia'] }, { skills: ['Agi', 'Zio'] }], { skills: ['Dia'], fusion: { inherits: 'fire' } });
check('the pool skips repeats and the result\'s own skills', inh.pool.join() === 'Agi,Zio' && inh.blocked.join() === 'Bufu' && inh.slots === 2);

// ── 4. In a chat ──
Comp.setCompendiumForTests(comp);
extensionSettings.velvetRoomEnabled = true;
P.setLevel('Mastera', true, 12);
for (const n of ['Arsene', 'Pixie', 'Jack Frost']) check(`owns ${n}`, !!Pe.addPersona('Mastera', true, n).persona);
const ids = (...names) => names.map(n => Pe.getPersonas('Mastera', true).find(p => p.name === n).id);
check('a Wild Card with two Personas can fuse', V.canFuse('Mastera', true));
let pv = V.previewFusion('Mastera', true, ids('Arsene', 'Pixie'));
check('the preview shows the result and its level', pv.def?.name === 'Agathion' && pv.level === g('Agathion').level && !pv.blocks.length);
check('the list of fusions covers every pair', V.listFusions('Mastera', true).length >= 2);
pv = V.previewFusion('Mastera', true, ids('Pixie', 'Jack Frost'));
check('a result above your level is blocked', pv.def?.level > 12 && pv.blocks.some(b => /level/.test(b)), pv.def?.name);
const before = Pe.getPersonas('Mastera', true).length;
const arsSkills = Pe.getPersonas('Mastera', true).find(p => p.name === 'Arsene').skills;
let f = V.fuse('Mastera', true, ids('Arsene', 'Pixie'), { skills: [arsSkills[0]] });
check('fusing removes the parents and adds the result', f.persona?.name === 'Agathion' && Pe.getPersonas('Mastera', true).length === before - 1 && !Pe.getPersonas('Mastera', true).some(p => p.name === 'Arsene' || p.name === 'Pixie'), f.error);
check('...with the chosen skill inherited', f.persona.skills.includes(arsSkills[0]) && f.inherited.join() === arsSkills[0]);
check('...and equipped when a parent was', Pe.getActivePersona('Mastera', true)?.name === 'Agathion');
check('fusing what you no longer have fails', !!V.fuse('Mastera', true, ids('Agathion').concat(['nope'])).error);

// Unlocks and the Confidant bonus.
P.setLevel('Mastera', true, 99);
for (const n of ['Belial', 'Nebiros']) Pe.addPersona('Mastera', true, n);
extensionSettings.confidantsEnabled = true;
pv = V.previewFusion('Mastera', true, ids('Belial', 'Nebiros'));
check('Alice needs the maxed Death Confidant', pv.def?.name === 'Alice' && pv.blocks.some(b => /Death Confidant/.test(b)), JSON.stringify(pv.blocks));
check('...and the Fuse refuses', !!V.fuse('Mastera', true, ids('Belial', 'Nebiros')).error);
Cf.startConfidant('Mister D', 'Death');
Cf.setConfidantRank('Mister D', 10);
pv = V.previewFusion('Mastera', true, ids('Belial', 'Nebiros'));
check('with the Confidant maxed it goes, with bonus levels', !pv.blocks.length && pv.level === g('Alice').level + 5 && pv.bonus === 5, JSON.stringify(pv.blocks));
f = V.fuse('Mastera', true, ids('Belial', 'Nebiros'));
check('Alice joins the stock', f.persona?.name === 'Alice' && f.persona.level === g('Alice').level + 5);
P.setLevel('Mastera', true, 84);
check('the bonus can take it past your level', F.resultLevel(g('Alice'), { bonus: 5 }) === g('Alice').level + 5);
extensionSettings.velvetRoomEnabled = false;
check('the Velvet Room can be switched off', !V.canFuse('Mastera', true) && !!V.fuse('Mastera', true, []).error);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
