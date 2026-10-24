import type {
  AnilistTag,
  AppState,
  CollectionEntry,
  DiscoverCache,
  HFavoriteEntry,
  HPrefs,
  StreamLinksMap,
  AnilistLinksCache,
  LinkSourcesCache,
} from './types';
import { SIGNED_OUT_EVENT } from './auth';

// Storage layer notes
// -------------------
// Persistence lives in SQLite (local file or Cloudflare D1), served by the
// Hono route at /api/storage/:key (see server/app.ts). This module is the client-side
// adapter: it does async reads via fetch and debounces writes so rapid state
// changes don't fire one HTTP request per change.
//
// Open tabs stay in step. Each tab holds its own copy of the data and a save
// sends a whole list, so an older tab could save its copy over a newer one.
// So a tab skips saving what it last got from the server, tells the other
// tabs in this browser when a save changed rows (they reload that list), and
// App reloads the lists when you come back to a tab, which also picks up
// changes made on another device.

type StorageKey =
  | 'state'
  | 'collection'
  | 'discover-cache'
  | 'tags'
  | 'h-prefs'
  | 'h-favorites'
  | 'stream-links'
  | 'anilist-links'
  | 'link-sources';

// The session ended (expired, or signed out on another device). AuthGate
// hears this and swaps the app for the sign-in page.
function signedOut(): void {
  window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
}

/** The lists other tabs reload when one tab changes them (caches aren't). */
export const SYNCED_KEYS = ['state', 'collection', 'h-favorites', 'stream-links'] as const;
export type SyncedKey = (typeof SYNCED_KEYS)[number];
const isSynced = (key: string): key is SyncedKey => (SYNCED_KEYS as readonly string[]).includes(key);

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('anime-tracker') : null;

/** Per list, the JSON this tab last read from or saved to the server. */
const lastServer: Partial<Record<StorageKey, string>> = {};

async function readApi<T>(key: StorageKey): Promise<T | null> {
  if (typeof window === 'undefined') return null;
  try {
    const res = await fetch(`/api/storage/${key}`, { cache: 'no-store' });
    if (res.status === 401) {
      signedOut();
      // Never settle: a null here would read as "no data yet" and the app
      // would start from an empty tracker. AuthGate unmounts it instead.
      return new Promise<never>(() => {});
    }
    if (!res.ok) return null;
    const text = await res.text();
    lastServer[key] = text;
    if (text === 'null' || text.length === 0) return null;
    return JSON.parse(text) as T;
  } catch (err) {
    console.warn(`Failed to read ${key} from API`, err);
    return null;
  }
}

async function writeApi(key: StorageKey, body: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const res = await fetch(`/api/storage/${key}`, {
    method: 'PUT',
    body,
    headers: { 'content-type': 'application/json' },
  });
  if (res.status === 401) signedOut();
  if (!res.ok) return;
  lastServer[key] = body;
  // The server says how many rows changed: only then do other tabs reload.
  const { changed } = ((await res.json().catch(() => null)) ?? {}) as { changed?: number };
  if (changed && isSynced(key)) channel?.postMessage(key);
}

// Debounce + coalesce per key: only the most recent value is sent.
const pending: Partial<Record<StorageKey, unknown>> = {};
const timers: Partial<Record<StorageKey, ReturnType<typeof setTimeout>>> = {};
const writing = new Set<Promise<void>>();
const writingKeys = new Map<StorageKey, number>();
const SAVE_DELAY_MS = 300;
// Set while a restore replaces the data under this page (stopSaving).
let stopped = false;

async function flush(key: StorageKey): Promise<void> {
  const value = pending[key];
  delete pending[key];
  delete timers[key];
  if (value === undefined) return;
  const body = JSON.stringify(value);
  // Just what the server sent us (a reload, or no real change): nothing to save.
  if (body === lastServer[key]) return;
  const write = writeApi(key, body);
  writing.add(write);
  writingKeys.set(key, (writingKeys.get(key) ?? 0) + 1);
  try {
    await write;
  } catch (err) {
    console.warn(`Failed to persist ${key}`, err);
  } finally {
    writing.delete(write);
    writingKeys.set(key, (writingKeys.get(key) ?? 1) - 1);
  }
}

/** Calls `onChange` when another tab in this browser saved a change to a list. Returns an unsubscribe. */
export function onOtherTabSaved(onChange: (key: SyncedKey) => void): () => void {
  if (!channel) return () => {};
  const listener = (e: MessageEvent) => {
    if (typeof e.data === 'string' && isSynced(e.data)) onChange(e.data);
  };
  channel.addEventListener('message', listener);
  return () => channel.removeEventListener('message', listener);
}

