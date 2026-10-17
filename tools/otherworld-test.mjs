#!/usr/bin/env node
/**
 * Dungeon test — the dungeon rules (layout, fog, moves, camp, dressing) and
 * the glue to the Stats data (fights, traps, chests, rest, the end).
 *
 * Usage:  node tools/otherworld-test.mjs     (from the repo root)
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
const Cb = await import(`${DES}/src/systems/features/combat.js`);
const M = await import(`${DES}/src/utils/combatModel.js`);
const Cd = await import(`${DES}/src/systems/features/characterConditions.js`);
const Mo = await import(`${DES}/src/systems/features/characterMoney.js`);
const Af = await import(`${DES}/src/systems/features/characterAffinity.js`);
const { chatStore } = await import(`${DES}/src/systems/features/chatScope.js`);

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};

const D = await import(`${DES}/src/utils/dungeonModel.js`);
const Dg = await import(`${DES}/src/systems/features/dungeon.js`);

extensionSettings.enabled = true;
extensionSettings.userCharacters = { Mastera: {} };
extensionSettings.activeUserCharacter = 'Mastera';
extensionSettings.lorebook = { campaigns: {}, activeCampaignId: null };
extensionSettings.knownCharacters = { Elena: {} };
committedTrackerData.characterThoughts = JSON.stringify({ characters: [{ name: 'Elena' }, { name: 'Mastera' }] });
for (const [n, u] of [['Mastera', true], ['Elena', false]]) { Eq.cancelStartingGear(n, u); Ab.cancelStartingAbilities(n, u); }
S.saveStatSheet('Elena', false, S.getStatSheet('Elena', false), { pending: false });
chat.push({ is_user: true, mes: 'We go down the old well.', name: 'Mastera' }, { is_user: false, mes: 'A cold draught.', name: 'Narrator' });
P.setPartyMember('Elena', true);
const party = [{ name: 'Mastera', isUser: true }, { name: 'Elena', isUser: false }];

const K = await import(`${DES}/src/utils/siteModel.js`);
const OW = await import(`${DES}/src/systems/features/otherworld.js`);
const Cal = await import(`${DES}/src/systems/features/calendar.js`);
const CK = await import(`${DES}/src/utils/calendarModel.js`);
extensionSettings.otherworldEnabled = true;
extensionSettings.calendarEnabled = true;
extensionSettings.reaperEnabled = true;
const noAI = { useAI: false };

// ── 1. Model ──
const lab = K.normalizeSite({ name: 'Tartarus', kind: 'labyrinth', blocks: [{}, { unlock: { type: 'date', value: '2016-05-05' } }, { unlock: { type: 'site', value: 'Castle' } }, {}], levels: [1, 60] });
check('a labyrinth: first block open, the rest sealed', lab.blocks[0].unlocked && !lab.blocks[1].unlocked && K.unlockedFloors(lab) === 5 && K.totalFloors(lab) === 20);
check('levels follow the depth', K.labyrinthLevel(lab, 1) === 1 && K.labyrinthLevel(lab, 20) === 60 && K.labyrinthLevel(lab, 10) > K.labyrinthLevel(lab, 5));
check('blocks open on a date or after a domain', K.dueUnlocks(lab, { today: '2016-05-05' }).join() === '1' && K.dueUnlocks(lab, { today: '2016-05-04', clearedSites: ['castle'] }).join() === '2');
check('a run covers a block and ends with its guardian', (() => { const r = K.labyrinthRun(lab, 0); return r.floors === 5 && r.floorOffset === 0 && r.lastIsBoss && r.levels.length === 5; })());
check('checkpoints: block starts after a beaten guardian', K.checkpoints({ ...lab, blocks: lab.blocks.map((b, i) => ({ ...b, unlocked: i < 2, cleared: i === 0 })) }).map(c => c.floor).join() === '1,6');
const dom = K.normalizeSite({ name: 'Castle', kind: 'domain', ruler: 'Kamoshida', deadline: '2016-05-02', areas: 3, level: 8 });
check('a domain: areas at its level, ruler at the end', K.domainRun(dom).levels.join() === '8,9,10' && K.domainRun(dom).lastIsBoss);
check('the deadline counts down, then is missed', K.daysLeft(dom, '2016-04-28') === 4 && !K.missedDeadline(dom, '2016-05-02') && K.missedDeadline(dom, '2016-05-03'));
const lbLab = K.parseSiteEntry({ comment: 'Dungeon: Mementos', content: 'Kind: labyrinth\nTheme: the subway of the collective heart\nBlocks: 3\nFloors per block: 4\nLevels: 3-50\nBlock 2 opens: after Kamoshida\'s Castle\nBlock 3 opens: on June 10, 2016\nReaper: off' });
check('lorebook labyrinth', lbLab.kind === 'labyrinth' && lbLab.blocks.length === 3 && lbLab.floorsPerBlock === 4 && lbLab.levels.join() === '3,50' && lbLab.blocks[1].unlock.type === 'site' && lbLab.blocks[2].unlock.value === '2016-06-10' && lbLab.reaper === false, JSON.stringify(lbLab.blocks));
const lbDom = K.parseSiteEntry({ comment: 'Dungeon: Yukiko\'s Castle', content: 'Kind: domain\nRuler: Shadow Yukiko\nAreas: 4\nLevel: 12\nDeadline: April 29, 2011\nAppears: April 16, 2011' });
check('lorebook domain, hidden until it appears', lbDom.kind === 'domain' && lbDom.ruler === 'Shadow Yukiko' && lbDom.areas === 4 && lbDom.level === 12 && lbDom.deadline === '2011-04-29' && lbDom.status === 'hidden' && lbDom.appears === '2011-04-16');
check('other entries are not places', K.parseSiteEntry({ comment: 'Tokyo', content: 'A city.' }) === null);
const aiKey = K.normalizeAIOtherworld(JSON.stringify({ new: { name: 'Bank of Gluttony', ruler: 'Kaneshiro', deadline: 'July 12', areas: 3 }, unlock: 'Tartarus', request: { site: 'Tartarus', title: 'Find the lost cat', floor: 3 } }), { year: 2016 });
check('the AI key: new domain with a deadline, unlock, request', aiKey.add[0].deadline === '2016-07-12' && aiKey.unlock[0].site === 'Tartarus' && aiKey.requests[0].floor === 3);

// ── 2. In a chat ──
Cal.setNow('2016-04-20', 'afternoon');
OW.setBookSitesForTests([lbLab, K.normalizeSite({ name: 'Kamoshida\'s Castle', kind: 'domain', ruler: 'Kamoshida', deadline: '2016-05-02', areas: 2, level: 4, source: 'lorebook' })]);
let sites = OW.getSites();
check('lorebook places join the chat', sites.length === 2 && sites.some(s => s.name === 'Mementos'));
const castle = OW.getSite('Kamoshida\'s Castle');
check('a domain\'s deadline goes on the calendar', Cal.getEvents().some(e => e.kind === 'deadline' && /Kamoshida's Castle/.test(e.title) && e.date === '2016-05-02'));
let run = await OW.enterSite(castle.id, party, noAI);
check('entering a domain builds its areas, its ruler at the end', run.state && run.state.floors.length === 2 && run.state.site.kind === 'domain' && Object.values(run.state.floors[1].rooms).some(r => r.type === 'boss' && r.enemies[0].name === 'Kamoshida'));
check('...enemies at the domain\'s level', D.floorLevel(run.state, 0) === 4 && Object.values(run.state.floors[0].rooms).filter(r => r.type === 'combat').every(r => r.enemies.every(e => e.level >= 4)));
// walk to the safe room if there is one, then leave
const rest = Object.values(run.state.floors[0].rooms).find(r => r.type === 'rest');
if (rest) { run.state.checkpoint = { floor: 0, room: rest.id }; }
Dg.saveLiveDungeon(run.state);
Dg.endDungeon(run.state, 'left');
const slotBefore = Cal.getNow().slot;
await Dg.finishDungeon(run.state, { narrate: false });
check('leaving keeps the progress for next time', !!OW.getSite(castle.id).saved);
check('a visit takes a time of day', Cal.getNow().slot === 'evening' && slotBefore === 'afternoon');
run = await OW.enterSite(castle.id, party, noAI);
check('coming back resumes at the last safe room (or the entrance)', run.resumed && run.state.at === (rest ? rest.id : run.state.floors[0].start) && run.state.phase === 'active');
Dg.endDungeon(run.state, 'cleared');
await Dg.finishDungeon(run.state, { narrate: false });
check('clearing it marks the domain and its deadline done', OW.getSite(castle.id).status === 'cleared' && !OW.getSite(castle.id).saved && Cal.getEvents().find(e => /Kamoshida's Castle/.test(e.title))?.done === true);
check('...and opens what waited for it', OW.getSite('Mementos').blocks[1].unlocked === true);
run = await OW.enterSite(castle.id, party, noAI);
check('a cleared domain can be revisited, its ruler gone', run.state && !run.state.floors.some(f => Object.values(f.rooms).some(r => r.type === 'boss')) && Object.values(run.state.floors[1].rooms).some(r => r.type === 'gate'));

// The labyrinth
const mem = OW.getSite('Mementos');
OW.addRequest(mem.id, { title: 'Stop the stalker', floor: 2 });
run = await OW.enterSite(mem.id, party, { ...noAI, block: 0 });
check('a labyrinth run: one block of floors at depth levels', run.state.floors.length === 4 && D.floorLevel(run.state, 0) === K.labyrinthLevel(mem, 1) && run.state.floorOffset === 0);
check('...with the request placed on its floor', Object.values(run.state.floors[1].rooms).some(r => r.request && r.requestTitle === 'Stop the stalker' && r.enemies[0].tier === 'elite'));
check('...and no Reaper when the place says off', run.state.reaper === null);
run.state.stats.floors = 4;
run.state.requestsDone = [OW.getSite(mem.id).requests[0].id];
Dg.endDungeon(run.state, 'cleared');
await Dg.finishDungeon(run.state, { narrate: false });
const mem2 = OW.getSite(mem.id);
check('beating the guardian: block cleared, depth kept, request done', mem2.blocks[0].cleared && mem2.deepest === 4 && mem2.requests[0].done);
check('...and the next block\'s first floor is a checkpoint', K.checkpoints(mem2).map(c => c.floor).join() === '1,5');
run = await OW.enterSite(mem.id, party, { ...noAI, block: 1 });
check('starting from the checkpoint', run.state.floorOffset === 4 && D.displayFloor(run.state) === 5);

// The Reaper
const tower = OW.addSite({ name: 'Tower', kind: 'labyrinth', blocks: [{}, {}], levels: [1, 20] }).site;
run = await OW.enterSite(tower.id, party, noAI);
const rs = run.state;
check('a labyrinth with the Reaper', rs.reaper && rs.reaper.after > 0);
rs.floorSteps = rs.reaper.after - 3;
check('a warning before it comes', D.reaperState(rs).warn && D.reaperState(rs).chance === 0);
rs.floorSteps = rs.reaper.after + 2;
check('then each step may bring it', D.reaperState(rs).chance > 0.3);
const spec = D.reaperSpec(rs);
check('it is far above the party', spec.tier === 'boss' && spec.level >= 60);
extensionSettings.reaperEnabled = false;
check('the Reaper can be switched off', (await OW.enterSite(tower.id, party, noAI)).state.reaper === null);

// Deadlines and the AI
const bank = OW.addSite({ name: 'Bank', kind: 'domain', deadline: '2016-05-10', areas: 2 }).site;
Cal.setNow('2016-05-11', 'morning');
OW.tick();
check('a missed deadline closes the domain', OW.getSite(bank.id).status === 'closed' && !OW.canEnter(OW.getSite(bank.id)).ok);
check('...and the story is told', /Closed for good.*Bank/.test(OW.buildOtherworldPromptForGeneration()));
chat.push({ is_user: true, mes: 'x' }, { is_user: false, mes: 'y' });
const n = OW.applyAIOtherworld(JSON.stringify({ new: { name: 'Museum of Vanity', ruler: 'Madarame', deadline: 'June 5, 2016', areas: 3 }, unlock: 'Tower' }), chat.length - 1);
check('the story adds a domain and opens a block', n === 2 && OW.getSite('Museum of Vanity')?.deadline === '2016-06-05' && OW.getSite('Tower').blocks[1].unlocked);
OW.revertAIOtherworldForReplacedMessage(chat.length - 1);
check('a swipe undoes it', !OW.getSite('Museum of Vanity') && !OW.getSite('Tower').blocks[1].unlocked);
const pr = OW.buildOtherworldPromptForGeneration();
check('the prompt lists the places and how to add one', /OTHERWORLD/.test(pr) && /Mementos \(great labyrinth/.test(pr) && /"otherworld": \{"new"/.test(pr));
extensionSettings.otherworldEnabled = false;
check('switched off: nothing', OW.buildOtherworldPromptForGeneration() === '');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
