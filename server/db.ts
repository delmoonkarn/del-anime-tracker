// Server-side only. Lives under server/ so it can't be imported from the
// client by accident. Types are shared with the frontend via @/lib/types.
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AnilistTag,
  AnimeEntry,
  AppState,
  CollectionEntry,
  CollectionSection,
  DayOfWeek,
  DiscoverCache,
  DiscoverCacheEntry,
  DiscoverItem,
  HFavoriteEntry,
  HPrefs,
  Season,
  WatchStatus,
} from '../src/lib/types';

const DATA_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'anime-tracker.db');

mkdirSync(DATA_DIR, { recursive: true });

// Reuse one connection per process. The globalThis cache survives `tsx`
// watch-mode re-imports so we don't pile up connections during dev.
const g = globalThis as unknown as { __animeTrackerDb?: Database.Database };
const db: Database.Database = g.__animeTrackerDb ?? new Database(DB_PATH);
g.__animeTrackerDb = db;

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- Schema ---------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS seasons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS anime_entries (
    id TEXT PRIMARY KEY,
    season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    anilist_id INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    title_english TEXT,
    image_url TEXT,
    day TEXT,
    time TEXT,
    platform TEXT,
    platform_url TEXT,
    status TEXT,
    added_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_anime_season ON anime_entries(season_id);

  CREATE TABLE IF NOT EXISTS collection (
    anilist_id INTEGER NOT NULL,
    section TEXT NOT NULL,
    title TEXT NOT NULL,
    title_english TEXT,
    image_url TEXT,
    description TEXT,
    tags_json TEXT,
    format TEXT,
    episodes INTEGER,
    average_score INTEGER,
    start_year INTEGER,
    start_month INTEGER,
    start_day INTEGER,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (anilist_id, section)
  );

  CREATE TABLE IF NOT EXISTS discover_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season TEXT NOT NULL,
    year INTEGER NOT NULL,
    tags_json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    items_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_discover_lookup ON discover_cache(season, year);

  CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER NOT NULL
  );

  /* H favorites — intentionally separate from collection. */
  CREATE TABLE IF NOT EXISTS h_favorites (
    anilist_id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    title_english TEXT,
    image_url TEXT,
    description TEXT,
    tags_json TEXT,
    format TEXT,
    episodes INTEGER,
    average_score INTEGER,
    start_year INTEGER,
    start_month INTEGER,
    start_day INTEGER,
    added_at INTEGER NOT NULL
  );

  /* Watch progress + user score, keyed by AniList ID. One row per show,
     shared across every anime_entries row AND every collection row that
     references the same anilist_id (e.g. a split-cour show in Fall 2025 +
     Winter 2026 schedule sheets, or a show in both Favorites and
     Interested). On read, readAppState / readCollection LEFT JOIN this so
     the same progress and rating appear on every card for the show.
     user_score is collection-driven (1–5); schedule writes don't touch it. */
  CREATE TABLE IF NOT EXISTS anime_progress (
    anilist_id INTEGER PRIMARY KEY,
    watch_status TEXT,
    episodes_watched INTEGER,
    total_episodes INTEGER,
    next_airing_episode INTEGER,
    next_airing_at INTEGER,
    user_score INTEGER,
    updated_at INTEGER NOT NULL
  );
`);

// One-time migration: older databases used a `hentai_favorites` table and a
// kv_store key named `hentai-prefs`. Move them over to the new H-prefixed
// names so existing users don't lose their data.
try {
  const oldTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hentai_favorites'")
    .get();
  if (oldTable) {
    db.exec(`
      INSERT OR IGNORE INTO h_favorites SELECT * FROM hentai_favorites;
      DROP TABLE hentai_favorites;
    `);
    console.info('[db] migrated hentai_favorites → h_favorites');
  }
  const oldPrefs = db
    .prepare("SELECT value FROM kv_store WHERE key = 'hentai-prefs'")
    .get() as { value: string | null } | undefined;
  if (oldPrefs && oldPrefs.value != null) {
    db.prepare(
      `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run('h-prefs', oldPrefs.value, Date.now());
    db.prepare("DELETE FROM kv_store WHERE key = 'hentai-prefs'").run();
    console.info('[db] migrated kv_store hentai-prefs → h-prefs');
  }
} catch (err) {
  console.warn('[db] H rename migration skipped:', err);
}

