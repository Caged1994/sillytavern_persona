#!/usr/bin/env node
/**
 * Personas test: the Compendium format, owning and equipping Personas,
 * attributes taken from the equipped one, level-ups, the AI's "personas"
 * key and swipe undo.
 * party-shared awards and level-ups, attribute points, NPC levels from the
 * AI, quest XP, swipe undo, chats and the RPG mode switch.
 *
 * Usage:  node tools/character-progress-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 *
 * Reuses the stub sandbox tools/load-check.mjs builds, with two stubs made
 * real (chat and chat_metadata) because the undo record lives there.
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
chat.push({ is_user: true, mes: 'a' }, { is_user: false, mes: 'b' });
const last = () => chat.length - 1;


const PM = await import(`${DES}/src/utils/personaModel.js`);
const CM = await import(`${DES}/src/utils/combatModel.js`);
const SK = await import(`${DES}/src/utils/skillModel.js`);
const Pe = await import(`${DES}/src/systems/features/characterPersonas.js`);
const Comp = await import(`${DES}/src/systems/features/personaCompendium.js`);
const Mods = await import(`${DES}/src/systems/features/characterModifiers.js`);

// ── 1. Model ──
const ARSENE = { comment: 'Persona: Arsène', content: 'Arcana: Fool\nLevel: 1\nSt 2 · Ma 2 · En 2 · Ag 3 · Lu 1\nPhys - · Gun - · Fire - · Ice Wk · Elec - · Wind - · Psy - · Nuke - · Bless Wk · Curse Rs\nSkills: Eiha, Cleave\nLearns: Lv2 Rakukaja, Lv4 Sukunda\nDescription: Gentleman thief.' };
const ars = PM.parseCompendiumEntry(ARSENE);
check('a Compendium entry is read', ars && ars.name === 'Arsène' && ars.arcana === 'Fool' && ars.level === 1);
check('...with its stats', JSON.stringify(ars.stats) === '{"st":2,"ma":2,"en":2,"ag":3,"lu":1}');
check('...affinities (Gun included)', ars.affinities.ice === 'wk' && ars.affinities.bless === 'wk' && ars.affinities.curse === 'rs' && ars.affinities.gun === '' && Object.keys(ars.affinities).length === 10);
check('...skills, learn list and description', ars.skills.join() === 'Eiha,Cleave' && ars.learns.length === 2 && ars.desc === 'Gentleman thief.');
check('the header may be the first line instead of the title', PM.parseCompendiumEntry({ comment: 'whatever', content: 'Persona: Pixie\nArcana: lovers\nElec Rs, Gun Wk' })?.arcana === 'Lovers');
check('an entry without stats gets the even spread of its level', PM.statTotalAt(5) === Object.values(PM.parseCompendiumEntry({ comment: 'Persona: X', content: 'Level: 5' }).stats).reduce((a, b) => a + b, 0));
check('other entries are not Personas', PM.parseCompendiumEntry({ comment: 'Tokyo', content: 'A city.' }) === null);
check('disabled entries and duplicates are skipped', PM.parseCompendium([ARSENE, { ...ARSENE }, { comment: 'Persona: Off', content: '', disable: true }]).length === 1);
const up = PM.setPersonaLevel(ars, 4);
check('a level gives 3 stat points', Object.values(up.persona.stats).reduce((a, b) => a + b, 0) === 10 + 9);
check('...spread like the stats it has (Ag grows most)', up.persona.stats.ag >= up.persona.stats.st && up.persona.stats.lu <= up.persona.stats.st);
check('...and teaches the skills of the learn list', up.learned.join() === 'Rakukaja,Sukunda' && up.persona.skills.length === 4);
check('stats never pass 99', Object.values(PM.setPersonaLevel(ars, 99).persona.stats).every(v => v <= 99));
const gen = PM.generateStats(30, { focus: 'ma', weak: 'en' });
check('a made-up Persona leans on its focus', gen.ma > gen.st && gen.en < gen.st && Object.values(gen).reduce((a, b) => a + b, 0) === PM.statTotalAt(30));
check('affinity words', PM.normalizeAffinity('Weak') === 'wk' && PM.normalizeAffinity('absorb') === 'dr' && PM.normalizeAffinity('reflect') === 'rp' && PM.normalizeAffinity('block') === 'nu' && PM.normalizeAffinity('-') === '');
check('element names and aliases', PM.findElement('Electric').id === 'elec' && PM.findElement('guns').id === 'gun' && PM.findElement('Psychic').id === 'psy');

// ── 2. Owning and equipping ──
Comp.setCompendiumForTests([ars]);
check('nobody has a Persona: attributes are the character\'s own', S.getCurrentStatValues('Mastera', true).st === 10 && !S.hasPersonaAttributes('Mastera', true));
let r = Pe.addPersona('Mastera', true, 'Arsène');
check('a Compendium Persona is copied in', r.persona?.source === 'compendium' && Pe.getActivePersona('Mastera', true)?.name === 'Arsène');
check('the attributes now come from it', S.getCurrentStatValues('Mastera', true).ag === 3 && S.getCurrentStatValues('Mastera', true).lu === 1);
check('...for the effective values too', Mods.getEffectiveStatValues('Mastera', true).values.st === 2);
check('its skills join the spells', Ab.getAbilities('Mastera', true).some(a => a.name === 'Eiha' && a.fromPersona));
S.setCurrentStatValue('Mastera', true, 'st', 5);
check('editing St edits the Persona', Pe.getActivePersona('Mastera', true).stats.st === 5);
check('...not the Compendium', ars.stats.st === 2);
check('a Persona above the character\'s level is refused', !!Pe.addPersona('Mastera', true, { name: 'Bicorn', arcana: 'Hermit', focus: 'st', level: 6 }).error);
P.setLevel('Mastera', true, 7);
check('...the equipped one levels with the character', Pe.getActivePersona('Mastera', true).level === 7);
r = Pe.addPersona('Mastera', true, { name: 'Bicorn', arcana: 'Hermit', focus: 'st', level: 6 });
check('a Persona not in the Compendium is made from the level', r.persona?.level === 6 && Object.values(r.persona.stats).reduce((a, b) => a + b, 0) === PM.statTotalAt(6));
check('a Wild Card keeps the first one equipped', Pe.getActivePersona('Mastera', true).name === 'Arsène' && Pe.getPersonas('Mastera', true).length === 2);
check('the same Persona twice is refused', !!Pe.addPersona('Mastera', true, 'Arsène').error);
Pe.equipPersona('Mastera', true, r.persona.id);
check('switching changes the attributes', S.getCurrentStatValues('Mastera', true).st === r.persona.stats.st);
check('...and the skills', !Ab.getAbilities('Mastera', true).some(a => a.name === 'Eiha'));
check('an NPC is not a Wild Card', Pe.getPersonaRecord('Elena', false).wildCard === false);
Pe.addPersona('Elena', false, { name: 'Carmen', arcana: 'Lovers', focus: 'ma' });
Pe.addPersona('Elena', false, { name: 'Hecate', arcana: 'Lovers', focus: 'ma' });
check('for anyone else a new Persona replaces the old (evolution)', Pe.getPersonas('Elena', false).map(p => p.name).join() === 'Hecate');

// ── 3. Levels follow the owner ──
Pe.equipPersona('Mastera', true, Pe.getPersonas('Mastera', true).find(p => p.name === 'Arsène').id);
const before = Pe.getActivePersona('Mastera', true);
const lvBefore = P.getProgress('Mastera', true).level;
P.awardXpTo('Mastera', true, 2000, { silent: true });
const after = Pe.getActivePersona('Mastera', true);
const gained = P.getProgress('Mastera', true).level - lvBefore;
check('a character level-up levels the equipped Persona', gained > 0 && after.level === before.level + gained, `levels ${gained}, persona ${before.level} → ${after.level}`);
check('...with 3 points a level', Object.values(after.stats).reduce((a, b) => a + b, 0) === Object.values(before.stats).reduce((a, b) => a + b, 0) + 3 * gained);
check('...and learns its skills', after.skills.includes('Rakukaja'));
check('the other Personas stay where they are', Pe.getPersonas('Mastera', true).find(p => p.name === 'Bicorn').level === 6);
const bic = Pe.getPersonas('Mastera', true).find(p => p.name === 'Bicorn');
Pe.setPersonaLevel('Mastera', true, bic.id, 99);
check('a Persona cannot be raised above its user', Pe.getPersonas('Mastera', true).find(p => p.name === 'Bicorn').level === P.getProgress('Mastera', true).level);
Pe.setPersonaLevel('Mastera', true, bic.id, 6);
Comp.setCompendiumForTests([ars, { ...ars, name: 'Satanael', level: 95, stats: { st: 60, ma: 60, en: 60, ag: 60, lu: 60 } }]);
check('a strong Compendium Persona is refused by hand', !!Pe.addPersona('Mastera', true, 'Satanael').error);
chat.push({ is_user: true, mes: 'q1' }, { is_user: false, mes: 'q2' });
Pe.applyAIPersonas({ Mastera: { add: 'Satanael' } }, last());
const sat = Pe.getPersonas('Mastera', true).find(p => p.name === 'Satanael');
check('the AI awakening one brings it down to the character\'s level', sat && sat.level === P.getProgress('Mastera', true).level && Object.values(sat.stats).every(v => v < 60));
Pe.revertAIPersonasForReplacedMessage(last());
Comp.setCompendiumForTests([ars]);

// ── 4. The AI ──
let instr = pb.generateTrackerInstructions(false, false);
check('the prompt lists the equipped Persona', instr.includes('PERSONAS') && instr.includes('Mastera [Wild Card]: Arsène (Fool') && instr.includes('weak Ice, Bless; resists Curse'));
check('...the Compendium names', instr.includes('Known Personas') && instr.includes('Arsène'));
check('...and how to awaken one', instr.includes('"personas"'));
chat.push({ is_user: true, mes: 'p1' }, { is_user: false, mes: 'p2' });
Pe.applyAIPersonas({ Bram: { awaken: { name: 'Captain Kidd', arcana: 'Chariot', focus: 'st', affinities: { Elec: 'rs', Wind: 'weak' }, skills: ['Zio', 'Lunge'] } } }, last());
const kidd = Pe.getActivePersona('Bram', false);
check('the AI awakens a Persona', kidd?.name === 'Captain Kidd' && kidd.arcana === 'Chariot' && kidd.affinities.elec === 'rs' && kidd.affinities.wind === 'wk');
check('...with numbers from the program', Object.values(kidd.stats).reduce((a, b) => a + b, 0) === PM.statTotalAt(kidd.level) && kidd.stats.st >= kidd.stats.ma);
check('a toast says so', toasts.some(t => /Bram awakened Captain Kidd/.test(t)));
Pe.applyAIPersonas({ Mastera: { equip: 'Bicorn', learn: ['Rakunda'] } }, last());
check('the AI switches a Wild Card\'s Persona and teaches it', Pe.getActivePersona('Mastera', true).name === 'Bicorn' && Pe.getActivePersona('Mastera', true).skills.includes('Rakunda'));
check('swipe puts everything back', Pe.revertAIPersonasForReplacedMessage(last()) === 2 && Pe.getActivePersona('Mastera', true).name === 'Arsène' && !Pe.getPersonas('Bram', false).length);
check('parser extracts personas', (() => { const x = parseResponse('{"personas":{"Bram":{"equip":"X"}}}'); return !!x.personas && !x.parsingFailed; })());
check('separate-mode context', pb.generateContextualSummary().includes('Personas: Mastera — Arsène'));

// ── 4b. In a fight ──
const Cb = await import(`${DES}/src/systems/features/combat.js`);
const fighter = Cb.buildPartyMember('Mastera', true).combatant;
check('a fighter takes the equipped Persona\'s affinities', fighter.affinities.ice === 'wk' && fighter.affinities.bless === 'wk' && fighter.affinities.curse === 'rs' && fighter.persona === 'Arsène');
const eiha = fighter.actions.find(x => x.label === 'Eiha');
check('...and its skills, with the real effect and cost', eiha && eiha.profile.type === 'skill' && eiha.profile.element === 'curse' && eiha.manaCost > 0);
const cleave = fighter.actions.find(x => x.label === 'Cleave');
check('Phys skills cost HP', cleave && cleave.hpCost === 6 && !cleave.manaCost);
const Ab2 = await import(`${DES}/src/systems/features/characterAbilities.js`);
Ab2.addAbility('Mastera', true, { name: 'Null Ice', type: 'ability' });
check('a passive like Null Ice covers the weakness', Cb.buildPartyMember('Mastera', true).combatant.affinities.ice === 'nu');
Comp.setCompendiumForTests([ars, PM.parseCompendiumEntry({ comment: 'Persona: Pixie', content: 'Arcana: Lovers\nLevel: 2\nSt 1 · Ma 3 · En 1 · Ag 3 · Lu 2\nPhys - · Gun Wk · Fire - · Ice - · Elec Rs · Wind - · Psy - · Nuke - · Bless - · Curse Wk\nSkills: Zio, Dia' })]);
const pix = Cb.enrichEnemySpec({ name: 'Pixie 2', tier: 'minion' });
check('a Shadow named after a Compendium Persona takes its affinities and skills', pix.persona === 'Pixie' && pix.affinities.gun === 'wk' && pix.attacks.some(x => x.name === 'Zio' && x.profile.element === 'elec'));
const made = Cb.enrichEnemySpec({ name: 'Bandit', affinities: { Fire: 'weak', Phys: 'resist' }, skills: ['Lunge', 'Nonsense'] });
check('otherwise the AI\'s affinities and real skill names are used', made.affinities.fire === 'wk' && made.affinities.phys === 'rs' && made.attacks.length === 1);
const st = Cb.buildEncounter([{ name: 'Mastera', isUser: true }], [{ name: 'Pixie', tier: 'normal' }], { seed: 1 });
const e1 = st.combatants.find(c => c.side === 'enemy');
check('the encounter builds it with the Pixie shape (Ma above St)', e1.affinities.curse === 'wk' && e1.attrs.ma > e1.attrs.st);

// ── 4c. HP and SP in points ──
const Rs = await import(`${DES}/src/systems/features/characterResources.js`);
const hpMax = Rs.resourceMax('Mastera', true, 'health');
check('max HP follows the Persona\'s En and the level', hpMax > 30 && hpMax === CM.maxHpFor(Pe.getActivePersona('Mastera', true).stats.en, P.getProgress('Mastera', true).level));
Rs.setResourcePoints('Mastera', true, 'health', hpMax - 7);
check('HP set in points comes back exactly', Rs.getResource('Mastera', true, 'health').cur === hpMax - 7);
const spMax = Rs.resourceMax('Mastera', true, 'mana');
Rs.setResourcePoints('Mastera', true, 'mana', spMax - 3);
check('SP too', Rs.getResource('Mastera', true, 'mana').cur === spMax - 3 && spMax === SK.spPointsAt(P.getProgress('Mastera', true).level));
const f2 = Cb.buildPartyMember('Mastera', true).combatant;
check('a fighter starts with the same HP and SP points', f2.hp === hpMax - 7 && CM.spPoints(f2).cur === spMax - 3);
const eiha2 = f2.actions.find(x => x.label === 'Eiha');
const spBefore = CM.spPoints(f2).cur;
const st2 = CM.createCombat({ combatants: [f2, CM.makeCombatant({ id: 'x', name: 'X', side: 'enemy' })] });
st2.phase = 'active'; st2.order = [f2.id, 'x'];
CM.performAction(st2, f2.id, eiha2.id, 'x');
check('a skill costs its SP in points', CM.spPoints(f2).cur === spBefore - 4 && eiha2.spPoints === 4);
Rs.setResourcePoints('Mastera', true, 'health', hpMax);
Rs.setResourcePoints('Mastera', true, 'mana', spMax);

// ── 5. Switch off ──
Pe.setPersonasEnabled(false);
check('switched off: attributes are the character\'s own again', S.getCurrentStatValues('Mastera', true).st === 10 && !pb.generateTrackerInstructions(false, false).includes('PERSONAS'));
Pe.setPersonasEnabled(true);
otherChat();
check('another chat has its own Personas', !Pe.getPersonas('Mastera', true).length);
backToChat();

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll persona checks pass');
