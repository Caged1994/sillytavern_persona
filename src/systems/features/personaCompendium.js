/**
 * Persona Compendium — the Personas described in lorebook entries.
 *
 * An entry is a Persona when its title (or its first line) starts with
 * "Persona:"; the format is described in src/utils/personaModel.js. The
 * Compendium is read from the lorebook chosen in Settings
 * (extensionSettings.personaCompendiumBook) or, when none is chosen, from
 * every active lorebook. It is only a catalogue: the Personas characters own
 * are copies kept in the chat (characterPersonas.js), so levelling one up
 * in a story never changes the lorebook.
 *
 * Lorebooks load asynchronously; the parsed list is cached and refreshed in
 * the background, so prompt building can read it synchronously.
 */
import { extensionSettings } from '../../core/state.js';
import { getReadableWorldNames, getAllWorldNames, loadWorldData } from '../lorebook/lorebookAPI.js';
import { parseCompendium, nameKey } from '../../utils/personaModel.js';

export const COMPENDIUM_CHANGED_EVENT = 'dooms:persona-compendium';
const STALE_MS = 60 * 1000;

let cache = { list: [], books: [], at: 0 };
let loading = null;

/** The lorebooks the Compendium is read from. */
export function compendiumBooks() {
    const chosen = extensionSettings.personaCompendiumBook;
    if (typeof chosen === 'string' && chosen && getAllWorldNames().includes(chosen)) return [chosen];
    return [...getReadableWorldNames()];
}

/**
 * Reloads the Compendium from the lorebooks. Resolves to the list.
 * @param {{force?: boolean}} [o] - force: reload the lorebooks from disk
 */
export function refreshCompendium({ force = false } = {}) {
    if (loading) return loading;
    loading = (async () => {
        const books = compendiumBooks();
        const entries = [];
        for (const b of books) {
            try {
                const data = await loadWorldData(b, force);
                for (const e of Object.values(data?.entries || {})) entries.push({ ...e, book: b });
            } catch (e) {
                console.warn(`[Dooms Tracker] Personas: could not read lorebook "${b}"`, e);
            }
        }
        const list = parseCompendium(entries);
        cache = { list, books, at: Date.now() };
        try { window.dispatchEvent(new CustomEvent(COMPENDIUM_CHANGED_EVENT, { detail: { count: list.length } })); } catch (e) { /* no window */ }
        return list;
    })().finally(() => { loading = null; });
    return loading;
}

/** The cached Compendium; starts a background refresh when it is old. */
export function getCompendium() {
    const books = compendiumBooks();
    const sameBooks = books.length === cache.books.length && books.every((b, i) => b === cache.books[i]);
    if (!sameBooks || Date.now() - cache.at > STALE_MS) refreshCompendium().catch(() => {});
    return cache.list;
}

export function getCompendiumInfo() {
    return { count: cache.list.length, books: cache.books, at: cache.at };
}

export function findInCompendium(name) {
    const k = nameKey(name);
    return k ? getCompendium().find(p => nameKey(p.name) === k) || null : null;
}

/** For tests and tools: use this list as the Compendium. */
export function setCompendiumForTests(list) {
    cache = { list: Array.isArray(list) ? list : [], books: compendiumBooks(), at: Date.now() };
}
