/**
 * Automatic consequences — pure rules.
 *
 * When a stat bar runs low, a condition follows by itself: HP 0 →
 * Unconscious, Satiety low → Hungry, then Starving, and so on. The condition
 * carries attribute maluses like any other and ends by itself when the bar
 * recovers. Only the most severe rule of a stat applies at a time.
 *
 * Hysteresis: a condition stays until the bar is RECOVER points above the
 * rule's ceiling, so a value hovering on the line doesn't flicker the
 * condition on and off.
 *
 * Effects use attribute ids (st, ma, en, ag, lu).
 */

export const RECOVER = 5;

/** Rules per stat, most severe first. */
export const CONSEQUENCE_RULES = [
    { id: 'unconscious', stat: 'health', min: 0, max: 0, icon: '😵', name: 'Unconscious', desc: 'Down — cannot act', effects: {} },
    { id: 'badly-wounded', stat: 'health', min: 1, max: 20, icon: '🩸', name: 'Badly wounded', desc: 'Bleeding, every move hurts', effects: { st: -4, ag: -4, en: -2 } },
    { id: 'starving', stat: 'satiety', min: 0, max: 10, icon: '🦴', name: 'Starving', desc: 'Weak with hunger', effects: { st: -4, en: -4 } },
    { id: 'hungry', stat: 'satiety', min: 11, max: 30, icon: '🍞', name: 'Hungry', desc: 'Stomach growling', effects: { st: -2 } },
    { id: 'exhausted', stat: 'energy', min: 0, max: 10, icon: '😫', name: 'Exhausted', desc: 'Can barely stand', effects: { ag: -4, ma: -4, lu: -2 } },
    { id: 'tired', stat: 'energy', min: 11, max: 25, icon: '😴', name: 'Tired', desc: 'Slow and heavy-eyed', effects: { ag: -2 } },
    { id: 'filthy', stat: 'hygiene', min: 0, max: 15, icon: '🪰', name: 'Filthy', desc: 'Dirty and smelly', effects: { lu: -4 } },
    { id: 'despairing', stat: 'morale', min: 0, max: 10, icon: '🌧️', name: 'Despairing', desc: 'Close to giving up', effects: { ma: -4, lu: -4 } },
    { id: 'downcast', stat: 'morale', min: 11, max: 25, icon: '😞', name: 'Downcast', desc: 'Low spirits', effects: { lu: -2 } },
    { id: 'mana-drained', stat: 'mana', min: 0, max: 0, icon: '🫗', name: 'SP drained', desc: 'No SP left to use skills', effects: {} },
];

export function rulesForStat(statId) {
    return CONSEQUENCE_RULES.filter(r => r.stat === statId);
}

/**
 * Which rule should be in effect for one stat.
 * @param {string} statId
 * @param {number} value - the bar's current value (0–100)
 * @param {string|null} activeId - the rule in effect now, if any
 * @returns {object|null} the rule, or null for none
 */
export function desiredRule(statId, value, activeId = null) {
    const rules = rulesForStat(statId);
    if (!rules.length || typeof value !== 'number' || !Number.isFinite(value)) return null;
    const target = rules.find(r => value >= r.min && value <= r.max) || null;
    const active = activeId ? rules.find(r => r.id === activeId) : null;
    if (!active) return target;
    const severity = (r) => rules.indexOf(r);
    // A worse rule always takes over; a milder one (or none) only once the
    // bar has recovered past the active rule's ceiling.
    if (target && severity(target) <= severity(active)) return target;
    if (value <= active.max + RECOVER) return active;
    return target;
}

/**
 * The rules that should be in effect for a character.
 * @param {Object<string, number>} values - { statId: value } of the bars in use
 * @param {Object<string, string>} active - { statId: ruleId } in effect now
 * @returns {object[]} rules
 */
export function desiredConsequences(values, active = {}) {
    const out = [];
    for (const statId of new Set(CONSEQUENCE_RULES.map(r => r.stat))) {
        if (!(statId in (values || {}))) continue;
        const r = desiredRule(statId, values[statId], active[statId] || null);
        if (r) out.push(r);
    }
    return out;
}
