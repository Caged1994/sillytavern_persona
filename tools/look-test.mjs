#!/usr/bin/env node
/**
 * Persona look test: presets, custom colours, text on the accent, on/off;
 * the changes a reply made, kept on its message per swipe.
 *
 * Usage:  node tools/look-test.mjs     (from the repo root)
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
const { chat } = await import(`${SANDBOX}/script.js`);
let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const L = await import(`${DES}/src/systems/ui/personaLook.js`);
const E = await import(`${DES}/src/systems/features/messageEvents.js`);
const So = await import(`${DES}/src/systems/features/characterSocial.js`);

// ── 1. Colours ──
extensionSettings.enabled = true;
delete extensionSettings.personaLook;
let l = L.getLook();
check('on by default, Persona 4 yellow', l.enabled && l.preset === 'p4' && l.accent === '#ffe100' && L.isLookOn());
check('text on the accent: black on yellow, white on red', L.inkOn('#ffe100') === '#000000' && L.inkOn('#ff1a2e') === '#ffffff');
L.setLook({ preset: 'p5' });
check('a preset brings its own colours', L.getLook().accent === '#ff1a2e' && L.lookVars()['--pl-on-acc'] === '#ffffff');
L.setLook({ accent: '#00FF88', hp: 'not a colour' });
l = L.getLook();
check('a custom accent wins, a bad colour is ignored', l.accent === '#00ff88' && l.hp === L.LOOK_PRESETS.p5.hp && l.custom.accent && !l.custom.hp);
L.setLook({ preset: 'p3' });
check('a new preset clears the custom colours', L.getLook().accent === L.LOOK_PRESETS.p3.accent);
L.setLook({ enabled: false });
check('switched off', !L.isLookOn());
L.setLook({ enabled: true });
extensionSettings.enabled = false;
check('off with the extension', !L.isLookOn());
extensionSettings.enabled = true;

// ── 2. What a reply changed, kept on the message ──
chat.push({ is_user: true, mes: 'hi' }, { is_user: false, mes: 'reply', swipe_id: 0 });
const idx = chat.length - 1;
E.recordMessageEvent(idx, 'social', [{ name: 'Guts', add: 2 }]);
E.recordMessageEvent(idx - 1, 'social', [{ name: 'x' }]);
check('recorded on the message it belongs to', E.getMessageEvents(chat[idx]).social?.[0]?.name === 'Guts' && E.getMessageEvents(chat[idx - 1]).social?.[0]?.name === 'x');
chat[idx].swipe_id = 1;
check('another swipe has its own', !E.getMessageEvents(chat[idx]).social);
E.recordMessageEvent(idx, 'when', { date: '2016-04-15', slot: 'morning' });
chat[idx].swipe_id = 0;
check('...and the first keeps its', E.getMessageEvents(chat[idx]).social?.[0]?.add === 2 && !E.getMessageEvents(chat[idx]).when);
E.recordMessageEvent(idx, 'social', []);
check('an empty list removes the kind', !E.getMessageEvents(chat[idx]).social);

// ── 3. Social points from a reply land on it ──
extensionSettings.characterStats = { ...(extensionSettings.characterStats || {}) };
try { So.setSocialEnabled(true); } catch (e) {}
const before = chat.length;
chat.push({ is_user: false, mes: 'studied', swipe_id: 0 });
const n = So.applyAISocial({ Knowledge: 3 }, before);
const ev = E.getMessageEvents(chat[before]).social;
check('a social gain is noted on its reply', n === 1 && (ev && ev[0].name === 'Knowledge' && ev[0].add === 3), JSON.stringify({ n, ev }));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
