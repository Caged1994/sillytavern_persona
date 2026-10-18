/**
 * Persona look — the Persona 4 style (black, a bold accent colour, heavy
 * italic type, slanted tabs) across the stats panel, the fight, Shuffle
 * Time, the dungeon and the chat's scene headers.
 *
 * Colours are CSS variables set on the document root (and on the pop-out's):
 *   --pl-acc      accent (P4 yellow by default)
 *   --pl-acc2     second accent (gradients, card backs)
 *   --pl-on-acc   text on the accent (black or white, by its lightness)
 *   --pl-hp/--pl-sp  the HP and SP bars
 * and body.des-plook switches the look's stylesheet rules on. The Velvet
 * Room keeps its blue whatever the accent.
 */
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { ensureCss } from '../../core/cssLoader.js';

export const LOOK_PRESETS = {
    p4: { name: 'Yellow (Persona 4)', accent: '#ffe100', accent2: '#ff9d00', hp: '#b8f000', sp: '#ff4fa3' },
    p3: { name: 'Blue (Persona 3)', accent: '#41b6ff', accent2: '#1b6fd8', hp: '#7af5ff', sp: '#c79bff' },
    p5: { name: 'Red (Persona 5)', accent: '#ff1a2e', accent2: '#ffffff', hp: '#38ff8e', sp: '#4fd0ff' },
};
export const DEFAULT_LOOK = { enabled: true, preset: 'p4', accent: '', hp: '', sp: '' };

const HEX = /^#[0-9a-f]{6}$/i;

function settings() {
    const s = extensionSettings.personaLook;
    return { ...DEFAULT_LOOK, ...(s && typeof s === 'object' ? s : {}) };
}

export function isLookOn() {
    return extensionSettings.enabled !== false && settings().enabled !== false;
}

/** The colours in use: the preset's, with any custom one on top. */
export function getLook() {
    const s = settings();
    const p = LOOK_PRESETS[s.preset] || LOOK_PRESETS.p4;
    return {
        enabled: s.enabled !== false,
        preset: LOOK_PRESETS[s.preset] ? s.preset : 'p4',
        accent: HEX.test(s.accent) ? s.accent : p.accent,
        accent2: HEX.test(s.accent) ? s.accent : p.accent2,
        hp: HEX.test(s.hp) ? s.hp : p.hp,
        sp: HEX.test(s.sp) ? s.sp : p.sp,
        custom: { accent: HEX.test(s.accent), hp: HEX.test(s.hp), sp: HEX.test(s.sp) },
    };
}

/** Black or white, whichever reads better on the colour. */
export function inkOn(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 0.32 ? '#000000' : '#ffffff';
}

export function lookVars() {
    const l = getLook();
    return { '--pl-acc': l.accent, '--pl-acc2': l.accent2, '--pl-on-acc': inkOn(l.accent), '--pl-hp': l.hp, '--pl-sp': l.sp };
}

/** Puts the look on a document (SillyTavern's, or the stats pop-out's). */
export function applyPersonaLook(doc = document) {
    if (!doc?.documentElement) return;
    const on = isLookOn();
    if (on && doc === document) ensureCss('persona-look').catch(() => {});
    const root = doc.documentElement.style;
    for (const [k, v] of Object.entries(lookVars())) {
        if (on) root.setProperty(k, v); else root.removeProperty(k);
    }
    doc.body?.classList.toggle('des-plook', on);
}

/** Changes the look ({ enabled, preset, accent, hp, sp }); '' clears a custom colour. */
export function setLook(changes = {}) {
    const s = settings();
    if ('enabled' in changes) s.enabled = !!changes.enabled;
    if ('preset' in changes && LOOK_PRESETS[changes.preset]) {
        s.preset = changes.preset;
        // A new preset starts from its own colours.
        s.accent = ''; s.hp = ''; s.sp = '';
    }
    for (const k of ['accent', 'hp', 'sp']) {
        if (k in changes) s[k] = HEX.test(changes[k]) ? changes[k].toLowerCase() : '';
    }
    extensionSettings.personaLook = s;
    saveSettings();
    applyPersonaLook();
    for (const fn of listeners) { try { fn(); } catch (e) { /* a listener's problem */ } }
    return getLook();
}

const listeners = new Set();
/** Called after every change (the pop-out re-applies it to its own document). */
export function onLookChange(fn) { listeners.add(fn); }
