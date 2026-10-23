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
}

// Debounce + coalesce per key: only the most recent value is sent.
const pending: Partial<Record<StorageKey, unknown>> = {};
const timers: Partial<Record<StorageKey, ReturnType<typeof setTimeout>>> = {};
const writing = new Set<Promise<void>>();
const SAVE_DELAY_MS = 300;
// Set while a restore replaces the data under this page (stopSaving).
let stopped = false;

async function flush(key: StorageKey): Promise<void> {
  const value = pending[key];
  delete pending[key];
  delete timers[key];
  if (value === undefined) return;
  const write = writeApi(key, JSON.stringify(value));
  writing.add(write);
  try {
    await write;
  } catch (err) {
    console.warn(`Failed to persist ${key}`, err);
  } finally {
    writing.delete(write);
  }
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
  scheduleSave('state', state);
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
