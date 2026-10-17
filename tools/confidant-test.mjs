#!/usr/bin/env node
/**
 * Confidants test: the lorebook format, ranks and requirements, the three
 * modes (defined / mixed / sandbox), the affinity gate, one person per
 * Arcana, "Ask first", the AI's "confidants" key and swipe undo.
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


const CM = await import(`${DES}/src/utils/confidantModel.js`);
const Cf = await import(`${DES}/src/systems/features/characterConfidants.js`);

// ── 1. Model ──
const RYUJI = { comment: 'Confidant: Ryuji Sakamoto', content: 'Arcana: chariot\nRank 2 requires: Guts 2\nRank 5 requires: Level 20\nRank 4 unlocks: Follow-up attack\nRank 10 unlocks: Seiten Taisei\nDescription: Loud, loyal.' };
const d = CM.parseConfidantEntry(RYUJI);
check('a lorebook entry is read', d && d.name === 'Ryuji Sakamoto' && d.arcana === 'Chariot' && d.desc === 'Loud, loyal.');
check('...with requirements and unlocks', d.requires.length === 2 && d.requires[0].social === 'guts' && d.requires[0].socialRank === 2 && d.requires[1].level === 20 && d.unlocks.map(u => u.rank).join() === '4,10');
check('other entries are not Confidants', CM.parseConfidantEntry({ comment: 'Shibuya', content: 'A district.' }) === null);
check('one per Arcana in a book', CM.parseConfidantBook([RYUJI, { comment: 'Confidant: Other', content: 'Arcana: Chariot' }]).length === 1);
check('ranks cost more as they go', CM.rankCost(1) === 7 && CM.rankCost(9) === 23);
let r = CM.addPoints({ arcana: 'Chariot', rank: 1, points: 0 }, 20, null);
check('points raise the rank, the rest carries over', r.rec.rank === 3 && r.rec.points === 4 && r.ranksGained === 2);
r = CM.addPoints({ arcana: 'Chariot', rank: 1, points: 0 }, 10, d, { social: { guts: 1 }, level: 1 });
check('a requirement holds the rank back', r.rec.rank === 1 && r.blocked === 'Guts 2 needed' && r.rec.points === 7);
r = CM.addPoints({ arcana: 'Chariot', rank: 1, points: 0 }, 10, d, { social: { guts: 2 }, level: 1 });
check('...until it is met', r.rec.rank === 2);
check('arcana numbers', CM.arcanaNumber('Fool') === '0' && CM.arcanaNumber('Chariot') === 'VII' && CM.arcanaNumber('World') === 'XXI' && CM.arcanaNumber('Faith') === '');
const ai = CM.normalizeAIConfidants({ Elena: 9, Bram: { start: 'hermit', reason: 'a pact' }, Nobody: -2 });
check('AI shapes: points capped, a start with its Arcana', ai.length === 2 && ai[0].add === 5 && ai[1].start === 'Hermit' && ai[1].reason === 'a pact');

// ── 2. Sandbox (no lorebook Confidants) ──
Cf.setDefinitionsForTests([]);
check('no lorebook Confidants: sandbox', Cf.getConfidantMode() === 'sandbox');
let instr = pb.generateTrackerInstructions(false, false);
check('the prompt explains how a bond forms', instr.includes('CONFIDANTS of Mastera') && instr.includes('"start"') && instr.includes('Chariot'));
Af.setAffinity('Elena', 5);
Cf.applyAIConfidants({ Elena: { start: 'Lovers' } }, last());
check('affinity too low: no bond', !Cf.getBond('Elena'));
Af.setAffinity('Elena', 30);
Cf.applyAIConfidants({ Elena: { start: 'Lovers', reason: 'shared secret' } }, last());
check('affinity high enough: a new Confidant at rank 1', Cf.getBond('Elena')?.arcana === 'Lovers' && Cf.getBond('Elena').rank === 1 && toasts.some(t => /Elena — Lovers/.test(t)));
Af.setAffinity('Bram', 40);
Cf.applyAIConfidants({ Bram: { start: 'Lovers' } }, last());
check('one person per Arcana', !Cf.getBond('Bram'));
check('the player is never a Confidant', (Cf.applyAIConfidants({ Mastera: { start: 'Fool' } }, last()), !Cf.getBond('Mastera')));
chat.push({ is_user: true, mes: 'c1' }, { is_user: false, mes: 'c2' });
Cf.applyAIConfidants({ Elena: 5 }, last());
Cf.applyAIConfidants({ Elena: 4 }, last());
check('points from the AI raise the rank', Cf.getBond('Elena').rank === 2);
check('swipe takes the reply back', Cf.revertAIConfidantsForReplacedMessage(last()) === 1 && Cf.getBond('Elena').rank === 1 && Cf.getBond('Elena').points === 0);
check('parser extracts confidants', (() => { const x = parseResponse('{"confidants":{"Elena":2}}'); return !!x.confidants && !x.parsingFailed; })());
check('separate-mode context', pb.generateContextualSummary().includes("Mastera's Confidants: Elena (Lovers 1)"));

// ── 3. Ask first ──
Cf.setConfirm(true);
Cf.applyAIConfidants({ Bram: { start: 'Hermit' } }, last());
check('with "Ask first" the bond waits', !Cf.getBond('Bram') && Cf.getPending().some(p => p.name === 'Bram' && p.arcana === 'Hermit'));
check('...and its Arcana is held', !Cf.freeArcana().includes('Hermit'));
Cf.acceptPending('Bram');
check('Accept forms it', Cf.getBond('Bram')?.arcana === 'Hermit' && !Cf.getPending().length);
Cf.setConfirm(false);

// ── 4. Defined and mixed ──
Cf.removeConfidant('Bram');
Cf.setDefinitionsForTests([CM.parseConfidantEntry({ comment: 'Confidant: Bram', content: 'Arcana: Emperor\nRank 2 requires: Kindness 3' })]);
check('lorebook Confidants: mixed by default', Cf.getConfidantMode() === 'mixed');
check('a lorebook Confidant not met yet is listed', Cf.getUnmet().some(u => u.name === 'Bram'));
check('its Arcana is not free for the story', !Cf.freeArcana({ forStory: true }).includes('Emperor'));
instr = pb.generateTrackerInstructions(false, false);
check('the AI is told who can still form', instr.includes('Not met yet as Confidants: Bram (Emperor)'));
Af.setAffinity('Bram', -50);
Cf.applyAIConfidants({ Bram: { start: 'Tower' } }, last());
check('a lorebook Confidant forms with its own Arcana, whatever the affinity', Cf.getBond('Bram')?.arcana === 'Emperor' && Cf.getBond('Bram').source === 'lorebook');
Cf.applyAIConfidants({ Bram: 5 }, last()); Cf.applyAIConfidants({ Bram: 5 }, last());
check('its requirement (Kindness 3) holds rank 2', Cf.getBond('Bram').rank === 1 && Cf.getBond('Bram').progress.points === CM.rankCost(1));
Cf.setConfidantMode('defined');
check('defined mode is set for the card', Cf.getConfidantMode() === 'defined');
extensionSettings.knownCharacters.Zed = {};
committedTrackerData.characterThoughts = JSON.stringify({ characters: [{ name: 'Elena' }, { name: 'Bram' }, { name: 'Zed' }, { name: 'Mastera' }] });
Af.setAffinity('Zed', 80);
Cf.applyAIConfidants({ Zed: { start: 'Star' } }, last());
check('defined: the story cannot add others', !Cf.getBond('Zed'));
check('...but you can by hand', Cf.startConfidant('Zed', 'Star').ok && Cf.getBond('Zed')?.arcana === 'Star');
check('by hand too, one per Arcana', !!Cf.startConfidant('Someone', 'Star').error);
Cf.setConfidantMode('auto');

// ── 5. Off ──
Cf.setConfidantsEnabled(false);
check('switched off: not sent', !pb.generateTrackerInstructions(false, false).includes('CONFIDANTS'));
Cf.setConfidantsEnabled(true);
otherChat();
check('another chat has its own bonds', !Cf.getBonds().length);
backToChat();

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll confidant checks pass');
