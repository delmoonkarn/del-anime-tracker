// Node-only side of storage: opens the local SQLite file with
// better-sqlite3, brings databases from older versions up to the current
// schema, and adapts the connection to the SqlDb interface the storage layer
// (server/db.ts) is written against.
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hostOf, type DbKey } from './db';
import type { SqlDb, SqlStatement } from './sql';

export interface LocalDb {
  db: SqlDb;
  /**
   * Point-in-time copy of the .db file, for the download-backup route. The
   * WAL checkpoint forces any in-flight writes into the main .db file before
   * we read it, so the buffer is self-contained — no .db-wal/.db-shm
   * sidecars needed to restore from it.
   */
  snapshot(): Buffer;
}

export function openSqlite(dbPath: string): LocalDb {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);

  // The storage layer issues the same few dozen statements over and over,
  // so prepare each one once.
  const prepared = new Map<string, Database.Statement>();
  const prepare = (text: string): Database.Statement => {
    let stmt = prepared.get(text);
    if (!stmt) {
      stmt = db.prepare(text);
      prepared.set(text, stmt);
    }
    return stmt;
  };
  const runBatch = db.transaction((statements: SqlStatement[]) => {
    let changes = 0;
    for (const s of statements) changes += prepare(s.sql).run(...s.params).changes;
    return changes;
  });

  return {
    db: {
      async all<T>(text: string, ...params: (string | number | null)[]) {
        return prepare(text).all(...params) as T[];
      },
      async first<T>(text: string, ...params: (string | number | null)[]) {
        return (prepare(text).get(...params) as T | undefined) ?? null;
      },
      async batch(statements: SqlStatement[]) {
        return statements.length ? runBatch(statements) : 0;
      },
    },
    snapshot() {
      db.pragma('wal_checkpoint(TRUNCATE)');
      return readFileSync(dbPath);
    },
  };
}

// ---- Schema ---------------------------------------------------------------

function migrate(db: Database.Database): void {
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

    /* "Where to watch" links, keyed by AniList ID like anime_progress: one
       show can have many links (Netflix + Bilibili + ...), and every schedule
       row / collection row for that show shares them. position keeps the
       order the user put them in. Unbound schedule rows (anilist_id = 0) keep
       using anime_entries.platform / platform_url instead. */
    CREATE TABLE IF NOT EXISTS stream_links (
      anilist_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      site TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (anilist_id, position),
      UNIQUE (anilist_id, url)
    );

    /* Cache of AniList's streaming links, one row per show (links as JSON,
       already filtered: STREAMING only, no official site / Twitter / X, one
       per service). Derived data: safe to clear; fetched_at drives the
       weekly refresh. Shows AniList has no links for keep an empty row so
       they aren't asked for again until it's stale. */
    CREATE TABLE IF NOT EXISTS anilist_link_cache (
      anilist_id INTEGER PRIMARY KEY,
      fetched_at INTEGER NOT NULL,
      links_json TEXT NOT NULL
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

  // `position` on anime_entries (order within the season) and collection:
  // saves used to delete and reinsert every row, so rowid order was the
  // saved order. Saves now only write rows that changed, so the order needs
  // its own column. NULL (not saved since this column was added) sorts
  // first, then rowid, which is exactly the order the old saves left.
  try {
    for (const table of ['anime_entries', 'collection']) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!cols.some((c) => c.name === 'position')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN position INTEGER`);
        console.info(`[db] added ${table}.position column`);
      }
    }
  } catch (err) {
    console.warn('[db] position migration skipped:', err);
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

  // One-shot copy of every bound schedule row's platform / platform_url into
  // stream_links (de-duplicated per show by URL). The anime_entries columns are
  // left as they are; the client stops using them for bound shows once the
  // show's links are edited. Gated by a kv_store flag so it runs once.
  try {
    const flagKey = 'stream-links-migrated-v1';
    const flag = db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(flagKey);
    if (!flag) {
      const rows = db
        .prepare(
          `SELECT anilist_id, platform, platform_url, added_at FROM anime_entries
           WHERE anilist_id > 0 AND platform_url IS NOT NULL AND TRIM(platform_url) != ''
           ORDER BY added_at ASC`,
        )
        .all() as { anilist_id: number; platform: string | null; platform_url: string; added_at: number }[];
      const nextPos = db.prepare(
        'SELECT COALESCE(MAX(position) + 1, 0) AS p FROM stream_links WHERE anilist_id = ?',
      );
      const ins = db.prepare(
        `INSERT OR IGNORE INTO stream_links (anilist_id, position, site, url, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      let copied = 0;
      db.transaction(() => {
        for (const r of rows) {
          const url = r.platform_url.trim();
          const site = r.platform?.trim() || hostOf(url);
          const { p } = nextPos.get(r.anilist_id) as { p: number };
          copied += ins.run(r.anilist_id, p, site, url, r.added_at).changes;
        }
        db.prepare(
          `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        ).run(flagKey, JSON.stringify(true), Date.now());
      })();
      if (copied > 0) console.info(`[db] copied ${copied} platform link(s) into stream_links`);
    }
  } catch (err) {
    console.warn('[db] stream_links migration skipped:', err);
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
export async function importLegacyJson(
  dataDir: string,
  write: (key: DbKey, value: unknown) => Promise<unknown>,
): Promise<void> {
  for (const [file, key] of Object.entries(LEGACY_JSON)) {
    const path = join(dataDir, file);
    if (!existsSync(path)) continue;
    try {
      const text = readFileSync(path, 'utf-8');
      if (!text || text === 'null') {
        renameSync(path, path + '.imported');
        continue;
      }
      const data = JSON.parse(text);
      await write(key, data);
      renameSync(path, path + '.imported');
      console.info(`[db] Imported legacy ${file} into anime-tracker.db`);
    } catch (err) {
      console.warn(`[db] Failed to migrate ${file}:`, err);
    }
  }
}
