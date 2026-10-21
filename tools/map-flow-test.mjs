#!/usr/bin/env node
/**
 * Map flow test: the places of the lorebook, who is where, open hours,
 * dungeon marks, going somewhere through the chat box (apply on send, cancel,
 * a different message), the prompt and the switch.
 *
 * Usage:  node tools/map-flow-test.mjs     (from the repo root)
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

const { extensionSettings } = await import(`${DES}/src/core/state.js`);
const { chat, chat_metadata } = await import(`${SANDBOX}/script.js`);
let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const A = await import(`${DES}/src/utils/activityModel.js`);
const P = await import(`${DES}/src/utils/placeModel.js`);
const Mp = await import(`${DES}/src/systems/features/map.js`);
const F = await import(`${DES}/src/systems/features/freeTime.js`);
const Cal = await import(`${DES}/src/systems/features/calendar.js`);
const Co = await import(`${DES}/src/systems/features/characterConfidants.js`);
const O = await import(`${DES}/src/systems/features/otherworld.js`);
const R = await import(`${DES}/src/systems/features/rpgMode.js`);
const S = await import(`${DES}/src/systems/features/characterStats.js`);

R.setDefaultRpgMode(true);
extensionSettings.calendarEnabled = true;
extensionSettings.confidantsEnabled = true;
F.setActivitiesForTests([{ name: 'Work at the cafe', where: 'Fog & Bean cafe', effects: 'Money +600' }, { name: 'Study', where: 'Library', effects: 'Knowledge +2' }]);
Mp.setPlacesForTests([
    { name: 'Moon Bridge', connects: 'Fog & Bean cafe, Library, Lantern Alley', pos: [30, 60] },
    { name: 'Fog & Bean cafe', short: 'Fog & Bean', connects: 'Moon Bridge', pos: [64, 48], when: 'afternoon, evening', aliases: 'Fog & Bean' },
    { name: 'Library', connects: 'Moon Bridge', when: 'weekdays afternoon' },
    { name: 'Lantern Alley', sites: 'The Empty Stage', connects: 'Moon Bridge', when: 'evening, night' },
], { water: [] });
chat.push({ is_user: false, mes: 'Welcome.' });
Cal.setNow('2016-04-12', 'afternoon'); // a Tuesday afternoon
Cal.setPlace('Moon Bridge Shopping Street, the arcade');
Co.startConfidant('Mei Hoshino', 'Star');
check('(a Confidant is set up)', !!Co.getBond('Mei Hoshino'));

// ── What the map shows ──
let m = Mp.mapNow();
check('the map lists the places', m && m.places.length === 4);
check('you are at the place the calendar says (by name inside the text)', m.here?.name === 'Moon Bridge');
check('open now: by time of day', m.places.find(p => p.name === 'Fog & Bean cafe').open && m.places.find(p => p.name === 'Library').open && !m.places.find(p => p.name === 'Lantern Alley').open);
check('links drawn', m.edges.length === 3);
check('every place has a position', m.places.every(p => Array.isArray(p.pos) && p.pos.length === 2));
const cafe = m.places.find(p => p.name === 'Fog & Bean cafe');
check('activities at a place come from their Where', cafe.activities.map(a => a.name).join() === 'Work at the cafe' && m.places.find(p => p.name === 'Library').activities[0]?.name === 'Study');

// ── Who is around (by the Confidants' Where lines) ──
Co.setDefinitionsForTests([{ name: 'Mei Hoshino', arcana: 'Star', desc: '', requires: [], unlocks: [], where: 'Fog & Bean cafe', when: { days: null, slots: ['evening'] } }]);
Co.startConfidant('Mei Hoshino', 'Star');
m = Mp.mapNow();
check('nobody at the cafe in the afternoon (her time is the evening)', m.places.find(p => p.name === 'Fog & Bean cafe').people.length === 0);
Cal.setNow('2016-04-12', 'evening');
m = Mp.mapNow();
check('a Confidant is at her place in her time', m.places.find(p => p.name === 'Fog & Bean cafe').people.map(x => x.name).join() === 'Mei Hoshino', JSON.stringify(m.places.map(p => p.people)));
Cal.setNow('2016-04-12', 'afternoon');

// ── Dungeon marks ──
m = Mp.mapNow();
check('no mark without an open dungeon', !m.places.find(p => p.name === 'Lantern Alley').alert);
extensionSettings.dungeonEnabled = true;
extensionSettings.combatEnabled = true;
extensionSettings.otherworldEnabled = true;
O.setBookSitesForTests([{ name: 'The Empty Stage', kind: 'domain', status: 'open', source: 'lorebook' }]);
check('(the Otherworld is on)', O.isOtherworldEnabled());
m = Mp.mapNow();
check('a dungeon open at a place marks it', m.places.find(p => p.name === 'Lantern Alley').alert === true);

// ── Going somewhere ──
let r = Mp.goTo('pl:library');
check('going puts a line in the chat box', r.text === '*' + (S.getPersonaName() || 'I') + ' goes to Library.*' && Mp.getPendingTravel()?.name === 'Library', JSON.stringify(r));
chat.push({ is_user: true, mes: r.text });
let moved = Mp.onMapMessageSent();
check('sending it moves the calendar place', moved?.name === 'Library' && Cal.getPlace() === 'Library', Cal.getPlace());
check('...no time passes', Cal.getNow().slot === 'afternoon' && Cal.getNow().date === '2016-04-12');
check('...once', Mp.getPendingTravel() === null);
m = Mp.mapNow();
check('you are now at the new place', m.here?.name === 'Library');
check('already there: nothing to do', !!Mp.goTo('pl:library').error);
check('closed now: no trip', /closed now/.test(Mp.goTo('pl:lantern-alley').error || ''));
check('unknown place', !!Mp.goTo('pl:nowhere').error);

r = Mp.goTo('pl:fog-bean-cafe');
chat.push({ is_user: true, mes: 'Actually I stay and read for a while.' });
check('another message instead: stays put', Mp.onMapMessageSent() === null && Cal.getPlace() === 'Library');
r = Mp.goTo('pl:fog-bean-cafe');
Mp.cancelTravel();
check('cancel drops it', Mp.getPendingTravel() === null);
r = Mp.goTo('pl:fog-bean-cafe');
chat.push({ is_user: true, mes: r.text.replace('*', '*Slowly, ') });
check('an edited line still counts', Mp.onMapMessageSent()?.name === 'Fog & Bean cafe' && Cal.getPlace() === 'Fog & Bean cafe');

// ── The prompt and the switch ──
const pr = Mp.buildMapPromptForGeneration();
check('the AI is told where you are and where you can go', /MAP/.test(pr) && /at Fog & Bean cafe/.test(pr) && /Moon Bridge/.test(pr) && /no time/.test(pr), pr);
extensionSettings.mapEnabled = false;
check('switched off: nothing', Mp.mapNow() === null && Mp.buildMapPromptForGeneration() === '' && !Mp.isMapEnabled());
extensionSettings.mapEnabled = true;
Cal.setNow('2016-04-12', 'night');
check('at night the cafe is closed', Mp.mapNow().places.find(p => p.name === 'Fog & Bean cafe').open === false);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
