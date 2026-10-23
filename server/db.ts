// Server-side only. Lives under server/ so it can't be imported from the
// client by accident. Types are shared with the frontend via @/lib/types.
//
// Storage logic, written against the SqlDb interface (server/sql.ts) so it
// runs unchanged on local SQLite and on Cloudflare D1 — no Node APIs in here.
// The schema is migrations/*.sql, for both.
//
// Every write takes the client's whole value for a key, but only writes the
// rows that differ from what's stored: ticking one episode writes one row
// rather than rewriting every table it touches.
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
  AnilistLinksCache,
  StreamLink,
  StreamLinksMap,
  WatchStatus,
} from '../src/lib/types';
import {
  deleteRowsNotIn,
  sql,
  upsertRows,
  type SqlDb,
  type SqlStatement,
  type SqlValue,
  type TableSpec,
} from './sql';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function kvStatement(key: string, value: string | null): SqlStatement {
  return sql(
    `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
     WHERE kv_store.value IS NOT excluded.value`,
    key,
    value,
    Date.now(),
  );
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

const SEASONS: TableSpec = {
  table: 'seasons',
  cols: ['id', 'name', 'created_at'],
  key: ['id'],
};
const ANIME_ENTRIES: TableSpec = {
  table: 'anime_entries',
  cols: [
    'id', 'season_id', 'anilist_id', 'title', 'title_english', 'image_url', 'day', 'time',
    'platform', 'platform_url', 'status', 'added_at', 'watch_status', 'episodes_watched',
    'total_episodes', 'next_airing_episode', 'next_airing_at', 'format', 'position',
  ],
  key: ['id'],
};
// The progress columns the schedule owns. user_score belongs to the
// collection and is left as it is.
const SCHEDULE_PROGRESS: TableSpec = {
  table: 'anime_progress',
  cols: [
    'anilist_id', 'watch_status', 'episodes_watched', 'total_episodes',
    'next_airing_episode', 'next_airing_at', 'updated_at',
  ],
  key: ['anilist_id'],
  touch: ['updated_at'],
};

async function readAppState(db: SqlDb): Promise<AppState | null> {
  const seasonsRows = await db.all<SeasonRow>('SELECT * FROM seasons ORDER BY created_at ASC');
  if (seasonsRows.length === 0) return null;
  // LEFT JOIN with anime_progress so shows that span multiple seasons read
  // the same watch progress. COALESCE: progress table wins when present;
  // anime_entries columns are the fallback for unbound entries (anilist_id 0,
  // typically xlsx imports that didn't match on AniList).
  const animesRows = await db.all<AnimeRow>(
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
       ON ae.anilist_id > 0 AND ap.anilist_id = ae.anilist_id
     ORDER BY ae.position, ae.rowid`,
  );

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

  const activeRow = await db.first<{ value: string | null }>(
    'SELECT value FROM kv_store WHERE key = ?',
    'activeSeasonId',
  );
  const activeSeasonId = activeRow?.value || null;

  return { seasons, activeSeasonId };
}

async function writeAppState(db: SqlDb, state: AppState): Promise<number> {
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
  const seasons: SqlValue[][] = [];
  const animes: SqlValue[][] = [];
  for (const s of state.seasons) {
    seasons.push([s.id, s.name, s.createdAt]);
    s.animes.forEach((a, position) => {
      // For bound entries (anilist_id > 0) the watch fields are owned by
      // anime_progress, so we null them here to keep the source-of-truth
      // singular. For unbound entries (anilist_id = 0) the columns ARE
      // the source of truth — anime_progress has nothing to JOIN against.
      const bound = (a.anilistId ?? 0) > 0;
      animes.push([
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
        position,
      ]);
    });
  }
  // One progress row per unique anilist_id. Never deleted — orphaned rows
  // (shows no longer in any season) are harmless and re-adding the show
  // later restores the user's progress.
  const now = Date.now();
  const progress: SqlValue[][] = [...progressByAnilistId].map(([anilistId, a]) => [
    anilistId,
    a.watchStatus ?? null,
    a.episodesWatched ?? null,
    a.totalEpisodes ?? null,
    a.nextAiringEpisode ?? null,
    a.nextAiringAt ?? null,
    now,
  ]);
  // Order matters for the season foreign key: seasons exist before entries
  // point at them, and entries leave a season (deleted or moved) before the
  // season itself is deleted.
  return db.batch([
    ...upsertRows(SEASONS, seasons),
    deleteRowsNotIn(ANIME_ENTRIES, animes),
    ...upsertRows(ANIME_ENTRIES, animes),
    deleteRowsNotIn(SEASONS, seasons),
    ...upsertRows(SCHEDULE_PROGRESS, progress),
    kvStatement('activeSeasonId', state.activeSeasonId ?? null),
  ]);
}

// ---- Collection -----------------------------------------------------------

interface CollectionRow {
  anilist_id: number;
  section: string;
  title: string;
  title_english: string | null;
  image_url: string | null;
  tags_json: string | null;
  format: string | null;
  episodes: number | null;
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

const COLLECTION: TableSpec = {
  table: 'collection',
  cols: [
    'anilist_id', 'section', 'title', 'title_english', 'image_url', 'tags_json', 'format',
    'episodes', 'start_year', 'start_month', 'start_day', 'added_at', 'tags_full', 'position',
  ],
  key: ['anilist_id', 'section'],
};
// The progress columns the collection owns. total_episodes / next_airing_*
// belong to the schedule and are left as they are.
const COLLECTION_PROGRESS: TableSpec = {
  table: 'anime_progress',
  cols: ['anilist_id', 'watch_status', 'episodes_watched', 'user_score', 'updated_at'],
  key: ['anilist_id'],
  touch: ['updated_at'],
};

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
    tags: r.tags_json ? JSON.parse(r.tags_json) : [],
    format: r.format ?? undefined,
    episodes: r.episodes ?? undefined,
    startDate,
    addedAt: r.added_at,
    tagsFull: r.tags_full ? true : false,
    watchStatus: (r.watch_status as WatchStatus | null) ?? undefined,
    episodesWatched: r.episodes_watched ?? undefined,
    userScore: r.user_score ?? undefined,
  };
}

async function readCollection(db: SqlDb): Promise<CollectionEntry[]> {
  // LEFT JOIN with anime_progress so watch status / episodes / user_score
  // ride along on each collection entry. Unbound collection rows
  // (anilist_id = 0) get NULLs since the JOIN can't match.
  const rows = await db.all<CollectionRow>(
    `SELECT
       c.*,
       ap.watch_status,
       ap.episodes_watched,
       ap.user_score
     FROM collection c
     LEFT JOIN anime_progress ap
       ON c.anilist_id > 0 AND ap.anilist_id = c.anilist_id
     ORDER BY c.position, c.rowid`,
  );
  return rows.map(rowToCollectionEntry);
}

async function writeCollection(db: SqlDb, items: CollectionEntry[]): Promise<number> {
  const rows: SqlValue[][] = items.map((e, position) => [
    e.anilistId,
    e.section,
    e.title,
    e.titleEnglish ?? null,
    e.imageUrl ?? null,
    JSON.stringify(e.tags ?? []),
    e.format ?? null,
    e.episodes ?? null,
    e.startDate?.year ?? null,
    e.startDate?.month ?? null,
    e.startDate?.day ?? null,
    e.addedAt,
    e.tagsFull ? 1 : 0,
    position,
  ]);
  // Persist watch_status / episodes_watched / user_score into anime_progress
  // so collection-card edits survive a reload. The same anilist_id can
  // appear twice (Favorites + Interested); broadcast keeps them identical,
  // so we dedupe to avoid two redundant upserts.
  const now = Date.now();
  const seen = new Set<number>();
  const progress: SqlValue[][] = [];
  for (const e of items) {
    if (!e.anilistId || e.anilistId <= 0 || seen.has(e.anilistId)) continue;
    seen.add(e.anilistId);
    progress.push([e.anilistId, e.watchStatus ?? null, e.episodesWatched ?? null, e.userScore ?? null, now]);
  }
  return db.batch([
    deleteRowsNotIn(COLLECTION, rows),
    ...upsertRows(COLLECTION, rows),
    ...upsertRows(COLLECTION_PROGRESS, progress),
  ]);
}

// ---- Stream links ---------------------------------------------------------

const STREAM_LINKS: TableSpec = {
  table: 'stream_links',
  cols: ['anilist_id', 'position', 'site', 'url', 'created_at'],
  key: ['anilist_id', 'position'],
  insertOnly: ['created_at'],
};

/** { [anilistId]: StreamLink[] } in the user's order. */
async function readStreamLinks(db: SqlDb): Promise<StreamLinksMap> {
  const rows = await db.all<{ anilist_id: number; site: string; url: string }>(
    'SELECT anilist_id, site, url FROM stream_links ORDER BY anilist_id, position',
  );
  const out: StreamLinksMap = {};
  for (const r of rows) (out[r.anilist_id] ??= []).push({ site: r.site, url: r.url });
  return out;
}

async function writeStreamLinks(db: SqlDb, map: StreamLinksMap): Promise<number> {
  // The incoming map as the table stores it: per show, links in order,
  // blank URLs dropped, one link per URL (the first one wins).
  const wanted = new Map<number, StreamLink[]>();
  for (const [key, links] of Object.entries(map ?? {})) {
    const anilistId = Number(key);
    if (!Number.isInteger(anilistId) || anilistId <= 0 || !Array.isArray(links)) continue;
    const list: StreamLink[] = [];
    for (const l of links as StreamLink[]) {
      const url = typeof l?.url === 'string' ? l.url.trim() : '';
      if (!url || list.some((x) => x.url === url)) continue;
      list.push({ site: (typeof l.site === 'string' && l.site.trim()) || hostOf(url), url });
    }
    if (list.length) wanted.set(anilistId, list);
  }

  const stored = new Map<number, { site: string; url: string }[]>();
  // Keep each link's original created_at when its show is rewritten.
  const created = new Map<string, number>();
  for (const r of await db.all<{ anilist_id: number; site: string; url: string; created_at: number }>(
    'SELECT anilist_id, site, url, created_at FROM stream_links ORDER BY anilist_id, position',
  )) {
    const list = stored.get(r.anilist_id) ?? [];
    list.push(r);
    stored.set(r.anilist_id, list);
    created.set(`${r.anilist_id} ${r.url}`, r.created_at);
  }

  // A show whose list changed in any way is rewritten as a whole: moving a
  // link shifts the positions of the others, and rewriting row by row would
  // trip the one-row-per-URL constraint halfway through.
  const changed = [...new Set([...stored.keys(), ...wanted.keys()])].filter((id) => {
    const a = stored.get(id) ?? [];
    const b = wanted.get(id) ?? [];
    return a.length !== b.length || a.some((l, i) => l.site !== b[i].site || l.url !== b[i].url);
  });
  if (changed.length === 0) return 0;
  const now = Date.now();
  const rows: SqlValue[][] = changed.flatMap((id) =>
    (wanted.get(id) ?? []).map((l, position) => [
      id,
      position,
      l.site,
      l.url,
      created.get(`${id} ${l.url}`) ?? now,
    ]),
  );
  return db.batch([
    sql('DELETE FROM stream_links WHERE anilist_id IN (SELECT value FROM json_each(?))', JSON.stringify(changed)),
    ...upsertRows(STREAM_LINKS, rows),
  ]);
}

// ---- AniList link cache -----------------------------------------------------

const ANILIST_LINKS: TableSpec = {
  table: 'anilist_link_cache',
  cols: ['anilist_id', 'fetched_at', 'links_json'],
  key: ['anilist_id'],
};

async function readAnilistLinks(db: SqlDb): Promise<AnilistLinksCache> {
  const rows = await db.all<{ anilist_id: number; fetched_at: number; links_json: string }>(
    'SELECT anilist_id, fetched_at, links_json FROM anilist_link_cache',
  );
  const out: AnilistLinksCache = {};
  for (const r of rows) {
    try {
      out[r.anilist_id] = { at: r.fetched_at, links: JSON.parse(r.links_json) as StreamLink[] };
    } catch {
      // A corrupt row just gets refetched.
    }
  }
  return out;
}

async function writeAnilistLinks(db: SqlDb, map: AnilistLinksCache): Promise<number> {
  const rows: SqlValue[][] = [];
  for (const [key, v] of Object.entries(map ?? {})) {
    const id = Number(key);
    if (!Number.isInteger(id) || id <= 0 || !v || !Array.isArray(v.links)) continue;
    const links = v.links
      .filter((l) => l && typeof l.url === 'string' && typeof l.site === 'string')
      .map((l) => ({ site: l.site, url: l.url, icon: l.icon, color: l.color, fromAnilist: true }));
    rows.push([id, Number(v.at) || Date.now(), JSON.stringify(links)]);
  }
  return db.batch([deleteRowsNotIn(ANILIST_LINKS, rows), ...upsertRows(ANILIST_LINKS, rows)]);
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

async function readDiscoverCache(db: SqlDb): Promise<DiscoverCache> {
  const rows = await db.all<DiscoverRow>('SELECT * FROM discover_cache ORDER BY fetched_at DESC');
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

async function writeDiscoverCache(db: SqlDb, cache: DiscoverCache): Promise<number> {
  // Entries are replaced, never edited: each incoming entry is either stored
  // exactly as it is already, or new. Rows no entry claimed are dropped.
  const unclaimed = new Map((await db.all<DiscoverRow>('SELECT * FROM discover_cache')).map((r) => [r.id, r]));
  const inserts: SqlStatement[] = [];
  for (const e of cache.entries) {
    const season = e.season ?? 'ALL';
    const tags = JSON.stringify(e.tags);
    const items = JSON.stringify(e.items);
    const match = [...unclaimed.values()].find(
      (r) =>
        r.season === season &&
        r.year === e.year &&
        r.tags_json === tags &&
        r.fetched_at === e.fetchedAt &&
        r.items_json === items,
    );
    if (match) {
      unclaimed.delete(match.id);
      continue;
    }
    inserts.push(
      sql(
        `INSERT INTO discover_cache (season, year, tags_json, fetched_at, items_json)
         VALUES (?, ?, ?, ?, ?)`,
        season,
        e.year,
        tags,
        e.fetchedAt,
        items,
      ),
    );
  }
  if (unclaimed.size === 0 && inserts.length === 0) return 0;
  return db.batch([
    sql('DELETE FROM discover_cache WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify([...unclaimed.keys()])),
    ...inserts,
  ]);
}

// ---- Simple key-value pairs (tags cache, h prefs) -------------------

async function readKv(db: SqlDb, key: string): Promise<unknown | null> {
  const row = await db.first<{ value: string | null }>('SELECT value FROM kv_store WHERE key = ?', key);
  if (!row || row.value == null) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

async function writeKv(db: SqlDb, key: string, value: unknown): Promise<number> {
  return db.batch([kvStatement(key, JSON.stringify(value))]);
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

const H_FAVORITES: TableSpec = {
  table: 'h_favorites',
  cols: [
    'anilist_id', 'title', 'title_english', 'image_url', 'description', 'tags_json', 'format',
    'episodes', 'average_score', 'start_year', 'start_month', 'start_day', 'added_at',
  ],
  key: ['anilist_id'],
};

async function readHFavorites(db: SqlDb): Promise<HFavoriteEntry[]> {
  const rows = await db.all<HFavoriteRow>('SELECT * FROM h_favorites ORDER BY added_at DESC');
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

async function writeHFavorites(db: SqlDb, items: HFavoriteEntry[]): Promise<number> {
  const rows: SqlValue[][] = items.map((e) => [
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
  ]);
  return db.batch([deleteRowsNotIn(H_FAVORITES, rows), ...upsertRows(H_FAVORITES, rows)]);
}

// ---- Public router for the API route --------------------------------------

export type DbKey =
  | 'state'
  | 'collection'
  | 'discover-cache'
  | 'tags'
  | 'h-prefs'
  | 'h-favorites'
  | 'stream-links'
  | 'anilist-links'
  | 'link-sources';

export async function readByKey(db: SqlDb, key: DbKey): Promise<unknown> {
  switch (key) {
    case 'state':
      return readAppState(db);
    case 'collection':
      return readCollection(db);
    case 'discover-cache':
      return readDiscoverCache(db);
    case 'tags':
      return (await readKv(db, 'tags')) as AnilistTag[] | null;
    case 'h-prefs':
      return (await readKv(db, 'h-prefs')) as HPrefs | null;
    case 'h-favorites':
      return readHFavorites(db);
    case 'stream-links':
      return readStreamLinks(db);
    case 'anilist-links':
      return readAnilistLinks(db);
    case 'link-sources':
      return readKv(db, 'link-sources');
  }
}

/** Resolves to the number of rows the write changed. */
export async function writeByKey(db: SqlDb, key: DbKey, value: unknown): Promise<number> {
  switch (key) {
    case 'state':
      return writeAppState(db, value as AppState);
    case 'collection':
      return writeCollection(db, value as CollectionEntry[]);
    case 'discover-cache':
      return writeDiscoverCache(db, value as DiscoverCache);
    case 'tags':
      return writeKv(db, 'tags', value);
    case 'h-prefs':
      return writeKv(db, 'h-prefs', value);
    case 'h-favorites':
      return writeHFavorites(db, value as HFavoriteEntry[]);
    case 'stream-links':
      return writeStreamLinks(db, value as StreamLinksMap);
    case 'anilist-links':
      return writeAnilistLinks(db, value as AnilistLinksCache);
    case 'link-sources':
      return writeKv(db, 'link-sources', value);
  }
}
