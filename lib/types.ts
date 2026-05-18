export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

/** AniList-style watch progress. `undefined` on AnimeEntry means "not set yet". */
export type WatchStatus =
  | 'WATCHING'
  | 'COMPLETED'
  | 'DROPPED'
  | 'ON_HOLD'
  | 'PLAN';

export interface AnimeEntry {
  id: string;
  anilistId: number;
  title: string;
  titleEnglish?: string;
  imageUrl: string;
  day: DayOfWeek | null;
  time: string;
  platform: string;
  platformUrl: string;
  /** Free-text user note (e.g. "peak", "ดอง"). Independent of watchStatus. */
  status: string;
  /** Tracked watch state. Auto-flips: PLAN/undefined → WATCHING on first +,
   *  WATCHING → COMPLETED when episodesWatched reaches totalEpisodes. */
  watchStatus?: WatchStatus;
  /** Episodes the user has watched. Defaults to 0 when undefined. */
  episodesWatched?: number;
  /** Total episode count cached from AniList at add-time. Unknown for older
   *  entries — they'll show just the watched count without a denominator. */
  totalEpisodes?: number;
  /** Next-airing episode number (cached). Lets the card compute "ep N aired"
   *  and a "X behind" delta vs episodesWatched. Stale once nextAiringAt < now;
   *  the schedule view triggers a batched refresh against AniList. */
  nextAiringEpisode?: number;
  /** Unix-seconds timestamp for when `nextAiringEpisode` airs. */
  nextAiringAt?: number;
  addedAt: number;
}

export interface Season {
  id: string;
  name: string;
  createdAt: number;
  animes: AnimeEntry[];
}

export interface AppState {
  seasons: Season[];
  activeSeasonId: string | null;
}

export interface AnilistMedia {
  id: number;
  title: {
    romaji: string;
    english: string | null;
    native: string | null;
  };
  coverImage: {
    large: string;
    medium: string;
  };
  format?: string | null;
  episodes?: number | null;
  averageScore?: number | null;
  genres?: string[];
  description?: string | null;
  tags?: { name: string; rank: number; isAdult?: boolean; isMediaSpoiler?: boolean }[];
  startDate?: { year: number | null; month: number | null; day: number | null } | null;
  /** AniList's upcoming-episode field — only present for shows currently
   *  airing (RELEASING). Null for FINISHED / NOT_YET_RELEASED / CANCELLED. */
  nextAiringEpisode?: { episode: number; airingAt: number } | null;
}

export interface ReleaseDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

export type AnimeSeason = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';

export interface AnimeSeasonRef {
  season: AnimeSeason;
  year: number;
  name: string;
}

export interface DiscoverItem {
  anilistId: number;
  title: string;
  titleEnglish?: string;
  imageUrl: string;
  description?: string;
  tags: string[];
  format?: string;
  episodes?: number;
  averageScore?: number;
  startDate?: ReleaseDate | null;
  /** Carries airing data through to the schedule card when added from Discover,
   *  so the "X behind" indicator works immediately without a fresh API call. */
  nextAiringEpisode?: number;
  nextAiringAt?: number;
}

export interface DiscoverCacheEntry {
  fetchedAt: number;
  /** null = "all seasons of this year" — the dropdown's blank option. */
  season: AnimeSeason | null;
  year: number;
  tags: string[];
  items: DiscoverItem[];
}

export interface DiscoverCache {
  /** LRU-ordered, most-recently-used first. Capped to a small N (e.g. 4). */
  entries: DiscoverCacheEntry[];
}

export type DiscoverVariant = 'season' | 'h' | 'collection';

export type AppView =
  | 'schedule'
  | 'discover-season'
  | 'discover-h'
  | 'h-favorites'
  | 'collection-favorites'
  | 'collection-interested';

/** H favorites live in their own DB table — separate from CollectionEntry. */
export interface HFavoriteEntry extends DiscoverItem {
  addedAt: number;
}

export type CollectionSection = 'favorites' | 'interested';

export interface CollectionEntry extends DiscoverItem {
  addedAt: number;
  section: CollectionSection;
  startDate?: ReleaseDate | null;
  /** True when `tags` holds the FULL tag list (not just top 5).
   *  Older entries lack this flag → enrichment job fetches the full list. */
  tagsFull?: boolean;
}

export type CollectionSort =
  | 'RELEASED_NEW'
  | 'RELEASED_OLD'
  | 'ADDED_NEW'
  | 'ADDED_OLD'
  | 'TITLE_AZ'
  | 'TITLE_ZA'
  | 'SCORE_DESC';

export interface AnilistTag {
  id: number;
  name: string;
  category: string | null;
  isAdult: boolean;
}

export type HDateSort = 'NEW' | 'OLD' | null;
export type HPopularitySort = 'POPULAR' | 'LEAST_POPULAR' | null;

export interface HPrefs {
  dateSort: HDateSort;
  popularitySort: HPopularitySort;
  tags: string[];
  excludeUnreleased: boolean;
}

export interface AnilistSearchResponse {
  data: {
    Page: {
      media: AnilistMedia[];
    };
  };
  errors?: { message: string }[];
}