// Add `tags_full` column to `collection` if it's missing (old DBs).
try {
  const cols = db.prepare("PRAGMA table_info(collection)").all() as { name: string }[];
  if (!cols.some((c) => c.name === 'tags_full')) {
    db.exec('ALTER TABLE collection ADD COLUMN tags_full INTEGER NOT NULL DEFAULT 0');
    console.info('[db] added collection.tags_full column');
  }
} catch (err) {
  console.warn('[db] tags_full migration skipped:', err);
}

// Watch-progress columns on anime_entries (added incrementally per feature
// shipped — see `WatchStatus` in types.ts). All three are nullable: existing
// rows mean "user hasn't engaged with the tracker yet", which the UI renders
// as the dimmed "— Status —" pill and an episodes-watched count of 0.
try {
  const cols = db.prepare("PRAGMA table_info(anime_entries)").all() as { name: string }[];
  const has = new Set(cols.map((c) => c.name));
  if (!has.has('watch_status')) {
    db.exec('ALTER TABLE anime_entries ADD COLUMN watch_status TEXT');
    console.info('[db] added anime_entries.watch_status column');
  }
  if (!has.has('episodes_watched')) {
    db.exec('ALTER TABLE anime_entries ADD COLUMN episodes_watched INTEGER');
    console.info('[db] added anime_entries.episodes_watched column');
  }
  if (!has.has('total_episodes')) {
    db.exec('ALTER TABLE anime_entries ADD COLUMN total_episodes INTEGER');
    console.info('[db] added anime_entries.total_episodes column');
  }
  if (!has.has('next_airing_episode')) {
    db.exec('ALTER TABLE anime_entries ADD COLUMN next_airing_episode INTEGER');
    console.info('[db] added anime_entries.next_airing_episode column');
  }
  if (!has.has('next_airing_at')) {
    db.exec('ALTER TABLE anime_entries ADD COLUMN next_airing_at INTEGER');
    console.info('[db] added anime_entries.next_airing_at column');
  }
  if (!has.has('format')) {
    // AniList MediaFormat string (TV, MOVIE, OVA, SPECIAL, ONA, TV_SHORT,
    // MUSIC). Lets the schedule grid bucket movies into their own block
    // separate from the day-of-week grouping the rest of the cards use.
    db.exec('ALTER TABLE anime_entries ADD COLUMN format TEXT');
    console.info('[db] added anime_entries.format column');
  }
} catch (err) {
  console.warn('[db] watch-progress migration skipped:', err);
}

// Add `user_score` column to `anime_progress` if it's missing (old DBs).
// Stores the user's 1–5 rating for a show, broadcast from the collection
// card. Schedule writes never touch this column.
try {
  const cols = db.prepare("PRAGMA table_info(anime_progress)").all() as { name: string }[];
  if (!cols.some((c) => c.name === 'user_score')) {
    db.exec('ALTER TABLE anime_progress ADD COLUMN user_score INTEGER');
    console.info('[db] added anime_progress.user_score column');
  }
} catch (err) {
  console.warn('[db] user_score migration skipped:', err);
}

