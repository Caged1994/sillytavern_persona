#!/usr/bin/env node
/**
 * Persona combat rules test: the skill database, affinities (Weak, Resist,
 * Null, Drain, Repel), knock-downs and 1 More, Baton Pass, All-Out Attack,
 * HP/SP costs, Charge, -kaja/-kunda, walls/breaks, mirrors, instakills,
 * ailments and technicals.
 *
 * Usage:  node tools/persona-combat-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import * as C from '../src/utils/combatModel.js';
import * as K from '../src/utils/skillModel.js';

let passed = 0, failed = 0;
function ok(cond, label) {
    if (cond) passed++;
    else { failed++; console.log('FAIL: ' + label); }
}

// Deterministic: everything hits, no random crits, no damage spread.
Object.assign(C.TUNING, { hitMin: 1, hitMax: 1, critChance: 0, critPerLu: 0, varMin: 1, varMax: 1 });
const ATTRS = { st: 20, ma: 20, en: 20, ag: 20, lu: 20 };

function skillAction(name, id = name) {
    const rec = K.findSkill(name);
    const cost = K.skillCost(rec, 10);
    return { id, label: name, icon: '✨', kind: 'spell', profile: K.profileFromSkill(rec), manaCost: cost.sp, hpCost: cost.hp, cooldown: 0 };
}
function fighter(id, side, { skills = [], affinities = {}, level = 10, ...over } = {}) {
    return C.makeCombatant({ id, name: id, side, level, attrs: { ...ATTRS }, mana: side === 'party' ? 100 : null, affinities, actions: skills.map(n => skillAction(n)), ...over });
}
/** A fight where the party acts first (order is fixed by hand). */
function fight(list, order = list.map(c => c.id)) {
    const s = C.createCombat({ combatants: list, seed: 42 });
    s.phase = 'active'; s.round = 1; s.turn = 0; s.order = order;
    return s;
}
const dmgEvents = (evs, id) => evs.filter(e => e.type === 'damage' && e.target === id);

// ─── Skill database ─────────────────────────────────────────────────────────
{
    const agi = K.findSkill('agi');
    ok(agi && agi.e === 'fire' && agi.c === 4 && agi.k === 'sp', 'Agi: Fire, 4 SP');
    ok(K.findSkill('Cleave').k === 'hp' && K.findSkill('Cleave').c === 6, 'Cleave costs 6% HP');
    ok(K.findSkill('Dia').fx.k === 'heal' && K.findSkill('Media').t === 'allies', 'Dia heals, Media heals everyone');
    ok(K.findSkill('Garudyne') && K.findSkill('Megidolaon').e === 'almighty', 'P4/P5 skills present, Almighty');
    ok(K.findSkill('Resist Fire') && K.passiveAffinity(K.findSkill('Resist Fire')).val === 'rs', 'Resist Fire is a passive affinity');
    ok(K.skillCount() > 1000, `over 1000 skills (${K.skillCount()})`);
    const p = K.profileFromSkill(agi);
    ok(p.type === 'skill' && p.element === 'fire' && p.stat === 'ma' && p.ail?.name === 'Burn', 'Agi profile: fire, Ma, may Burn');
    ok(K.profileFromSkill(K.findSkill('Lunge')).stat === 'st', 'Phys skills scale with St');
    ok(K.skillCost(agi, 1).sp > K.skillCost(agi, 50).sp, 'an SP cost weighs less as the SP pool grows');
    ok(C.skillPowerMult(160) > C.skillPowerMult(40), 'Agidyne hits harder than Agi');
}

