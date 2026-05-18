import type {
  AnilistMedia,
  AnilistSearchResponse,
  AnilistTag,
  AnimeSeason,
  HDateSort,
  HPopularitySort,
} from './types';

const ENDPOINT = 'https://graphql.anilist.co';

const SEARCH_QUERY = `
query ($search: String) {
  Page(perPage: 5) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id
      title { romaji english native }
      coverImage { large medium }
      format
      episodes
      averageScore
      startDate { year month day }
      nextAiringEpisode { episode airingAt }
    }
  }
}`;

export class AnilistError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AnilistError';
    this.status = status;
  }
}

export async function searchAnime(
  query: string,
  signal?: AbortSignal,
): Promise<AnilistMedia[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query: SEARCH_QUERY, variables: { search: q } }),
    signal,
  });

  if (!res.ok) {
    const msg =
      res.status === 429
        ? 'Rate limited by AniList. Wait a few seconds and try again.'
        : res.status >= 500
          ? `AniList is unreachable right now (HTTP ${res.status}).`
          : `AniList returned HTTP ${res.status}.`;
    throw new AnilistError(msg, res.status);
  }

  const json = (await res.json()) as AnilistSearchResponse;
  if (json.errors && json.errors.length > 0) {
    throw new AnilistError(json.errors[0].message, 500);
  }
  return json.data.Page.media;
}

const MATCH_FIELDS = `{
  id
  title { romaji english native }
  coverImage { large medium }
  episodes
  startDate { year month day }
  nextAiringEpisode { episode airingAt }
}`;

function buildBatchQuery(count: number): string {
  const params: string[] = [];
  const fields: string[] = [];
  for (let i = 0; i < count; i++) {
    params.push(`$q${i}: String`);
    // Page(perPage: 1) instead of Media(...) — when an aliased Media has no
    // match, AniList returns HTTP 404 and kills the whole batch. Page returns
    // an empty `media` array per-alias instead, keeping the batch HTTP 200.
    fields.push(
      `q${i}: Page(perPage: 1) { media(search: $q${i}, type: ANIME, sort: [SEARCH_MATCH]) ${MATCH_FIELDS} }`,
    );
  }
  return `query (${params.join(', ')}) {\n${fields.join('\n')}\n}`;
}

/**
 * Looks up the top AniList match for each query in a single GraphQL request.
 * Returns one entry per query in input order; null where AniList had no match.
 * Tolerates per-query errors (e.g. "Not Found") via partial-data handling.
 */
export async function searchTopMatchBatch(
  queries: string[],
  signal?: AbortSignal,
): Promise<(AnilistMedia | null)[]> {
  if (queries.length === 0) return [];

  const variables: Record<string, string> = {};
  queries.forEach((q, i) => {
    variables[`q${i}`] = q;
  });

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query: buildBatchQuery(queries.length), variables }),
    signal,
  });

  if (!res.ok) {
    const msg =
      res.status === 429
        ? 'Rate limited by AniList. Wait a few seconds and try again.'
        : res.status >= 500
          ? `AniList is unreachable right now (HTTP ${res.status}).`
          : `AniList returned HTTP ${res.status}.`;
    throw new AnilistError(msg, res.status);
  }

  const json = (await res.json()) as {
    data?: Record<string, { media?: AnilistMedia[] } | null>;
    errors?: { message: string }[];
  };
  const data = json.data ?? {};
  return queries.map((_q, i) => data[`q${i}`]?.media?.[0] ?? null);
}

// Built dynamically so we can omit `season` and/or `tag_in` when the caller
// doesn't want those filters — passing null for the variables themselves
// triggers AniList 500s on the H endpoint, so we just leave them out.
function buildSeasonQuery(hasSeason: boolean, hasTagFilter: boolean): string {
  const params: string[] = [];
  if (hasSeason) params.push('$season: MediaSeason');
  params.push('$year: Int', '$page: Int');
  if (hasTagFilter) params.push('$tagsIn: [String]');
  const seasonClause = hasSeason ? 'season: $season, ' : '';
  const tagClause = hasTagFilter ? ', tag_in: $tagsIn' : '';
  return `
query (${params.join(', ')}) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage currentPage }
    media(${seasonClause}seasonYear: $year, type: ANIME, isAdult: false, sort: [POPULARITY_DESC]${tagClause}) {
      id
      title { romaji english native }
      coverImage { large medium }
      format
      episodes
      averageScore
      genres
      description(asHtml: false)
      tags { name rank isAdult isMediaSpoiler }
      startDate { year month day }
      nextAiringEpisode { episode airingAt }
    }
  }
}`;
}

