#!/usr/bin/env node
/**
 * Free time test: activities (lorebook and generic), when/weather/rain,
 * the chat-box flow (apply on send, cancel, a different message), Confidant
 * hangouts with the Arcana bonus, worn out after the Otherworld.
 *
 * Usage:  node tools/freetime-test.mjs     (from the repo root)
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
const C = await import(`${DES}/src/utils/confidantModel.js`);
const F = await import(`${DES}/src/systems/features/freeTime.js`);
const Cal = await import(`${DES}/src/systems/features/calendar.js`);
const So = await import(`${DES}/src/systems/features/characterSocial.js`);
const Co = await import(`${DES}/src/systems/features/characterConfidants.js`);
const Pe = await import(`${DES}/src/systems/features/characterPersonas.js`);
const E = await import(`${DES}/src/systems/features/messageEvents.js`);
const R = await import(`${DES}/src/systems/features/rpgMode.js`);
const S = await import(`${DES}/src/systems/features/characterStats.js`);

// ── 1. The model ──
check('when: weekdays afternoon and evening', JSON.stringify(A.parseWhen('weekdays afternoon, evening')) === '{"days":[1,2,3,4,5],"slots":["afternoon","evening"]}');
check('when: days by name, night', JSON.stringify(A.parseWhen('Sunday and Saturday night')) === '{"days":[0,6],"slots":["night"]}');
check('when: empty is always', JSON.stringify(A.parseWhen('')) === '{"days":null,"slots":null}');
check('effects: social stats (with P4 names), money, SP', JSON.stringify(A.parseEffects('Knowledge +2, Money +300, SP +30%, Courage +1')) === '{"social":{"knowledge":2,"guts":1},"money":300,"hp":0,"sp":30}');
const lib = A.parseActivityEntry({ comment: 'Activity: Library study', content: 'Where: School library\nWhen: weekdays afternoon\nWeather: rain\nEffect: Knowledge +2\nRain: Knowledge +1\nText: {user} studies in the {where}.' });
check('a lorebook activity is read', lib && lib.name === 'Library study' && lib.where === 'School library' && lib.weather === 'rain' && lib.when.days.length === 5 && lib.effects.social.knowledge === 2 && lib.rain.social.knowledge === 1, JSON.stringify(lib));
check('a card with its own activities keeps Rest', A.activityList([lib]).map(a => a.name).join() === 'Library study,Rest');
check('without, the generic set', A.activityList([]).length === A.DEFAULT_ACTIVITIES.length);
const tue = 2;
check('open by day, time and weather', A.availableActivities([lib], { weekday: tue, slot: 'afternoon', weather: '☔ Rain' }).length === 1 && !A.availableActivities([lib], { weekday: tue, slot: 'afternoon', weather: '☀️ Sunny' }).length && !A.availableActivities([lib], { weekday: 0, slot: 'afternoon', weather: 'Rain' }).length);
check('worn out: only rest', A.availableActivities(A.DEFAULT_ACTIVITIES, { weekday: tue, slot: 'evening', tired: true }).map(a => a.name).join() === 'Rest');
check('rain adds its bonus', A.effectsNow(lib, { weather: 'Heavy rain' }).social.knowledge === 3);
check('a job pays with the level', A.effectsNow(A.DEFAULT_ACTIVITIES.find(a => a.job), { level: 5 }).money === 150);
check('the line for the chat box', A.activityText(lib.text, { user: 'Mastera', slot: 'afternoon', where: lib.where }) === '*Mastera studies in the School library.*');
check('hangout points: more with a Persona of the Arcana', A.hangoutPoints(false) === 3 && A.hangoutPoints(true) === 6);
const def = C.parseConfidantEntry({ comment: 'Confidant: Renji', content: 'Arcana: Magician\nWhen: weekdays evening\nWhere: Harbor Lights Coffee' });
check('a Confidant can have a schedule and a place', JSON.stringify(def.when) === '{"days":[1,2,3,4,5],"slots":["evening"]}' && def.where === 'Harbor Lights Coffee');

// ── 2. The flow ──
R.setDefaultRpgMode(true);
extensionSettings.calendarEnabled = true;
extensionSettings.characterSocialEnabled = true;
extensionSettings.confidantsEnabled = true;
F.setActivitiesForTests([]);
chat.push({ is_user: false, mes: 'Welcome.' });
Cal.setNow('2016-04-12', 'afternoon'); // a Tuesday
let ft = F.freeTimeNow();
check('free time lists what is open now', ft && ft.activities.some(a => a.name === 'Study') && !ft.tired);
const player = S.getPersonaName();
const k0 = So.getSocialPoints(player).knowledge || 0;
let r = F.pickActivity(ft.activities.find(a => a.name === 'Study').id);
check('picking puts a line in the chat box', r.text && /studying/.test(r.text) && F.getPendingFreeTime()?.name === 'Study');
chat.push({ is_user: true, mes: r.text.replace('*', '*Late ') });
let done = F.onFreeTimeMessageSent();
check('sending it applies the effect', done?.name === 'Study' && So.getSocialPoints(player).knowledge === k0 + 2, JSON.stringify(done));
check('...moves the calendar on', Cal.getNow().slot === 'evening');
check('...and notes it on the message', E.getMessageEvents(chat[chat.length - 1]).activity?.name === 'Study' && E.getMessageEvents(chat[chat.length - 1]).social?.[0]?.add === 2);
check('...once', F.getPendingFreeTime() === null);
r = F.pickActivity(F.freeTimeNow().activities.find(a => a.name === 'Go out').id);
chat.push({ is_user: true, mes: 'Actually I stay home and call my mother.' });
check('another message instead: nothing happens', F.onFreeTimeMessageSent() === null && Cal.getNow().slot === 'evening');
F.pickActivity(F.freeTimeNow().activities.find(a => a.name === 'Read a book').id);
F.cancelFreeTime();
check('cancel drops it', F.getPendingFreeTime() === null);

// Confidants
Co.startConfidant('Renji Hayama', 'Magician');
ft = F.freeTimeNow();
const renji = ft.people.find(p => p.name === 'Renji Hayama');
check('a Confidant without a schedule is around', !!renji && renji.points === 3 && !renji.match);
Pe.setWildCard(player, true, true);
Pe.addPersona(player, true, { name: 'Pixie', arcana: 'Magician', level: 2 });
check('with a Persona of the Arcana in the stock: the bonus', F.freeTimeNow().people.find(p => p.name === 'Renji Hayama').points === 6);
r = F.pickHangout('Renji Hayama');
chat.push({ is_user: true, mes: r.text });
done = F.onFreeTimeMessageSent();
check('time together gives the points', done?.kind === 'hangout' && done.points === 6 && Co.getBond('Renji Hayama').points === 6 && Cal.getNow().slot === 'night', JSON.stringify({ done, b: Co.getBond('Renji Hayama') }));

// Worn out after the Otherworld
Cal.markTired();
check('after a dungeon only rest', F.freeTimeNow().tired && F.freeTimeNow().activities.map(a => a.name).join() === 'Rest' && !F.freeTimeNow().people.length);
check('...and the AI is told', /WORN OUT/.test(F.buildFreeTimePromptForGeneration()));
Cal.advance('slot');
check('the next time of day is free again', !F.freeTimeNow().tired);
extensionSettings.freeTimeEnabled = false;
check('switched off: nothing', F.freeTimeNow() === null);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
