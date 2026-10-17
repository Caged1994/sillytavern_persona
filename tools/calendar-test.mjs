#!/usr/bin/env node
/**
 * Calendar test: dates and slots, parsing, events and the lorebook format,
 * the Info Box in charge (read, never back, written back), weather and
 * forecast, the AI key, swipe undo, the prompt.
 *
 * Usage:  node tools/calendar-test.mjs     (from the repo root)
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


const K = await import(`${DES}/src/utils/calendarModel.js`);
const Cal = await import(`${DES}/src/systems/features/calendar.js`);
const { lastGeneratedData } = await import(`${DES}/src/core/state.js`);

// ── 1. Dates ──
check('real days only', K.ymd(2016, 2, 29) === '2016-02-29' && K.ymd(2015, 2, 29) === null && K.ymd(2016, 13, 1) === null);
check('weekday', K.WEEKDAYS[K.weekday('2016-04-12')] === 'Tuesday');
check('days add and differ across months and years', K.addDays('2016-12-31', 1) === '2017-01-01' && K.dayDiff('2016-04-12', '2016-05-05') === 23);
const P_ = (t, o) => K.parseDate(t, o);
check('parse: long English form', P_('Tuesday, April 12, 2016') === '2016-04-12' && P_('April 12th, 2016') === '2016-04-12');
check('parse: ISO, US slashes, day-month, Italian', P_('2016-04-12') === '2016-04-12' && P_('4/12/2016') === '2016-04-12' && P_('12 April 2016') === '2016-04-12' && P_('martedì 12 aprile 2016') === '2016-04-12');
check('parse: no year takes the given one, or nothing', P_('April 12', { year: 2016 }) === '2016-04-12' && P_('April 12') === null);
check('no year but a weekday: the nearest year where it fits', P_('APRIL 1 — TUESDAY', { around: 2026 }) === '2025-04-01' && P_('Tuesday, April 1', { around: 2026 }) === '2025-04-01' && P_('martedì 1 aprile', { around: 2026 }) === '2025-04-01');
check('...a given year still wins over the weekday', P_('Tuesday, April 1', { year: 2026 }) === '2026-04-01');
check('a date header in the prose', K.findDateInText('Narrator\nAPRIL 1 — TUESDAY\nMORNING\nDays Until Station Deadline: -', { around: 2026 }) === '2025-04-01' && K.findSlotInText('APRIL 1 — TUESDAY\nMORNING\ntext') === 'morning');
check('...but not a passing month or a lone weekday', K.findDateInText('We met in May, on a Saturday.') === null && K.findDateInText('On April 9 the train left. It was Saturday.') === null && K.findSlotInText('a quiet morning walk') === null);
check('parse: nonsense is null', P_('Sunday, Late Autumn, Week 2') === null && P_('') === null);
check('slots from clock times', K.slotFromClock('8:30 AM') === 'morning' && K.slotFromClock('2:40 PM') === 'afternoon' && K.slotFromClock('19:00') === 'evening' && K.slotFromClock('11pm') === 'night' && K.slotFromClock('1:00 AM') === 'night' && K.slotFromClock('12:00 PM') === 'afternoon');
check('slots from words', K.normalizeSlot('After School') === 'afternoon' && K.normalizeSlot('Late Night') === 'night' && K.normalizeSlot('lunchtime') === 'afternoon' && K.normalizeSlot('Evening') === 'evening');
check('next slot, then next morning', JSON.stringify(K.nextSlot({ date: '2016-04-12', slot: 'evening' })) === '{"date":"2016-04-12","slot":"night"}' && JSON.stringify(K.nextSlot({ date: '2016-04-12', slot: 'night' })) === '{"date":"2016-04-13","slot":"morning"}');
check('formats', K.formatLong('2016-04-12') === 'Tuesday, April 12, 2016' && K.formatShort('2016-04-12') === '4/12 Tu');

// ── 2. Events ──
const ex = K.normalizeEvent({ date: 'May 5, 2016', title: "Kamoshida's Palace" , kind: 'deadline' });
check('an event with a date', ex.date === '2016-05-05' && ex.kind === 'deadline');
check('without a year it repeats every year', K.normalizeEvent({ date: 'April 29', title: 'Golden Week' }).date === '04-29' && K.normalizeEvent({ date: 'April 29', title: 'Golden Week' }).kind === 'holiday');
check('kinds are guessed', K.detectKind('Midterm exams') === 'exam' && K.detectKind('Palace deadline') === 'deadline' && K.detectKind('Dinner with Ann') === 'event');
const evs = [ex, K.normalizeEvent({ date: 'April 29', title: 'Golden Week' }), K.normalizeEvent({ date: '2016-04-01', title: 'Old', kind: 'deadline' })];
const up = K.upcoming(evs, '2016-04-12', 30);
check('upcoming: sorted with countdowns, yearly ones placed', up.map(e => `${e.title}:${e.days}`).join() === 'Golden Week:17,Kamoshida\'s Palace:23');
check('overdue deadlines', K.overdue(evs, '2016-04-12').map(e => e.title).join() === 'Old');
check('countdown words', K.countdown(0) === 'today' && K.countdown(1) === 'tomorrow' && K.countdown(5) === 'in 5 days');
const lb = K.parseCalendarEntry({ comment: 'Calendar: Shujin', content: 'April 29: Golden Week (holiday)\n- 2016-05-05: Kamoshida\'s Palace deadline\nJuly 13 evening — Fireworks festival\nnot an event line' });
check('lorebook entries: one event a line', lb.length === 3 && lb[0].date === '04-29' && lb[1].kind === 'deadline' && lb[2].slot === 'evening' && lb[2].title === 'Fireworks festival' && lb.every(e => e.source === 'lorebook'));
check('other entries are not calendars', K.parseCalendarEntry({ comment: 'Tokyo', content: 'April 1: x' }).length === 0);
const ai = K.normalizeAICalendar(JSON.stringify({ events: [{ date: 'May 2', title: 'Test with Makoto', kind: 'exam' }], forecast: [{ date: 'April 13', weather: '🌧️ Rain' }], done: ['Old'] }), { year: 2016 });
check('AI key: events, forecast and done, years filled in', ai.events[0].date === '2016-05-02' && ai.forecast[0].date === '2016-04-13' && ai.done[0] === 'Old');

// ── 3. In a chat ──
extensionSettings.calendarEnabled = true;
extensionSettings.trackerConfig = extensionSettings.trackerConfig || {};
extensionSettings.trackerConfig.infoBox = { widgets: { date: { enabled: true }, time: { enabled: true }, weather: { enabled: true } } };
extensionSettings.showInfoBox = true;
Cal.setBookEventsForTests(lb);
const box = (date, time, weather = '☀️ Sunny') => JSON.stringify({ date: { value: date }, time: { start: time, end: '' }, weather: { emoji: weather.split(' ')[0], forecast: weather.split(' ').slice(1).join(' ') }, location: { value: 'Shibuya' } });
chat.push({ is_user: true, mes: 'go' }, { is_user: false, mes: 'reply' });
chat.push({ is_user: false, mes: 'Narrator\nAPRIL 1 — TUESDAY\nMORNING\nYou have a full morning before class.' });
Cal.applyAICalendar(null, null, chat.length - 1);
const fromProse = Cal.getNow();
check('no Info Box date: the story\'s own date header starts the calendar, weekday-true', fromProse?.slot === 'morning' && fromProse.date.slice(5) === '04-01' && K.WEEKDAYS[K.weekday(fromProse.date)] === 'Tuesday', JSON.stringify(fromProse));
Cal.revertAICalendarForReplacedMessage(chat.length - 1);
chat.pop();
chat.push({ is_user: false, mes: 'Narrator\nAPRIL 1 — TUESDAY\nEVENING\nText.' }, { is_user: true, mes: 'ok' }, { is_user: false, mes: 'nothing dated here' });
const read = Cal.readDateFromChat();
check('an ongoing chat: the date is read back from its messages', read.now?.slot === 'evening' && K.WEEKDAYS[K.weekday(read.now.date)] === 'Tuesday');
chat.splice(chat.length - 3, 3);
// back to no date for the checks below
{ const st = (await import(`${SANDBOX}/script.js`)).chat_metadata.dooms_tracker?.betterStats?.calendar; if (st) st.now = null; }
check('no date yet', Cal.getNow() === null && /no date yet/.test(Cal.buildCalendarPromptForGeneration()));
Cal.applyAICalendar(null, box('Tuesday, April 12, 2016', '8:10 AM'), chat.length - 1);
check('the first Info Box date sets the calendar', JSON.stringify(Cal.getNow()) === '{"date":"2016-04-12","slot":"morning"}');
check('...with the day\'s weather', Cal.getDay('2016-04-12')?.weather === '☀️ Sunny');
chat.push({ is_user: true, mes: 'later' }, { is_user: false, mes: 'reply' });
Cal.applyAICalendar(null, box('Tuesday, April 12, 2016', '4:30 PM'), chat.length - 1);
check('a later time moves the slot', Cal.getNow().slot === 'afternoon');
chat.push({ is_user: true, mes: 'x' }, { is_user: false, mes: 'reply' });
lastGeneratedData.infoBox = box('Monday, April 11, 2016', '9:00 AM');
Cal.applyAICalendar(null, lastGeneratedData.infoBox, chat.length - 1);
check('going back is refused', JSON.stringify(Cal.getNow()) === '{"date":"2016-04-12","slot":"afternoon"}');
const shown = JSON.parse(lastGeneratedData.infoBox);
check('...and the Info Box gets the calendar\'s date and a time in its slot', shown.date.value === 'Tuesday, April 12, 2016' && K.slotFromClock(shown.time.start) === 'afternoon' && shown.location.value === 'Shibuya');
chat.push({ is_user: true, mes: 'sleep' }, { is_user: false, mes: 'reply' });
Cal.applyAICalendar(JSON.stringify({ forecast: [{ date: 'April 14', weather: '🌧️ Rain' }], events: [{ date: 'April 20', title: 'Study with Makoto' }] }), box('Wednesday, April 13, 2016', '7:30 AM', '☁️ Cloudy'), chat.length - 1);
check('a new day', JSON.stringify(Cal.getNow()) === '{"date":"2016-04-13","slot":"morning"}');
check('forecast kept for later days', Cal.getDay('2016-04-14')?.weather === '🌧️ Rain' && Cal.getDay('2016-04-14')?.forecast);
check('the story adds events', Cal.getEvents().some(e => e.title === 'Study with Makoto' && e.date === '2016-04-20' && e.source === 'ai'));
const { revertAICalendarForReplacedMessage } = Cal;
revertAICalendarForReplacedMessage(chat.length - 1); // a swipe of the last reply
check('a swipe undoes the reply: back to the afternoon, no event, no forecast', JSON.stringify(Cal.getNow()) === '{"date":"2016-04-12","slot":"afternoon"}' && !Cal.getEvents().some(e => e.title === 'Study with Makoto') && !Cal.getDay('2016-04-14'));
// By hand
check('advance a slot by hand', Cal.advance('slot').now.slot === 'evening');
check('next day by hand', JSON.stringify(Cal.advance('day').now) === '{"date":"2016-04-13","slot":"morning"}');
check('set by hand may go back', Cal.setNow('2016-04-10', 'night').now.date === '2016-04-10');
Cal.setNow('2016-04-25', 'afternoon');
check('the Info Box follows a hand change', JSON.parse(lastGeneratedData.infoBox).date.value === 'Monday, April 25, 2016');
const added = Cal.addEvent({ date: '2016-05-02', title: 'Midterms' });
check('events by hand', added.event?.kind === 'exam' && Cal.getUpcoming(30).some(e => e.title === 'Midterms'));
check('lorebook events are in the list', Cal.getUpcoming(30).map(e => e.title).join() === 'Golden Week,Midterms,Kamoshida\'s Palace deadline', Cal.getUpcoming(30).map(e => e.title).join());
Cal.setEventDone(Cal.getEvents().find(e => e.title === 'Golden Week').id, true);
check('a lorebook event can be marked done', Cal.getEvents().find(e => e.title === 'Golden Week' && e.source === 'lorebook')?.done === true && !Cal.getUpcoming(30).some(e => e.title === 'Golden Week'));
chat.push({ is_user: true, mes: 'x' }, { is_user: false, mes: 'reply' });
Cal.applyAICalendar(JSON.stringify({ done: ['Midterms'] }), null, chat.length - 1);
check('the story marks events done', Cal.getEvents().find(e => e.title === 'Midterms').done === true);
Cal.removeEvent(added.event.id);
check('and they can be deleted', !Cal.getEvents().some(e => e.title === 'Midterms'));
lastGeneratedData.infoBox = box('Friday, April 29, 2016', '8:00 PM');
Cal.followInfoBoxEdit(lastGeneratedData.infoBox);
check('typing a date in the Info Box moves the calendar', JSON.stringify(Cal.getNow()) === '{"date":"2016-04-29","slot":"evening"}');
const view = Cal.getMonthView(2016, 4);
check('a month view', view.days.length === 30 && view.days[0].weekday === 5 && view.days.find(d => d.today)?.date === '2016-04-29' && view.days[28].events.some(e => e.title === 'Golden Week'));
Cal.setNow('2016-05-07', 'morning');
const prompt = Cal.buildCalendarPromptForGeneration();
check('the prompt: today, slot, missed deadline, forecast request', /Saturday, May 7, 2016, morning/.test(prompt) && /Missed deadline: "Kamoshida's Palace deadline"/.test(prompt) && /forecast/.test(prompt), prompt);
extensionSettings.trackerConfig.infoBox.widgets.date.enabled = false;
check('without the Info Box date the AI uses the key', /"calendar": \{"date"/.test(Cal.buildCalendarPromptForGeneration()));
chat.push({ is_user: true, mes: 'x' }, { is_user: false, mes: 'reply' });
Cal.applyAICalendar(JSON.stringify({ date: 'May 8, 2016', slot: 'evening' }), null, chat.length - 1);
check('...and it moves time', JSON.stringify(Cal.getNow()) === '{"date":"2016-05-08","slot":"evening"}');
check('the summary line', /^Date: Sunday, May 8, 2016, evening/.test(Cal.buildCalendarContextSummary()));

// ── 4. Without the Info Box the calendar carries the scene ──
extensionSettings.showInfoBox = false;
extensionSettings.trackerConfig.infoBox.widgets.date.enabled = true;
check('Info Box off: the calendar asks for weather and place too', /"weather": "🌧️ Rain", "location": "Place"/.test(Cal.buildCalendarPromptForGeneration()));
chat.push({ is_user: true, mes: 'x' }, { is_user: false, mes: 'reply' });
Cal.applyAICalendar(JSON.stringify({ slot: 'night', weather: '🌧️ Heavy rain', location: 'Leblanc attic' }), box('Monday, January 1, 2018', '9:00 AM', '☀️ Sunny'), chat.length - 1);
check('...takes them from the key and ignores a stale Info Box', JSON.stringify(Cal.getNow()) === '{"date":"2016-05-08","slot":"night"}' && Cal.getDay('2016-05-08').weather === '🌧️ Heavy rain' && Cal.getPlace() === 'Leblanc attic');
const scene = JSON.parse(Cal.sceneAsInfoBox());
check('...and gives the scene as Info Box data (for weather effects and scene headers)', scene.date.value === 'Sunday, May 8, 2016' && K.slotFromClock(scene.time.start) === 'night' && scene.weather.emoji === '🌧️' && scene.weather.forecast === 'Heavy rain' && scene.location.value === 'Leblanc attic');
check('...and the context line has them', /at Leblanc attic, weather 🌧️ Heavy rain/.test(Cal.buildCalendarContextSummary()));
check('...and the prompt says where and how it is now', /Now: at Leblanc attic, weather 🌧️ Heavy rain/.test(Cal.buildCalendarPromptForGeneration()));
Cal.revertAICalendarForReplacedMessage(chat.length - 1);
check('a swipe undoes weather and place too', Cal.getPlace() !== 'Leblanc attic' && Cal.getNow().slot === 'evening');
Cal.setPlace('Shibuya');
check('the place by hand', Cal.getPlace() === 'Shibuya');
// All three trackers off (the calendar carries the scene): together mode still opens with the block and shows the last one.
const keepTrackers = [extensionSettings.showCharacterThoughts, extensionSettings.showQuests];
extensionSettings.showCharacterThoughts = false; extensionSettings.showQuests = false;
const soloInstr = pb.generateTrackerInstructions(false, true);
check('trackers off: the instructions open with the JSON block', /^\s*Start every reply with ONE ```json code block/.test(soloInstr), soloInstr.slice(0, 200));
const soloEx = pb.generateTrackerExample();
check('...and the last block is shown, calendar included', /"calendar": \{"date":"May 8, 2016","slot":"evening"\}/.test(soloEx), soloEx);
[extensionSettings.showCharacterThoughts, extensionSettings.showQuests] = keepTrackers;
extensionSettings.showInfoBox = true;
lastGeneratedData.infoBox = box('Sunday, May 8, 2016', '7:30 PM', '☁️ Cloudy');
chat.push({ is_user: true, mes: 'x' }, { is_user: false, mes: 'reply' });
Cal.applyAICalendar(null, lastGeneratedData.infoBox, chat.length - 1);
check('with the Info Box on, the place comes from it', Cal.getPlace() === 'Shibuya' && Cal.getDay('2016-05-08').weather === '☁️ Cloudy');
extensionSettings.calendarEnabled = false;
check('switched off: nothing', Cal.buildCalendarPromptForGeneration() === '' && Cal.applyAICalendar('{"date":"May 9, 2016"}', null, 99) === false);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