export interface SeasonAnimeResult {
  media: AnilistMedia[];
  hasNextPage: boolean;
}

export async function getSeasonAnime(
  season: AnimeSeason | null,
  year: number,
  page = 1,
  tags?: string[],
  signal?: AbortSignal,
): Promise<SeasonAnimeResult> {
  const tagsIn = tags && tags.length > 0 ? tags : null;
  const hasSeason = season !== null;
  const variables: Record<string, unknown> = { year, page };
  if (hasSeason) variables.season = season;
  if (tagsIn) variables.tagsIn = tagsIn;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query: buildSeasonQuery(hasSeason, !!tagsIn),
      variables,
    }),
    signal,
  });

  if (!res.ok) {
    const msg =
      res.status === 429
        ? 'Rate limited by AniList. Wait a few seconds and try again.'
        : res.status >= 500
          ? `AniList is unreachable right now (HTTP ${res.status}).`
          : `AniList returned HTTP ${res.status}.`;
    throw new AnilistError(msg, res.status);
  }

  const json = (await res.json()) as {
    data?: { Page?: { pageInfo?: { hasNextPage: boolean }; media?: AnilistMedia[] } };
    errors?: { message: string }[];
  };
  if (json.errors && json.errors.length > 0) {
    throw new AnilistError(json.errors[0].message, 500);
  }
  return {
    media: json.data?.Page?.media ?? [],
    hasNextPage: !!json.data?.Page?.pageInfo?.hasNextPage,
  };
}

const TAGS_QUERY = `
query {
  MediaTagCollection { id name category isAdult }
}`;

export async function getAllTags(signal?: AbortSignal): Promise<AnilistTag[]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: TAGS_QUERY }),
    signal,
  });
  if (!res.ok) {
    throw new AnilistError(`AniList returned HTTP ${res.status}.`, res.status);
  }
  const json = (await res.json()) as { data?: { MediaTagCollection?: AnilistTag[] } };
  return json.data?.MediaTagCollection ?? [];
}

// Builds the h search query. The `status_not_in` arg is only injected
// when the user wants to exclude unreleased/cancelled — passing the variable
// as null (when the user has the checkbox off) triggers a server-side 500 on
// AniList, so we omit the arg entirely instead.
function buildHQuery(excludeUnreleased: boolean): string {
  const statusClause = excludeUnreleased
    ? ', status_not_in: [NOT_YET_RELEASED, CANCELLED]'
    : '';
  return `
query ($page: Int, $sort: [MediaSort], $tagsIn: [String], $search: String) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage currentPage }
    media(type: ANIME, isAdult: true, sort: $sort, tag_in: $tagsIn, search: $search${statusClause}) {
      id
      title { romaji english native }
      coverImage { large medium }
      format
      episodes
      averageScore
      season
      seasonYear
      description(asHtml: false)
      tags { name rank isAdult isMediaSpoiler }
    }
  }
}`;
}

function buildHSort(
  dateSort: HDateSort,
  popularitySort: HPopularitySort,
): string[] {
  // Popularity is primary; date is the tiebreaker when both are set.
  const out: string[] = [];
  if (popularitySort === 'POPULAR') out.push('POPULARITY_DESC');
  else if (popularitySort === 'LEAST_POPULAR') out.push('POPULARITY');
  if (dateSort === 'NEW') out.push('START_DATE_DESC');
  else if (dateSort === 'OLD') out.push('START_DATE');
  // AniList requires at least one sort key; fall back to popularity desc.
  return out.length > 0 ? out : ['POPULARITY_DESC'];
}

