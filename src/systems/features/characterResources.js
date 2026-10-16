/**
 * HP and SP as points (current / max), as in the games.
 *
 * The bars are stored as a share of the maximum (0–100, with two decimals so
 * a value set in points comes back exactly), because the maximum moves with
 * the character: max HP grows with Endurance and level, max SP with level.
 * The formulas are the ones the fights use (combatModel.maxHpFor,
 * skillModel.spPointsAt), so the numbers shown outside a fight are the ones
 * the fight starts from.
 */
import { getCurrentStatValues, setCurrentStatValue } from './characterStats.js';
import { getEffectiveStatValues } from './characterModifiers.js';
import { getLevelInfo, isProgressEnabled } from './characterProgress.js';
import { maxHpFor } from '../../utils/combatModel.js';
import { spPointsAt } from '../../utils/skillModel.js';

export const RESOURCE_IDS = ['health', 'mana'];

export function isResource(statId) {
    return RESOURCE_IDS.includes(statId);
}

function levelOf(name, isUser) {
    try { return isProgressEnabled() ? getLevelInfo(name, isUser).level || 1 : 1; } catch (e) { return 1; }
}

/** Max HP or SP of a character right now. */
export function resourceMax(name, isUser, statId) {
    const level = levelOf(name, isUser);
    if (statId === 'mana') return spPointsAt(level);
    let en = 10;
    try { en = getEffectiveStatValues(name, isUser).values.en ?? 10; } catch (e) { /* no sheet */ }
    return maxHpFor(en, level);
}

/** Points from a stored share. */
export function toPoints(pct, max) {
    return Math.max(0, Math.min(max, Math.round((Number(pct) || 0) * max / 100)));
}

/** A stored share from points (two decimals, so the points round-trip exactly). */
export function toShare(points, max) {
    if (!max) return 0;
    return Math.round(Math.max(0, Math.min(max, Number(points) || 0)) / max * 10000) / 100;
}

/** { cur, max } in points for HP or SP. */
export function getResource(name, isUser, statId, current = null) {
    const max = resourceMax(name, isUser, statId);
    const pct = current ?? getCurrentStatValues(name, isUser)[statId];
    return { cur: toPoints(pct, max), max };
}

/** Sets HP or SP in points. Returns the points stored. */
export function setResourcePoints(name, isUser, statId, points) {
    const max = resourceMax(name, isUser, statId);
    const v = setCurrentStatValue(name, isUser, statId, toShare(points, max));
    return v === null ? null : toPoints(v, max);
}