// One-shot backfill of anime_progress from anime_entries. For each AniList
// ID that has any watch-related field populated, we collapse its rows into
// a single progress row using MAX() per column. Picks the highest-watched
// state, the latest cached airing data, and consolidates total_episodes.
// (watch_status is alphabetical MAX — usually NULL for most rows so collisions
// are rare; user can re-set via dropdown if it picks the wrong status.)
// Gated: only runs when anime_progress is empty, so re-imports don't
// stomp on already-shared progress.
try {
  const empty = (db.prepare('SELECT COUNT(*) AS n FROM anime_progress').get() as { n: number }).n === 0;
  if (empty) {
    const result = db.prepare(`
      INSERT INTO anime_progress (anilist_id, watch_status, episodes_watched, total_episodes, next_airing_episode, next_airing_at, updated_at)
      SELECT
        anilist_id,
        MAX(watch_status),
        MAX(episodes_watched),
        MAX(total_episodes),
        MAX(next_airing_episode),
        MAX(next_airing_at),
        MAX(added_at)
      FROM anime_entries
      WHERE anilist_id > 0
        AND (
          watch_status IS NOT NULL
          OR episodes_watched IS NOT NULL
          OR total_episodes IS NOT NULL
          OR next_airing_episode IS NOT NULL
          OR next_airing_at IS NOT NULL
        )
      GROUP BY anilist_id
    `).run();
    if (result.changes > 0) {
      console.info(`[db] backfilled anime_progress with ${result.changes} show(s)`);
    }
  }
} catch (err) {
  console.warn('[db] anime_progress backfill skipped:', err);
}

