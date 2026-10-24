-- H favorites now use the Collection's card: your watch status, episodes
-- and 1–5 score (kept in anime_progress), not AniList's synopsis and score.
ALTER TABLE h_favorites DROP COLUMN description;
ALTER TABLE h_favorites DROP COLUMN average_score;