export async function getHAnime(opts: {
  page?: number;
  dateSort?: HDateSort;
  popularitySort?: HPopularitySort;
  tags?: string[];
  search?: string;
  excludeUnreleased?: boolean;
  signal?: AbortSignal;
}): Promise<SeasonAnimeResult> {
  const page = opts.page ?? 1;
  const sort = buildHSort(opts.dateSort ?? null, opts.popularitySort ?? null);
  // Empty arrays for tag_in trip AniList's filter on some servers; omit when empty.
  const tagsIn = opts.tags && opts.tags.length > 0 ? opts.tags : null;
  const trimmedSearch = opts.search?.trim() ?? '';
  const search = trimmedSearch.length > 0 ? trimmedSearch : null;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: buildHQuery(!!opts.excludeUnreleased),
      variables: { page, sort, tagsIn, search },
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const msg =
      res.status === 429
        ? 'Rate limited by AniList. Wait a few seconds and try again.'
        : res.status >= 500
          ? `AniList is unreachable right now (HTTP ${res.status}).`
          : `AniList returned HTTP ${res.status}.`;
    throw new AnilistError(msg, res.status);
  }

  const json = (await res.json()) as {
    data?: { Page?: { pageInfo?: { hasNextPage: boolean }; media?: AnilistMedia[] } };
    errors?: { message: string }[];
  };
  if (json.errors && json.errors.length > 0) {
    throw new AnilistError(json.errors[0].message, 500);
  }
  return {
    media: json.data?.Page?.media ?? [],
    hasNextPage: !!json.data?.Page?.pageInfo?.hasNextPage,
  };
}

/**
 * Paginates `getSeasonAnime` until there's no next page or `maxPages` is hit.
 * Inserts a short delay between page fetches to stay polite with AniList's
 * 90 req/min rate limit.
 */
export async function getSeasonAnimeAll(
  season: AnimeSeason | null,
  year: number,
  opts: { maxPages?: number; tags?: string[]; signal?: AbortSignal } = {},
): Promise<AnilistMedia[]> {
  const maxPages = opts.maxPages ?? 4;
  const all: AnilistMedia[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const result = await getSeasonAnime(season, year, page, opts.tags, opts.signal);
    all.push(...result.media);
    if (!result.hasNextPage) break;
    if (page < maxPages) await new Promise((r) => setTimeout(r, 600));
  }
  return all;
}

/**
 * Fetches a single media by id — used when favoriting from a schedule card so
 * we can enrich the collection entry with startDate, tags, score, etc.
 */
export async function getAnimeById(
  id: number,
  signal?: AbortSignal,
): Promise<AnilistMedia | null> {
  const query = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { romaji english native }
    coverImage { large medium }
    format
    episodes
    averageScore
    description(asHtml: false)
    tags { name rank isAdult isMediaSpoiler }
    startDate { year month day }
    nextAiringEpisode { episode airingAt }
  }
}`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables: { id } }),
    signal,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { Media?: AnilistMedia } };
  return json.data?.Media ?? null;
}

/**
 * Batched lookup by AniList IDs — used to enrich collection entries with the
 * full tag list (and other fields) without one HTTP call per show.
 */
export async function getAnimesByIds(
  ids: number[],
  signal?: AbortSignal,
): Promise<AnilistMedia[]> {
  if (ids.length === 0) return [];
  const query = `
query ($ids: [Int]) {
  Page(perPage: 50) {
    media(id_in: $ids, type: ANIME) {
      id
      title { romaji english native }
      coverImage { large medium }
      format
      episodes
      averageScore
      description(asHtml: false)
      tags { name rank isAdult isMediaSpoiler }
      startDate { year month day }
      nextAiringEpisode { episode airingAt }
    }
  }
}`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables: { ids } }),
    signal,
  });
  if (!res.ok) {
    throw new AnilistError(`AniList returned HTTP ${res.status}.`, res.status);
  }
  const json = (await res.json()) as {
    data?: { Page?: { media?: AnilistMedia[] } };
  };
  return json.data?.Page?.media ?? [];
}