// ─── Weakness → knock-down → 1 More ─────────────────────────────────────────
{
    const hero = fighter('hero', 'party', { skills: ['Agi'] });
    const foe = fighter('foe', 'enemy', { affinities: { fire: 'wk' } });
    const plain = fighter('plain', 'enemy');
    const s = fight([hero, foe, plain]);
    const baseline = C.damageAgainst(hero, hero.actions[1], plain);
    let ev = C.performAction(s, 'hero', 'Agi', 'foe');
    const d = dmgEvents(ev, 'foe')[0];
    ok(d && d.amount === Math.round(baseline * C.TUNING.weakMult) || Math.abs(d.amount - baseline * 1.25) <= 1, 'Weak: ×1.25 damage');
    ok(foe.knocked && ev.some(e => e.type === 'knock'), 'Weak: the target is knocked down');
    ok(foe.known.fire === true, 'the weakness is now known');
    ev = C.advance(s);
    ok(ev.some(e => e.type === 'onemore') && C.currentActor(s).id === 'hero' && C.inOneMore(s), '1 More: the hero acts again');
    C.performAction(s, 'hero', 'Agi', 'foe');
    ok(!s.pendingMore, 'hitting a target that is already down gives no new 1 More');
    C.advance(s);
    ok(C.currentActor(s).id === 'foe' && !C.inOneMore(s), 'then the turn passes on');
    C.performAction(s, 'foe', 'basic', 'hero');
    ok(!foe.knocked, 'a knocked fighter gets back up at the start of their turn and acts');
}

// ─── Resist, Null, Drain, Repel, Almighty ───────────────────────────────────
{
    const hero = fighter('hero', 'party', { skills: ['Agi', 'Megidola'] });
    const rs = fighter('rs', 'enemy', { affinities: { fire: 'rs' } });
    const nu = fighter('nu', 'enemy', { affinities: { fire: 'nu' } });
    const dr = fighter('dr', 'enemy', { affinities: { fire: 'dr' } });
    const rp = fighter('rp', 'enemy', { affinities: { fire: 'rp' } });
    const plain = fighter('plain', 'enemy');
    const s = fight([hero, rs, nu, dr, rp, plain]);
    const full = C.damageAgainst(hero, hero.actions[1], plain);
    let ev = C.performAction(s, 'hero', 'Agi', 'rs');
    ok(Math.abs(dmgEvents(ev, 'rs')[0].amount - full * 0.5) <= 1 && !rs.knocked, 'Resist: half damage, no knock-down');
    ev = C.performAction(s, 'hero', 'Agi', 'nu');
    ok(!dmgEvents(ev, 'nu').length && ev.some(e => e.type === 'block') && nu.hp === nu.maxHp, 'Null: no damage');
    dr.hp = dr.maxHp - 30;
    ev = C.performAction(s, 'hero', 'Agi', 'dr');
    ok(dr.hp > dr.maxHp - 30 && !dmgEvents(ev, 'dr').length, 'Drain: the target heals');
    const before = hero.hp;
    ev = C.performAction(s, 'hero', 'Agi', 'rp');
    ok(hero.hp < before && rp.hp === rp.maxHp && ev.some(e => e.type === 'reflect'), 'Repel: the attacker takes it');
    ok(!s.pendingMore, 'no 1 More from Resist / Null / Drain / Repel');
    ev = C.performAction(s, 'hero', 'Megidola', null);
    ok(dmgEvents(ev, 'nu').length && dmgEvents(ev, 'rp').length, 'Almighty ignores affinities');
}

// ─── All-Out Attack and Baton Pass ──────────────────────────────────────────
{
    const a = fighter('a', 'party', { skills: ['Agi'] });
    const b = fighter('b', 'party', { skills: ['Bufu'] });
    const e1 = fighter('e1', 'enemy', { affinities: { fire: 'wk' } });
    const e2 = fighter('e2', 'enemy', { affinities: { ice: 'wk' } });
    const s = fight([a, b, e1, e2]);
    C.performAction(s, 'a', 'Agi', 'e1');
    C.advance(s);
    ok(C.inOneMore(s) && !C.canAllOut(s), 'one enemy down: no All-Out yet');
    ok(C.batonTargets(s).join() === 'b', 'Baton Pass: to the ally');
    C.batonPass(s, 'b');
    ok(C.currentActor(s).id === 'b' && b.baton === 1, 'Baton Pass hands the turn over with a bonus');
    const plain = fighter('p', 'enemy');
    const normal = C.damageAgainst(fighter('b2', 'party', { skills: ['Bufu'] }), b.actions[1], plain);
    ok(C.damageAgainst(b, b.actions[1], plain) > normal * 1.4, 'Baton bonus: about +50% damage');
    ok(!C.batonTargets(s).includes('a'), 'cannot pass back to whoever already had it');
    C.performAction(s, 'b', 'Bufu', 'e2');
    C.advance(s);
    ok(C.inOneMore(s) && C.currentActor(s).id === 'b' && C.canAllOut(s), 'everyone down: All-Out Attack available');
    const hp1 = e1.hp, hp2 = e2.hp;
    const ev = C.allOutAttack(s);
    ok(ev.some(e => e.type === 'allout') && e1.hp < hp1 && e2.hp < hp2 && !e1.knocked && !e2.knocked, 'All-Out hits everyone and they get up');
    C.advance(s);
    ok(!C.inOneMore(s) && C.currentActor(s).id === 'b' && !a.baton && !b.baton, 'after the All-Out the turn ends (next in order); bonuses reset');
}

