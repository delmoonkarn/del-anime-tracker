-- D1 schema for the cloud version. The local SQLite database gets the same
-- tables from server/sqlite.ts, which also upgrades databases created by
-- older versions; keep the two in step.

CREATE TABLE seasons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE anime_entries (
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
  added_at INTEGER NOT NULL,
  -- Watch fields for unbound rows (anilist_id = 0); bound rows use anime_progress.
  watch_status TEXT,
  episodes_watched INTEGER,
  total_episodes INTEGER,
  next_airing_episode INTEGER,
  next_airing_at INTEGER,
  format TEXT,
  -- Order within the season.
  position INTEGER
);
CREATE INDEX idx_anime_season ON anime_entries(season_id);

CREATE TABLE collection (
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
  tags_full INTEGER NOT NULL DEFAULT 0,
  position INTEGER,
  PRIMARY KEY (anilist_id, section)
);

CREATE TABLE discover_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season TEXT NOT NULL,
  year INTEGER NOT NULL,
  tags_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  items_json TEXT NOT NULL
);
CREATE INDEX idx_discover_lookup ON discover_cache(season, year);

CREATE TABLE kv_store (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL
);

-- H favorites — intentionally separate from collection.
CREATE TABLE h_favorites (
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

-- Watch progress + user score, one row per AniList show, shared by every
-- schedule row and collection card for that show.
CREATE TABLE anime_progress (
  anilist_id INTEGER PRIMARY KEY,
  watch_status TEXT,
  episodes_watched INTEGER,
  total_episodes INTEGER,
  next_airing_episode INTEGER,
  next_airing_at INTEGER,
  user_score INTEGER,
  updated_at INTEGER NOT NULL
);

-- "Where to watch" links per AniList show, in the user's order.
CREATE TABLE stream_links (
  anilist_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  site TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (anilist_id, position),
  UNIQUE (anilist_id, url)
);

-- Cache of AniList's streaming links, one row per show.
CREATE TABLE anilist_link_cache (
  anilist_id INTEGER PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  links_json TEXT NOT NULL
);