// One-shot wipe of `discover_cache`: pre-airing-data caches stored
// DiscoverItems without `nextAiringEpisode`/`nextAiringAt`, which breaks the
// auto day/time fill on Add. Gated by a kv_store flag so it only runs once.
try {
  const flagKey = 'discover-cache-airing-cleared-v1';
  const flag = db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(flagKey);
  if (!flag) {
    db.exec('DELETE FROM discover_cache');
    db.prepare(
      `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(flagKey, JSON.stringify(true), Date.now());
    console.info('[db] cleared discover_cache for airing-data migration');
  }
} catch (err) {
  console.warn('[db] discover_cache invalidation skipped:', err);
}

// ---- AppState (seasons + anime entries + activeSeasonId) -----------------

interface SeasonRow {
  id: string;
  name: string;
  created_at: number;
}
interface AnimeRow {
  id: string;
  season_id: string;
  anilist_id: number;
  title: string;
  title_english: string | null;
  image_url: string | null;
  day: string | null;
  time: string | null;
  platform: string | null;
  platform_url: string | null;
  status: string | null;
  added_at: number;
  watch_status: string | null;
  episodes_watched: number | null;
  total_episodes: number | null;
  next_airing_episode: number | null;
  next_airing_at: number | null;
  format: string | null;
}

function readAppState(): AppState | null {
  const seasonsRows = db
    .prepare('SELECT * FROM seasons ORDER BY created_at ASC')
    .all() as SeasonRow[];
  // LEFT JOIN with anime_progress so shows that span multiple seasons read
  // the same watch progress. COALESCE: progress table wins when present;
  // anime_entries columns are the fallback for unbound entries (anilist_id 0,
  // typically xlsx imports that didn't match on AniList).
  const animesRows = db
    .prepare(
      `SELECT
         ae.id,
         ae.season_id,
         ae.anilist_id,
         ae.title,
         ae.title_english,
         ae.image_url,
         ae.day,
         ae.time,
         ae.platform,
         ae.platform_url,
         ae.status,
         ae.added_at,
         ae.format,
         COALESCE(ap.watch_status,        ae.watch_status)        AS watch_status,
         COALESCE(ap.episodes_watched,    ae.episodes_watched)    AS episodes_watched,
         COALESCE(ap.total_episodes,      ae.total_episodes)      AS total_episodes,
         COALESCE(ap.next_airing_episode, ae.next_airing_episode) AS next_airing_episode,
         COALESCE(ap.next_airing_at,      ae.next_airing_at)      AS next_airing_at
       FROM anime_entries ae
       LEFT JOIN anime_progress ap
         ON ae.anilist_id > 0 AND ap.anilist_id = ae.anilist_id`,
    )
    .all() as AnimeRow[];
  if (seasonsRows.length === 0) return null;

  const grouped = new Map<string, AnimeEntry[]>();
  for (const r of animesRows) {
    const list = grouped.get(r.season_id) ?? [];
    list.push({
      id: r.id,
      anilistId: r.anilist_id,
      title: r.title,
      titleEnglish: r.title_english ?? undefined,
      imageUrl: r.image_url ?? '',
      day: (r.day as DayOfWeek | null) ?? null,
      time: r.time ?? '',
      platform: r.platform ?? '',
      platformUrl: r.platform_url ?? '',
      status: r.status ?? '',
      watchStatus: (r.watch_status as WatchStatus | null) ?? undefined,
      episodesWatched: r.episodes_watched ?? undefined,
      totalEpisodes: r.total_episodes ?? undefined,
      nextAiringEpisode: r.next_airing_episode ?? undefined,
      nextAiringAt: r.next_airing_at ?? undefined,
      format: r.format ?? undefined,
      addedAt: r.added_at,
    });
    grouped.set(r.season_id, list);
  }
  const seasons: Season[] = seasonsRows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    animes: grouped.get(r.id) ?? [],
  }));

  const activeRow = db
    .prepare('SELECT value FROM kv_store WHERE key = ?')
    .get('activeSeasonId') as { value: string | null } | undefined;
  const activeSeasonId = activeRow?.value || null;

  return { seasons, activeSeasonId };
}

const writeAppStateTxn = db.transaction((state: AppState) => {
  db.prepare('DELETE FROM anime_entries').run();
  db.prepare('DELETE FROM seasons').run();
  const insSeason = db.prepare(
    'INSERT INTO seasons (id, name, created_at) VALUES (?, ?, ?)',
  );
  const insAnime = db.prepare(`
    INSERT INTO anime_entries
      (id, season_id, anilist_id, title, title_english, image_url, day, time, platform, platform_url, status, added_at, watch_status, episodes_watched, total_episodes, next_airing_episode, next_airing_at, format)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // For each anilist_id > 0, collect the "best" progress across all
  // entries — defends against drift where one card got updated and its
  // siblings still have stale values in state. Highest episodes_watched
  // wins; that entry's other watch fields are taken too.
  const progressByAnilistId = new Map<number, AnimeEntry>();
  for (const s of state.seasons) {
    for (const a of s.animes) {
      if (!a.anilistId || a.anilistId <= 0) continue;
      const existing = progressByAnilistId.get(a.anilistId);
      const cur = a.episodesWatched ?? 0;
      const prev = existing?.episodesWatched ?? 0;
      if (!existing || cur > prev) progressByAnilistId.set(a.anilistId, a);
    }
  }
  for (const s of state.seasons) {
    insSeason.run(s.id, s.name, s.createdAt);
    for (const a of s.animes) {
      // For bound entries (anilist_id > 0) the watch fields are owned by
      // anime_progress, so we null them here to keep the source-of-truth
      // singular. For unbound entries (anilist_id = 0) the columns ARE
      // the source of truth — anime_progress has nothing to JOIN against.
      const bound = (a.anilistId ?? 0) > 0;
      insAnime.run(
        a.id,
        s.id,
        a.anilistId ?? 0,
        a.title,
        a.titleEnglish ?? null,
        a.imageUrl ?? null,
        a.day ?? null,
        a.time ?? null,
        a.platform ?? null,
        a.platformUrl ?? null,
        a.status ?? null,
        a.addedAt,
        bound ? null : (a.watchStatus ?? null),
        bound ? null : (a.episodesWatched ?? null),
        bound ? null : (a.totalEpisodes ?? null),
        bound ? null : (a.nextAiringEpisode ?? null),
        bound ? null : (a.nextAiringAt ?? null),
        a.format ?? null,
      );
    }
  }
  // Upsert one progress row per unique anilist_id. We don't DELETE the
  // table first — orphaned rows (shows no longer in any season) are
  // harmless and re-adding the show later restores the user's progress.
  const upsertProgress = db.prepare(
    `INSERT INTO anime_progress
       (anilist_id, watch_status, episodes_watched, total_episodes,
        next_airing_episode, next_airing_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(anilist_id) DO UPDATE SET
       watch_status        = excluded.watch_status,
       episodes_watched    = excluded.episodes_watched,
       total_episodes      = excluded.total_episodes,
       next_airing_episode = excluded.next_airing_episode,
       next_airing_at      = excluded.next_airing_at,
       updated_at          = excluded.updated_at`,
  );
  const now = Date.now();
  for (const [anilistId, a] of progressByAnilistId) {
    upsertProgress.run(
      anilistId,
      a.watchStatus ?? null,
      a.episodesWatched ?? null,
      a.totalEpisodes ?? null,
      a.nextAiringEpisode ?? null,
      a.nextAiringAt ?? null,
      now,
    );
  }
  db.prepare(
    `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run('activeSeasonId', state.activeSeasonId ?? null, Date.now());
});

function writeAppState(state: AppState): void {
  writeAppStateTxn(state);
}

// ---- Collection -----------------------------------------------------------

interface CollectionRow {
  anilist_id: number;
  section: string;
  title: string;
  title_english: string | null;
  image_url: string | null;
  description: string | null;
  tags_json: string | null;
  format: string | null;
  episodes: number | null;
  average_score: number | null;
  start_year: number | null;
  start_month: number | null;
  start_day: number | null;
  added_at: number;
  tags_full: number | null;
  // From the JOINed anime_progress row (NULL when no progress saved yet).
  watch_status: string | null;
  episodes_watched: number | null;
  user_score: number | null;
}

function rowToCollectionEntry(r: CollectionRow): CollectionEntry {
  const startDate =
    r.start_year != null || r.start_month != null || r.start_day != null
      ? { year: r.start_year, month: r.start_month, day: r.start_day }
      : undefined;
  return {
    anilistId: r.anilist_id,
    section: r.section as CollectionSection,
    title: r.title,
    titleEnglish: r.title_english ?? undefined,
    imageUrl: r.image_url ?? '',
    description: r.description ?? undefined,
    tags: r.tags_json ? JSON.parse(r.tags_json) : [],
    format: r.format ?? undefined,
    episodes: r.episodes ?? undefined,
    averageScore: r.average_score ?? undefined,
    startDate,
    addedAt: r.added_at,
    tagsFull: r.tags_full ? true : false,
    watchStatus: (r.watch_status as WatchStatus | null) ?? undefined,
    episodesWatched: r.episodes_watched ?? undefined,
    userScore: r.user_score ?? undefined,
  };
}

function readCollection(): CollectionEntry[] {
  // LEFT JOIN with anime_progress so watch status / episodes / user_score
  // ride along on each collection entry. Unbound collection rows
  // (anilist_id = 0) get NULLs since the JOIN can't match.
  const rows = db
    .prepare(
      `SELECT
         c.*,
         ap.watch_status,
         ap.episodes_watched,
         ap.user_score
       FROM collection c
       LEFT JOIN anime_progress ap
         ON c.anilist_id > 0 AND ap.anilist_id = c.anilist_id`,
    )
    .all() as CollectionRow[];
  return rows.map(rowToCollectionEntry);
}

const writeCollectionTxn = db.transaction((items: CollectionEntry[]) => {
  db.prepare('DELETE FROM collection').run();
  const ins = db.prepare(`
    INSERT INTO collection
      (anilist_id, section, title, title_english, image_url, description,
       tags_json, format, episodes, average_score, start_year, start_month, start_day, added_at, tags_full)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const e of items) {
    ins.run(
      e.anilistId,
      e.section,
      e.title,
      e.titleEnglish ?? null,
      e.imageUrl ?? null,
      e.description ?? null,
      JSON.stringify(e.tags ?? []),
      e.format ?? null,
      e.episodes ?? null,
      e.averageScore ?? null,
      e.startDate?.year ?? null,
      e.startDate?.month ?? null,
      e.startDate?.day ?? null,
      e.addedAt,
      e.tagsFull ? 1 : 0,
    );
  }
  // Persist watch_status / episodes_watched / user_score into anime_progress
  // so collection-card edits survive a reload. ON CONFLICT only touches the
  // three columns owned by the collection — total_episodes / next_airing_*
  // belong to writeAppState and stay untouched here. The same anilist_id can
  // appear twice (Favorites + Interested); broadcast keeps them identical,
  // so we dedupe to avoid two redundant upserts.
  const upsertProgress = db.prepare(
    `INSERT INTO anime_progress
       (anilist_id, watch_status, episodes_watched, user_score, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(anilist_id) DO UPDATE SET
       watch_status     = excluded.watch_status,
       episodes_watched = excluded.episodes_watched,
       user_score       = excluded.user_score,
       updated_at       = excluded.updated_at`,
  );
  const now = Date.now();
  const seen = new Set<number>();
  for (const e of items) {
    if (!e.anilistId || e.anilistId <= 0 || seen.has(e.anilistId)) continue;
    seen.add(e.anilistId);
    upsertProgress.run(
      e.anilistId,
      e.watchStatus ?? null,
      e.episodesWatched ?? null,
      e.userScore ?? null,
      now,
    );
  }
});

function writeCollection(items: CollectionEntry[]): void {
  writeCollectionTxn(items);
}

// ---- Discover cache -------------------------------------------------------

interface DiscoverRow {
  id: number;
  season: string;
  year: number;
  tags_json: string;
  fetched_at: number;
  items_json: string;
}

function readDiscoverCache(): DiscoverCache {
  const rows = db
    .prepare('SELECT * FROM discover_cache ORDER BY fetched_at DESC')
    .all() as DiscoverRow[];
  const entries: DiscoverCacheEntry[] = rows.map((r) => ({
    // 'ALL' is the sentinel for "no season filter (full year)". The column
    // is NOT NULL so we can't store SQL null without a table rebuild.
    season: (r.season === 'ALL' ? null : r.season) as DiscoverCacheEntry['season'],
    year: r.year,
    tags: JSON.parse(r.tags_json) as string[],
    fetchedAt: r.fetched_at,
    items: JSON.parse(r.items_json) as DiscoverItem[],
  }));
  return { entries };
}

const writeDiscoverTxn = db.transaction((cache: DiscoverCache) => {
  db.prepare('DELETE FROM discover_cache').run();
  const ins = db.prepare(`
    INSERT INTO discover_cache (season, year, tags_json, fetched_at, items_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const e of cache.entries) {
    ins.run(
      e.season ?? 'ALL',
      e.year,
      JSON.stringify(e.tags),
      e.fetchedAt,
      JSON.stringify(e.items),
    );
  }
});

function writeDiscoverCache(cache: DiscoverCache): void {
  writeDiscoverTxn(cache);
}

// ---- Simple key-value pairs (tags cache, h prefs) -------------------

function readKv(key: string): unknown | null {
  const row = db
    .prepare('SELECT value FROM kv_store WHERE key = ?')
    .get(key) as { value: string | null } | undefined;
  if (!row || row.value == null) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

function writeKv(key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), Date.now());
}

// ---- H favorites -----------------------------------------------------

interface HFavoriteRow {
  anilist_id: number;
  title: string;
  title_english: string | null;
  image_url: string | null;
  description: string | null;
  tags_json: string | null;
  format: string | null;
  episodes: number | null;
  average_score: number | null;
  start_year: number | null;
  start_month: number | null;
  start_day: number | null;
  added_at: number;
}

function readHFavorites(): HFavoriteEntry[] {
  const rows = db
    .prepare('SELECT * FROM h_favorites ORDER BY added_at DESC')
    .all() as HFavoriteRow[];
  return rows.map((r) => {
    const startDate =
      r.start_year != null || r.start_month != null || r.start_day != null
        ? { year: r.start_year, month: r.start_month, day: r.start_day }
        : undefined;
    return {
      anilistId: r.anilist_id,
      title: r.title,
      titleEnglish: r.title_english ?? undefined,
      imageUrl: r.image_url ?? '',
      description: r.description ?? undefined,
      tags: r.tags_json ? JSON.parse(r.tags_json) : [],
      format: r.format ?? undefined,
      episodes: r.episodes ?? undefined,
      averageScore: r.average_score ?? undefined,
      startDate,
      addedAt: r.added_at,
    };
  });
}

const writeHFavoritesTxn = db.transaction((items: HFavoriteEntry[]) => {
  db.prepare('DELETE FROM h_favorites').run();
  const ins = db.prepare(`
    INSERT INTO h_favorites
      (anilist_id, title, title_english, image_url, description, tags_json,
       format, episodes, average_score, start_year, start_month, start_day, added_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const e of items) {
    ins.run(
      e.anilistId,
      e.title,
      e.titleEnglish ?? null,
      e.imageUrl ?? null,
      e.description ?? null,
      JSON.stringify(e.tags ?? []),
      e.format ?? null,
      e.episodes ?? null,
      e.averageScore ?? null,
      e.startDate?.year ?? null,
      e.startDate?.month ?? null,
      e.startDate?.day ?? null,
      e.addedAt,
    );
  }
});

function writeHFavorites(items: HFavoriteEntry[]): void {
  writeHFavoritesTxn(items);
}

// ---- Public router for the API route --------------------------------------

// ---- Backup helper -------------------------------------------------------
//
// Returns a point-in-time snapshot of the SQLite DB as a Buffer, suitable
// for streaming to the user as a download. The WAL checkpoint forces any
// in-flight writes into the main .db file before we read it, so the buffer
// is self-contained — no .db-wal/.db-shm sidecars needed to restore from it.

export function readDbSnapshot(): { path: string; buffer: Buffer } {
  db.pragma('wal_checkpoint(TRUNCATE)');
  return { path: DB_PATH, buffer: readFileSync(DB_PATH) };
}

export type DbKey =
  | 'state'
  | 'collection'
  | 'discover-cache'
  | 'tags'
  | 'h-prefs'
  | 'h-favorites';

export function readByKey(key: DbKey): unknown {
  switch (key) {
    case 'state':
      return readAppState();
    case 'collection':
      return readCollection();
    case 'discover-cache':
      return readDiscoverCache();
    case 'tags':
      return readKv('tags') as AnilistTag[] | null;
    case 'h-prefs':
      return readKv('h-prefs') as HPrefs | null;
    case 'h-favorites':
      return readHFavorites();
  }
}

export function writeByKey(key: DbKey, value: unknown): void {
  switch (key) {
    case 'state':
      writeAppState(value as AppState);
      return;
    case 'collection':
      writeCollection(value as CollectionEntry[]);
      return;
    case 'discover-cache':
      writeDiscoverCache(value as DiscoverCache);
      return;
    case 'tags':
      writeKv('tags', value);
      return;
    case 'h-prefs':
      writeKv('h-prefs', value);
      return;
    case 'h-favorites':
      writeHFavorites(value as HFavoriteEntry[]);
      return;
  }
}

// ---- One-time migration from JSON files (if present) ---------------------
const LEGACY_JSON: Record<string, DbKey> = {
  'state.json': 'state',
  'collection.json': 'collection',
  'discover-cache.json': 'discover-cache',
  'tags.json': 'tags',
  'hentai-prefs.json': 'h-prefs',
};

// Idempotent: successfully-ingested files are renamed to .imported, so a
// second pass on the same dataset is a no-op.
for (const [file, key] of Object.entries(LEGACY_JSON)) {
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) continue;
  try {
    const text = readFileSync(path, 'utf-8');
    if (!text || text === 'null') {
      renameSync(path, path + '.imported');
      continue;
    }
    const data = JSON.parse(text);
    writeByKey(key, data);
    renameSync(path, path + '.imported');
    console.info(`[db] Imported legacy ${file} into anime-tracker.db`);
  } catch (err) {
    console.warn(`[db] Failed to migrate ${file}:`, err);
  }
}
