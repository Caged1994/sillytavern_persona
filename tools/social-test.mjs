#!/usr/bin/env node
/**
 * Social stats (Persona 5) — pure model test.
 *
 * Usage:  node tools/social-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import * as S from '../src/utils/socialModel.js';

let pass = 0, fail = 0;
function ok(cond, label) {
    if (cond) pass++;
    else { fail++; console.log('FAIL: ' + label); }
}

ok(S.SOCIAL_STATS.map(s => s.name).join(',') === 'Knowledge,Guts,Proficiency,Kindness,Charm', 'the five Persona 5 social stats, in order');
ok(S.SOCIAL_STATS.every(s => s.ranks.length === 5 && s.thresholds.length === 5 && s.thresholds[0] === 0), 'five ranks each, starting at 0 points');
ok(S.SOCIAL_STATS.every(s => s.thresholds.every((t, i) => !i || t > s.thresholds[i - 1])), 'thresholds go up');

let r = S.rankInfo('knowledge', 0);
ok(r.rank === 1 && r.title === 'Oblivious' && r.next === 34 && r.pct === 0, 'Knowledge starts Oblivious, next rank at 34');
r = S.rankInfo('knowledge', 34);
ok(r.rank === 2 && r.title === 'Learned', '34 Knowledge is Learned');
r = S.rankInfo('guts', 113);
ok(r.rank === 5 && r.title === 'Lionhearted' && r.next === null && r.pct === 100, '113 Guts is Lionhearted, the top');
r = S.rankInfo('charm', 29);
ok(r.rank === 2 && r.title === 'Head-Turning' && r.pct === 50, 'progress toward the next rank (Charm 29 → halfway to Suave)');
ok(S.rankInfo('kindness', 47).title === 'Empathetic' && S.rankInfo('kindness', 46).title === 'Considerate', 'Kindness thresholds');
ok(S.rankInfo('proficiency', 87).title === 'Transcendent', 'Proficiency top rank');
ok(S.pointsForRank('knowledge', 4) === 126, 'points for a rank');

ok(JSON.stringify(S.normalizeSocial({ guts: '12', charm: -5, bogus: 3 })) === JSON.stringify({ knowledge: 0, guts: 12, proficiency: 0, kindness: 0, charm: 0 }), 'stored points are cleaned up');

let g = S.normalizeAISocial({ Knowledge: 2, guts: '+3', Charm: { add: 9, reason: 'new haircut' }, Kindness: -4, Luck: 2 });
ok(g.length === 3, `only real gains are taken (got ${JSON.stringify(g)})`);
ok(g.find(x => x.id === 'charm')?.add === S.MAX_SOCIAL_STEP && g.find(x => x.id === 'charm')?.reason === 'new haircut', 'a gain is capped and keeps its reason');
ok(!g.some(x => x.id === 'kindness'), 'social stats never go down');
g = S.normalizeAISocial('[{"stat":"Proficiency","add":2}]');
ok(g.length === 1 && g[0].id === 'proficiency' && g[0].add === 2, 'array form, as a string');
ok(S.normalizeAISocial('nonsense').length === 0, 'garbage gives nothing');

const prompt = S.buildSocialPrompt({ player: 'Joker', points: { knowledge: 40, charm: 6 } });
ok(prompt.includes('Knowledge 2 (Learned)') && prompt.includes('Charm 2 (Head-Turning)') && prompt.includes('Guts 1 (Milquetoast)'), 'prompt lists ranks and titles');
ok(prompt.includes('"social"') && prompt.includes('never go down'), 'prompt explains the "social" key');
ok(S.buildSocialPrompt({ player: '' }) === '', 'no player, no prompt');

console.log(`social model: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
