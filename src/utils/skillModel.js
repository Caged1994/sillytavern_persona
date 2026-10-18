/**
 * Persona skills — pure model over the generated skill database
 * (src/data/personaSkills.js, built by tools/build-skills.py).
 *
 * Turns a skill into a combat profile of type 'skill' (see combatModel.js):
 *   { type: 'skill', fx, element, target, pw?, hits?, acc?, crit?, ail?, revive?, stat }
 * and works out its price: SP skills cost a share of the SP bar (the bar is
 * a percentage, the game's costs are points, so the cost is weighed against
 * the SP a character of that level would have), Phys skills a share of HP.
 */
import { PERSONA_SKILLS } from '../data/personaSkills.js';

export const DAMAGE_ELEMENTS = ['phys', 'gun', 'fire', 'ice', 'elec', 'wind', 'psy', 'nuke', 'bless', 'curse', 'almighty'];
export const PHYSICAL_ELEMENTS = new Set(['phys', 'gun']);
export const ELEMENT_ICONS = {
    phys: '⚔️', gun: '🔫', fire: '🔥', ice: '❄️', elec: '⚡', wind: '🌪️', psy: '🌀', nuke: '☢️',
    bless: '✨', curse: '💀', almighty: '💥', ailment: '😵', heal: '💚', support: '🔼', passive: '🔒', special: '⭐',
};
export const ELEMENT_NAMES = {
    phys: 'Phys', gun: 'Gun', fire: 'Fire', ice: 'Ice', elec: 'Elec', wind: 'Wind', psy: 'Psy', nuke: 'Nuke',
    bless: 'Bless', curse: 'Curse', almighty: 'Almighty', ailment: 'Ailment', heal: 'Recovery', support: 'Support',
    passive: 'Passive', special: 'Special',
};

const TARGETS = { one: 'enemy', all: 'enemies', ally: 'ally', allies: 'allies', self: 'self' };

const key = (name) => String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
let index = null;
function byKey() {
    if (!index) {
        index = new Map();
        for (const [name, rec] of Object.entries(PERSONA_SKILLS)) index.set(key(name), { name, ...rec });
    }
    return index;
}

/** The skill record for a name (case, spaces and accents ignored), or null. */
export function findSkill(name) {
    return byKey().get(key(name)) || null;
}

export function skillCount() {
    return byKey().size;
}

/** Max SP of a character of `level`, for weighing SP costs against the SP bar. */
export function spPointsAt(level) {
    return 30 + 4 * (Math.max(1, Math.round(level || 1)) - 1);
}

/**
 * What using the skill costs at `level`: { sp: % of the SP bar, hp: % of max HP }.
 * 'spp' costs (P3/P4 "% of SP") are already shares.
 */
export function skillCost(rec, level = 1) {
    if (!rec || !rec.c) return { sp: 0, hp: 0 };
    if (rec.k === 'hp') return { sp: 0, hp: rec.c };
    if (rec.k === 'spp') return { sp: rec.c, hp: 0 };
    // Two decimals: the share of the bar that is exactly the game's SP cost.
    return { sp: Math.max(0.01, Math.round((rec.c * 10000) / spPointsAt(level)) / 100), hp: 0 };
}

/** The game's price as shown to the player: "4 SP", "8% SP", "10% HP", or '' for none. */
export function skillCostLabel(rec) {
    if (!rec || !rec.c) return '';
    if (rec.k === 'hp') return `${rec.c}% HP`;
    if (rec.k === 'spp') return `${rec.c}% SP`;
    return `${rec.c} SP`;
}

/** Whether the combat can use it (passives and field skills cannot). */
export function isCombatSkill(rec) {
    return !!rec && !!rec.fx && rec.fx.k !== 'aff';
}

/** Affinity changes a passive gives ({ el, val }) or null. */
export function passiveAffinity(rec) {
    return rec && rec.fx && rec.fx.k === 'aff' ? { el: rec.fx.el, val: rec.fx.val } : null;
}

/**
 * The combat profile of a skill, or null when it does nothing in a fight.
 * The stat it scales with: St for Phys/Gun (and Almighty skills paid with HP),
 * Ma for everything else.
 */
export function profileFromSkill(rec) {
    if (!isCombatSkill(rec)) return null;
    const fx = rec.fx;
    const element = fx.el && DAMAGE_ELEMENTS.includes(fx.el) ? fx.el : (DAMAGE_ELEMENTS.includes(rec.e) ? rec.e : null);
    const physical = PHYSICAL_ELEMENTS.has(element) || (element === 'almighty' && rec.k === 'hp');
    let target = TARGETS[rec.t] || (['heal', 'kaja', 'charge', 'wall', 'karn', 'dekunda'].includes(fx.k) ? 'ally' : 'enemy');
    if (fx.k === 'charge') target = 'self';
    const p = { type: 'skill', fx, target, stat: physical ? 'st' : 'ma', skill: rec.name };
    if (element) p.element = element;
    if (fx.k === 'dmg') {
        p.pw = fx.pw;
        p.hits = fx.hits;
        p.acc = fx.acc;
        p.crit = fx.crit;
        if (fx.ail) p.ail = { name: fx.ail[0], pct: fx.ail[1] };
    }
    if (fx.k === 'heal' && fx.revive) p.revive = true;
    // How strong it is, for the cooldown used when SP is not tracked and for labels.
    const pw = fx.pw || 0;
    p.power = pw >= 200 ? 'heavy' : pw >= 90 ? 'medium' : 'light';
    return p;
}

/** One line for the UI: "Fire · 40 pwr, 25% Burn · 4 SP". */
export function describeSkill(rec) {
    if (!rec) return '';
    const bits = [ELEMENT_NAMES[rec.e] || rec.e];
    if (rec.d) bits.push(rec.d);
    if (rec.c) bits.push(rec.k === 'hp' ? `${rec.c}% HP` : rec.k === 'spp' ? `${rec.c}% SP` : `${rec.c} SP`);
    return bits.join(' · ');
}