/** True while this tab has an edit to a list that isn't on the server yet;
 *  reloading the list then would throw the edit away. */
export function hasUnsavedEdits(key: StorageKey): boolean {
  return pending[key] !== undefined || (writingKeys.get(key) ?? 0) > 0;
}

/**
 * Before a restore from Settings: saves the edits still waiting, then stops
 * saving. Each save sends a whole table, so this page's (soon old) data must
 * not land on top of the restore; the page reloads once it's done.
 */
export async function stopSaving(): Promise<void> {
  stopped = true;
  for (const k of Object.keys(timers) as StorageKey[]) clearTimeout(timers[k]);
  await Promise.all([...(Object.keys(pending) as StorageKey[]).map(flush), ...writing]);
}

/** The restore didn't happen: carry on saving. */
export function resumeSaving(): void {
  stopped = false;
}

function scheduleSave<T>(key: StorageKey, value: T): void {
  if (typeof window === 'undefined' || stopped) return;
  pending[key] = value;
  const existing = timers[key];
  if (existing) clearTimeout(existing);
  timers[key] = setTimeout(() => flush(key), SAVE_DELAY_MS);
}

// On page unload, flush any pending writes using sendBeacon (which survives
// the page tearing down). Without this, the last few changes a user made
// could be lost if they close the tab within the debounce window.
if (typeof window !== 'undefined') {
  const flushAllOnUnload = () => {
    if (stopped) return;
    for (const k of Object.keys(pending) as StorageKey[]) {
      const value = pending[k];
      if (value === undefined) continue;
      try {
        const blob = new Blob([JSON.stringify(value)], {
          type: 'application/json',
        });
        navigator.sendBeacon(`/api/storage/${k}`, blob);
      } catch {
        // best-effort
      }
    }
  };
  window.addEventListener('pagehide', flushAllOnUnload);
  window.addEventListener('beforeunload', flushAllOnUnload);
}

// ---- Public API ------------------------------------------------------------

export async function loadState(): Promise<AppState | null> {
  return readApi<AppState>('state');
}

export function saveState(state: AppState): void {
  // The season on screen is each tab's own (its address), not saved.
  scheduleSave('state', { ...state, activeSeasonId: null });
}

export async function loadCollection(): Promise<CollectionEntry[]> {
  return (await readApi<CollectionEntry[]>('collection')) ?? [];
}

export function saveCollection(items: CollectionEntry[]): void {
  scheduleSave('collection', items);
}

export async function loadDiscoverCache(): Promise<DiscoverCache> {
  const loaded = await readApi<Partial<DiscoverCache>>('discover-cache');
  return { entries: Array.isArray(loaded?.entries) ? loaded.entries : [] };
}

export function saveDiscoverCache(cache: DiscoverCache): void {
  scheduleSave('discover-cache', cache);
}

export async function loadTags(): Promise<AnilistTag[] | null> {
  return readApi<AnilistTag[]>('tags');
}

export function saveTags(tags: AnilistTag[]): void {
  scheduleSave('tags', tags);
}

export async function loadHPrefs(): Promise<HPrefs | null> {
  return readApi<HPrefs>('h-prefs');
}

export function saveHPrefs(prefs: HPrefs): void {
  scheduleSave('h-prefs', prefs);
}

export async function loadHFavorites(): Promise<HFavoriteEntry[]> {
  return (await readApi<HFavoriteEntry[]>('h-favorites')) ?? [];
}

export function saveHFavorites(items: HFavoriteEntry[]): void {
  scheduleSave('h-favorites', items);
}

export async function loadStreamLinks(): Promise<StreamLinksMap> {
  return (await readApi<StreamLinksMap>('stream-links')) ?? {};
}

export function saveStreamLinks(map: StreamLinksMap): void {
  scheduleSave('stream-links', map);
}

export async function loadAnilistLinks(): Promise<AnilistLinksCache> {
  return (await readApi<AnilistLinksCache>('anilist-links')) ?? {};
}

export function saveAnilistLinks(cache: AnilistLinksCache): void {
  scheduleSave('anilist-links', cache);
}

export async function loadLinkSources(): Promise<LinkSourcesCache | null> {
  return readApi<LinkSourcesCache>('link-sources');
}

export function saveLinkSources(cache: LinkSourcesCache): void {
  scheduleSave('link-sources', cache);
}
