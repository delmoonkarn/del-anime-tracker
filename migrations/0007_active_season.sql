-- The schedule's season is now part of each tab's address (/schedule/...),
-- so the last-used season is no longer stored.
DELETE FROM kv_store WHERE key = 'activeSeasonId';