// ─── Enemies: weaknesses yes, crits no ──────────────────────────────────────
{
    const hero = fighter('hero', 'party', { affinities: { elec: 'wk' } });
    const foe = fighter('foe', 'enemy', { skills: ['Zio', 'Lunge'] });
    const s = fight([foe, hero]);
    C.performAction(s, 'foe', 'Zio', 'hero');
    ok(hero.knocked && s.pendingMore === 'foe', 'an enemy hitting a party weakness knocks down and gets 1 More');
    const s2 = fight([foe, fighter('h2', 'party')]);
    const keep = { ...C.TUNING };
    Object.assign(C.TUNING, { critChance: 1, critMax: 1, skillCritCap: 1 });
    C.performAction(s2, 'foe', 'Lunge', 'h2');
    ok(!s2.combatants[1].knocked && !s2.pendingMore, 'an enemy critical does not knock the party down');
    const s3 = fight([fighter('h3', 'party', { skills: ['Lunge'] }), fighter('f3', 'enemy')]);
    C.performAction(s3, 'h3', 'Lunge', 'f3');
    ok(s3.combatants[1].knocked && s3.pendingMore === 'h3', 'a party critical knocks the enemy down');
    Object.assign(C.TUNING, keep);
    const guarded = fighter('g', 'party', { affinities: { elec: 'wk' } });
    guarded.guard = true;
    C.performAction(fight([foe, guarded]), 'foe', 'Zio', 'g');
    ok(!guarded.knocked, 'guarding covers a weakness');
}

// ─── Costs ──────────────────────────────────────────────────────────────────
{
    const hero = fighter('hero', 'party', { skills: ['Cleave', 'Agi'] });
    const s = fight([hero, fighter('foe', 'enemy')]);
    const hp = hero.hp;
    C.performAction(s, 'hero', 'Cleave', 'foe');
    ok(hero.hp === hp - Math.ceil(hero.maxHp * 0.06), 'Cleave takes 6% of max HP');
    hero.hp = 3;
    ok(!C.canUse(hero, hero.actions.find(a => a.id === 'Cleave')).ok, 'not enough HP for a Phys skill');
    const sp = hero.mana;
    C.performAction(s, 'hero', 'Agi', 'foe');
    ok(hero.mana === sp - hero.actions.find(a => a.id === 'Agi').manaCost && hero.mana < 100, 'Agi takes SP');
}

