import type { AnilistMedia, DiscoverItem } from './types';

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function toDiscoverItem(m: AnilistMedia): DiscoverItem {
  const title = m.title.romaji || m.title.native || m.title.english || `#${m.id}`;
  const english = m.title.english && m.title.english !== title ? m.title.english : undefined;
  const description = m.description ? stripHtml(m.description) : undefined;
  // Keep the FULL tag list — the card decides how many to display. Filter
  // out adult/spoiler-flagged tags but keep everything else (sorted by rank).
  const tags = (m.tags ?? [])
    .filter((t) => !t.isAdult && !t.isMediaSpoiler)
    .sort((a, b) => b.rank - a.rank)
    .map((t) => t.name);
  return {
    anilistId: m.id,
    title,
    titleEnglish: english,
    imageUrl: m.coverImage.large || m.coverImage.medium,
    description: description || undefined,
    tags,
    format: m.format ?? undefined,
    episodes: m.episodes ?? undefined,
    averageScore: m.averageScore ?? undefined,
    startDate: m.startDate ?? undefined,
    nextAiringEpisode: m.nextAiringEpisode?.episode ?? undefined,
    nextAiringAt: m.nextAiringEpisode?.airingAt ?? undefined,
  };
}

/** Pulls the startDate (used for sorting collection entries). */
export function getReleaseDate(m: AnilistMedia) {
  return m.startDate ?? null;
}
