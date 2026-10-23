-- Clean-up: data no screen shows any more, and what one-time upgrades left
-- behind. Backups made before this name the dropped columns, so they no
-- longer restore.

-- The Collection shows your own score, and a show's page loads its synopsis
-- fresh from AniList.
ALTER TABLE collection DROP COLUMN description;
ALTER TABLE collection DROP COLUMN average_score;

-- Links typed on schedule rows before stream_links existed; they were all
-- copied there. Rows not matched on AniList keep theirs.
UPDATE anime_entries SET platform = '', platform_url = ''
WHERE anilist_id > 0 AND (COALESCE(platform, '') != '' OR COALESCE(platform_url, '') != '');

-- "Already done" flags of upgrades that no longer exist.
DELETE FROM kv_store WHERE key IN ('discover-cache-airing-cleared-v1', 'stream-links-migrated-v1');
