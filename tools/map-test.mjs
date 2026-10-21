#!/usr/bin/env node
/**
 * Map model test (src/utils/placeModel.js): Place: entries, aliases and
 * matching, open hours, links and the automatic layout, decoration, the line
 * in the chat box and the prompt.
 *
 * Usage:  node tools/map-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import * as M from '../src/utils/placeModel.js';

let failures = 0;
const check = (label, cond, extra = '') => { if (!cond) { failures++; console.log(`  FAIL: ${label} ${extra}`); } else console.log(`  ok: ${label}`); };

const e = (comment, content) => ({ comment, content });
const book = [
    e('Place: Fog & Bean cafe', 'Place: Fog & Bean cafe\nShort: Fog & Bean\nIcon: ☕\nPosition: 64, 48\nConnects: Moon Bridge Shopping Street, Riverside Plaza\nWhen: afternoon, evening\nHours: 10am - 9pm\nAlias: Fog & Bean, the cafe\nText: {user} walks over to {place}.'),
    e('Place: Moon Bridge Shopping Street', 'Place: Moon Bridge Shopping Street\nShort: Moon Bridge\nAlias: Moon Bridge market\nConnects: Fog & Bean cafe, Station'),
    e('Place: Riverside Plaza', 'Place: Riverside Plaza\nConnects: Fog & Bean cafe\nWhen: weekdays afternoon'),
    e('Place: Station', 'Place: Station\nConnects: Moon Bridge'),
    e('Place: Lantern Alley', 'Place: Lantern Alley\nDungeon: The Empty Stage, The Undercroft\nConnects: Moon Bridge'),
    e('Place: Fog & Bean cafe', 'Place: Fog & Bean cafe\nShort: Duplicate'),
    { comment: 'Place: Off', content: 'Place: Off', disable: true },
    e('Lore', 'Nothing here'),
];
const places = M.parsePlaceBook(book);
check('5 places (duplicate and disabled dropped)', places.length === 5, String(places.length));
const fb = places.find(p => p.name === 'Fog & Bean cafe');
check('fields', fb.short === 'Fog & Bean' && fb.icon === '☕' && fb.pos[0] === 64 && fb.pos[1] === 48 && fb.hours === '10am - 9pm', JSON.stringify(fb));
check('when parsed', JSON.stringify(fb.when.slots) === '["afternoon","evening"]' && fb.when.days === null);
check('aliases and sites', fb.aliases.length === 2 && places.find(p => p.name === 'Lantern Alley').sites.length === 2);

// matching
check('match by name', M.matchPlace(places, 'Fog & Bean cafe')?.name === 'Fog & Bean cafe');
check('match by alias inside a phrase', M.matchPlace(places, 'at the Moon Bridge market stalls')?.name === 'Moon Bridge Shopping Street');
check('longest match wins', M.matchPlace(places, 'Moon Bridge Shopping Street')?.id === 'pl:moon-bridge-shopping-street');
check('no match', M.matchPlace(places, 'The moon') === null && M.matchPlace(places, '') === null);

// open hours
const rp = places.find(p => p.name === 'Riverside Plaza');
check('open: always', M.isOpen(places.find(p => p.name === 'Station'), 3, 'night'));
check('open: afternoon Monday', M.isOpen(rp, 1, 'afternoon'));
check('closed: Sunday', !M.isOpen(rp, 0, 'afternoon'));
check('closed: morning', !M.isOpen(fb, 3, 'morning'));
check('hours text', M.hoursText(fb) === '10am - 9pm' && M.hoursText(rp) === 'weekdays · afternoon' && M.hoursText(places[3]) === 'always open', M.hoursText(rp));

// links and layout
const edges = M.edgesOf(places);
check('links are unique pairs', edges.length === 4, JSON.stringify(edges));
check('neighbors', M.neighborsOf(places, fb.id).map(p => p.name).sort().join('|') === 'Moon Bridge Shopping Street|Riverside Plaza');
const pos = M.layoutPlaces(places);
check('fixed position kept', pos[fb.id][0] === 64 && pos[fb.id][1] === 48);
check('every place laid out inside the map', places.every(p => pos[p.id] && pos[p.id][0] >= 3 && pos[p.id][0] <= 97 && pos[p.id][1] >= 5 && pos[p.id][1] <= 95));
const pos2 = M.layoutPlaces(places);
check('layout is stable', JSON.stringify(pos) === JSON.stringify(pos2));
const free = places.filter(p => !p.pos);
let minD = 1e9;
for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) minD = Math.min(minD, Math.hypot(pos[free[i].id][0] - pos[free[j].id][0], pos[free[i].id][1] - pos[free[j].id][1]));
check('free places do not sit on each other', minD > 8, String(minD));

// decoration
const decor = M.parseMapDecor([e('Map: Hazamachi', 'Map: Hazamachi\nWater: river 0,64 30,60 62,68 100,58\nWater: lake 66,100 74,80 88,71 100,69 | Kasumi Reservoir @ 86,95\nWater: pond 1,1')]);
check('decoration: river and lake', decor.water.length === 2 && decor.water[0].kind === 'river' && decor.water[1].kind === 'lake');
check('decoration: label', decor.water[1].label === 'Kasumi Reservoir' && decor.water[1].labelAt[0] === 86);

// chat-box line and prompt
check('travel line with template', M.travelText(fb, 'Hayate') === '*Hayate walks over to Fog & Bean cafe.*');
check('travel line default', M.travelText(rp, 'Hayate') === '*Hayate goes to Riverside Plaza.*');
const open = places.filter(p => M.isOpen(p, 1, 'morning')).map(p => p.id);
const pr = M.mapPrompt(places, fb, { user: 'Hayate', openNow: open });
check('prompt: here, nearby, closed', /Hayate is at Fog & Bean cafe/.test(pr) && /Moon Bridge, Riverside/.test(pr) && /Closed now: Fog & Bean, Riverside/.test(pr) && /no time/.test(pr), pr);
check('prompt: empty without places', M.mapPrompt([], null) === '');

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll map checks passed.');
