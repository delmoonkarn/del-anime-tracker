import type {
  AnilistTag,
  AppState,
  CollectionEntry,
  DiscoverCache,
  HFavoriteEntry,
  HPrefs,
} from './types';

// Storage layer notes
// -------------------
// Persistence lives in real files on disk under `data/<key>.json`, served by
// the Next.js API route at /api/storage/[key]. This module is the client-side
// adapter: it does async reads via fetch and debounces writes so rapid state
// changes don't fire one HTTP request per change.
//
// On first load each key tries the API; if empty, it looks for a matching
// legacy localStorage entry and migrates it to the file (then deletes the
// localStorage key). This means users with prior data won't lose it.

const LEGACY_KEYS: Record<StorageKey, string> = {
  state: 'anime-tracker-state-v2',
  collection: 'anime-tracker-collection-v2',
  'discover-cache': 'anime-tracker-discover-v4',
  tags: 'anime-tracker-tags-v1',
  'h-prefs': 'anime-tracker-hentai-prefs-v3',
  // No legacy localStorage for H favorites — it's a new feature.
  'h-favorites': '',
};

type StorageKey =
  | 'state'
  | 'collection'
  | 'discover-cache'
  | 'tags'
  | 'h-prefs'
  | 'h-favorites';

async function readApi<T>(key: StorageKey): Promise<T | null> {
  if (typeof window === 'undefined') return null;
  try {
    const res = await fetch(`/api/storage/${key}`, { cache: 'no-store' });
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
  await fetch(`/api/storage/${key}`, {
    method: 'PUT',
    body,
    headers: { 'content-type': 'application/json' },
  });
}

// Debounce + coalesce per key: only the most recent value is sent.
const pending: Partial<Record<StorageKey, unknown>> = {};
const timers: Partial<Record<StorageKey, ReturnType<typeof setTimeout>>> = {};
const SAVE_DELAY_MS = 300;

async function flush(key: StorageKey): Promise<void> {
  const value = pending[key];
  delete pending[key];
  delete timers[key];
  if (value === undefined) return;
  try {
    await writeApi(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`Failed to persist ${key}`, err);
  }
}

function scheduleSave<T>(key: StorageKey, value: T): void {
  if (typeof window === 'undefined') return;
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

// One-time migration from legacy localStorage entries. Runs only when the
// corresponding file is missing.
async function migrateFromLocalStorage<T>(key: StorageKey): Promise<T | null> {
  if (typeof window === 'undefined') return null;
  const legacy = LEGACY_KEYS[key];
  if (!legacy) return null;
  const raw = window.localStorage.getItem(legacy);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as T;
    await writeApi(key, raw);
    window.localStorage.removeItem(legacy);
    console.info(`Migrated ${key} from localStorage → DB`);
    return value;
  } catch (err) {
    console.warn(`Failed to migrate ${key} from localStorage`, err);
    return null;
  }
}

async function loadOrMigrate<T>(key: StorageKey): Promise<T | null> {
  const fromApi = await readApi<T>(key);
  if (fromApi !== null) return fromApi;
  return migrateFromLocalStorage<T>(key);
}

// ---- Public API ------------------------------------------------------------

export async function loadState(): Promise<AppState | null> {
  return loadOrMigrate<AppState>('state');
}

export function saveState(state: AppState): void {
  scheduleSave('state', state);
}

export async function loadCollection(): Promise<CollectionEntry[]> {
  return (await loadOrMigrate<CollectionEntry[]>('collection')) ?? [];
}

export function saveCollection(items: CollectionEntry[]): void {
  scheduleSave('collection', items);
}

export async function loadDiscoverCache(): Promise<DiscoverCache> {
  const loaded = await loadOrMigrate<Partial<DiscoverCache>>('discover-cache');
  return { entries: Array.isArray(loaded?.entries) ? loaded.entries : [] };
}

export function saveDiscoverCache(cache: DiscoverCache): void {
  scheduleSave('discover-cache', cache);
}

export async function loadTags(): Promise<AnilistTag[] | null> {
  return loadOrMigrate<AnilistTag[]>('tags');
}

export function saveTags(tags: AnilistTag[]): void {
  scheduleSave('tags', tags);
}

export async function loadHPrefs(): Promise<HPrefs | null> {
  return loadOrMigrate<HPrefs>('h-prefs');
}

export function saveHPrefs(prefs: HPrefs): void {
  scheduleSave('h-prefs', prefs);
}

export async function loadHFavorites(): Promise<HFavoriteEntry[]> {
  return (await loadOrMigrate<HFavoriteEntry[]>('h-favorites')) ?? [];
}

export function saveHFavorites(items: HFavoriteEntry[]): void {
  scheduleSave('h-favorites', items);
}