// ─── Support: Charge, -kaja / -kunda, walls, breaks, mirrors ────────────────
{
    const hero = fighter('hero', 'party', { skills: ['Charge', 'Lunge', 'Tarukaja', 'Rakunda', 'Fire Wall', 'Fire Break', 'Tetrakarn'] });
    const foe = fighter('foe', 'enemy', { affinities: { fire: 'rs' }, skills: ['Agi', 'Bash'] });
    const plain = fighter('plain', 'enemy');
    const s = fight([hero, foe, plain]);
    const normal = C.damageAgainst(hero, hero.actions.find(a => a.id === 'Lunge'), plain);
    C.performAction(s, 'hero', 'Charge', null);
    ok(C.hasStatus(hero, 'charged'), 'Charge readies the next Phys hit');
    const ev = C.performAction(s, 'hero', 'Lunge', 'plain');
    ok(dmgEvents(ev, 'plain')[0].amount >= Math.floor(normal * 2.4) && !C.hasStatus(hero, 'charged'), 'Charge: ×2.5 and it is spent');
    C.performAction(s, 'hero', 'Tarukaja', 'hero');
    ok(C.hasStatus(hero, 'empower'), 'Tarukaja raises attack');
    C.performAction(s, 'hero', 'Rakunda', 'foe');
    ok(C.hasStatus(foe, 'vulnerable'), 'Rakunda lowers defence');
    C.performAction(s, 'hero', 'Fire Break', null);
    ok(C.affinityOf(foe, 'fire') === '', 'Fire Break removes a fire resistance');
    C.performAction(s, 'hero', 'Fire Wall', 'hero');
    ok(C.affinityOf(hero, 'fire') === 'rs', 'Fire Wall gives fire resistance');
    hero.mana = 100;
    C.performAction(s, 'hero', 'Tetrakarn', 'hero');
    const hpFoe = foe.hp;
    const ev2 = C.performAction(s, 'foe', 'Bash', 'hero');
    ok(foe.hp < hpFoe && ev2.some(e => e.type === 'reflect') && !C.hasStatus(hero, 'tetrakarn'), 'Tetrakarn sends one Phys attack back');
}

// ─── Ailments, technicals, instakill ────────────────────────────────────────
{
    const hero = fighter('hero', 'party', { skills: ['Dormina', 'Lunge', 'Hama', 'Makajam'] });
    const foe = fighter('foe', 'enemy');
    const boss = fighter('boss', 'enemy', { tier: 'boss' });
    const s = fight([hero, foe, boss]);
    const keep = { ...C.TUNING };
    C.TUNING.bossAilmentMult = 0;
    // Force the ailment roll: Dormina is 70%, luck even.
    let tries = 0;
    while (!C.hasStatus(foe, 'sleep') && tries++ < 20) C.performAction(s, 'hero', 'Dormina', 'foe');
    ok(C.hasStatus(foe, 'sleep'), 'Dormina puts to sleep');
    s.pendingMore = null;
    C.performAction(s, 'hero', 'Lunge', 'foe');
    ok(foe.knocked && s.pendingMore === 'hero' && !C.hasStatus(foe, 'sleep'), 'hitting a sleeper with Phys: technical, knock-down, wakes them');
    tries = 0;
    while (!C.hasStatus(foe, 'forget') && tries++ < 30) C.performAction(s, 'hero', 'Makajam', 'foe');
    foe.actions.push(skillAction('Agi'));
    ok(!C.canUse(foe, foe.actions.find(a => a.id === 'Agi')).ok && C.canUse(foe, foe.actions[0]).ok, 'Forget seals skills, not the plain attack');
    const ev = C.performAction(s, 'hero', 'Hama', 'boss');
    ok(boss.hp === boss.maxHp && ev.some(e => e.type === 'block'), 'a boss is immune to instakills');
    Object.assign(C.TUNING, keep);
    const sleeper = fighter('z', 'party');
    sleeper.statuses.push({ id: 'sleep', turns: 2 });
    const s2 = fight([sleeper, fighter('y', 'enemy')]);
    s2.turn = 1;
    C.advance(s2);
    ok(s2.log.some(e => e.type === 'skip' && /asleep/.test(e.text)), 'an asleep fighter loses the turn');
}

// ─── Enemy AI goes for weaknesses ───────────────────────────────────────────
{
    const foe = fighter('foe', 'enemy', { skills: ['Agi', 'Bufu'] });
    const weak = fighter('w', 'party', { affinities: { ice: 'wk' } });
    const other = fighter('o', 'party', { affinities: { ice: 'nu' } });
    const s = fight([foe, weak, other]);
    let iceOnWeak = 0;
    for (let i = 0; i < 40; i++) {
        s.rng = i * 977 + 1;
        const { actionId, targetId } = C.chooseEnemyAction(s, foe);
        if (actionId === 'Bufu' && targetId === 'w') iceOnWeak++;
    }
    ok(iceOnWeak > 20, `enemies aim for weaknesses (${iceOnWeak}/40)`);
}

console.log(`persona combat: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
