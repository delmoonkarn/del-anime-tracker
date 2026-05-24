'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import type {
  AnilistTag,
  AnimeSeason,
  AnimeSeasonRef,
  DiscoverCacheEntry,
  DiscoverItem,
} from '@/lib/types';
import { tagsMatch } from '@/lib/utils';
import { DiscoverCard } from './DiscoverCard';
import { TagFilterPicker } from './TagFilterPicker';

interface Props {
  defaultRef: AnimeSeasonRef;
  isAddedTo: (anilistId: number, targetSeasonName: string) => boolean;
  onAdd: (item: DiscoverItem, targetSeasonName: string) => void;
  isFavorited: (anilistId: number) => boolean;
  isInterested: (anilistId: number) => boolean;
  onToggleFavorite: (item: DiscoverItem) => void;
  onToggleInterested: (item: DiscoverItem) => void;
  cacheEntries: DiscoverCacheEntry[];
  onCacheUpdate: (entry: DiscoverCacheEntry) => void;
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const SEASON_LABEL: Record<AnimeSeason, string> = {
  WINTER: 'Winter',
  SPRING: 'Spring',
  SUMMER: 'Summer',
  FALL: 'Fall',
};

/** Calendar-rotation next: WINTER → SPRING → SUMMER → FALL → WINTER. */
const NEXT_SEASON: Record<AnimeSeason, AnimeSeason> = {
  WINTER: 'SPRING',
  SPRING: 'SUMMER',
  SUMMER: 'FALL',
  FALL: 'WINTER',
};

/** Derives "Winter 2026" / "Spring 2026" / ... from an anime's startDate.
 *  Used when the user picked the blank "All seasons" option so each anime
 *  lands in its actual tracker-season slot rather than a generic "2026" bin. */
function seasonNameFromMonth(year: number, month: number | null | undefined): string {
  const m = month ?? 0;
  let s: string;
  if (m <= 3) s = 'Winter';
  else if (m <= 6) s = 'Spring';
  else if (m <= 9) s = 'Summer';
  else s = 'Fall';
  return `${s} ${year}`;
}

export function DiscoverPage({
  defaultRef,
  isAddedTo,
  onAdd,
  isFavorited,
  isInterested,
  onToggleFavorite,
  onToggleInterested,
  cacheEntries,
  onCacheUpdate,
}: Props) {
  const [selectedSeason, setSelectedSeason] = useState<AnimeSeason | null>(
    defaultRef.season,
  );
  const [selectedYear, setSelectedYear] = useState<number>(defaultRef.year);
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedFormats, setSelectedFormats] = useState<string[]>([]);
  /** True = hide everything except the Continuing block. Toggled by the
   *  "Continuing N" pill in the format filter row. Auto-resets when the
   *  selection moves to a non-current season (where Continuing is empty). */
  const [continuingOnly, setContinuingOnly] = useState(false);
  const [allTags, setAllTags] = useState<AnilistTag[] | null>(null);
  const [items, setItems] = useState<DiscoverItem[]>([]);
  /** Currently-releasing shows that aren't categorized in the viewed season —
   *  e.g. Digimon BeatBreak (a Fall 2025 show still airing into Spring 2026).
   *  Only populated when viewing the current calendar season; empty otherwise. */
  const [continuingItems, setContinuingItems] = useState<DiscoverItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const continuingAbortRef = useRef<AbortController | null>(null);

  // Load tags once (with localStorage cache).
  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ loadTags, saveTags }, { getAllTags }] = await Promise.all([
        import('@/lib/storage'),
        import('@/lib/anilist'),
      ]);
      const cached = await loadTags();
      if (cached) {
        if (alive) setAllTags(cached);
      } else {
        try {
          const fresh = await getAllTags();
          if (alive) setAllTags(fresh);
          saveTags(fresh);
        } catch (e) {
          console.warn('Failed to fetch tags', e);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const performFetch = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setItems([]);
    try {
      const [{ getSeasonAnimeAll }, { toDiscoverItem }] = await Promise.all([
        import('@/lib/anilist'),
        import('@/lib/discover'),
      ]);
      const media = await getSeasonAnimeAll(selectedSeason, selectedYear, {
        tags: selectedTags,
        signal: controller.signal,
      });
      // Guard against the race where the previous fetch finished AFTER the
      // new one was kicked off (otherwise stale results clobber fresh ones).
      if (controller.signal.aborted) return;
      const items = media.map(toDiscoverItem);
      setItems(items);
      onCacheUpdate({
        fetchedAt: Date.now(),
        season: selectedSeason,
        year: selectedYear,
        tags: [...selectedTags],
        items,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message || 'Failed to fetch from AniList.');
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const findCached = (): DiscoverCacheEntry | undefined =>
    cacheEntries.find(
      (c) =>
        c.season === selectedSeason &&
        c.year === selectedYear &&
        tagsMatch(c.tags, selectedTags),
    );

  /** Pulls currently-releasing shows that aren't already in the main season
   *  query. Only meaningful when viewing the current calendar season — for
   *  past/future views, "currently airing" doesn't relate to the picked
   *  season, so we don't render the block at all. */
  const fetchContinuing = async () => {
    continuingAbortRef.current?.abort();
    const controller = new AbortController();
    continuingAbortRef.current = controller;
    try {
      const [{ getContinuingAnime }, { toDiscoverItem }] = await Promise.all([
        import('@/lib/anilist'),
        import('@/lib/discover'),
      ]);
      // beforeSeason / beforeYear pin the AniList startDate_lesser filter
      // to the start of the season we're viewing. Pre-filtering server-side
      // means the 50-row popularity-sorted page is filled with actual
      // continuing shows (Digimon BeatBreak, split-cours, etc.) instead of
      // being dominated by current-season hits we'd just throw away.
      const media = await getContinuingAnime({
        beforeSeason: defaultRef.season,
        beforeYear: defaultRef.year,
        tags: selectedTags,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const filtered = media
        .filter((m) => {
          // Defensive: drop anything tagged in the viewed season.
          if (m.season === selectedSeason && m.seasonYear === selectedYear) {
            return false;
          }
          // "Dead trap" rejection: AniList's status=RELEASING flag stays
          // set on stale entries (productions on indefinite hiatus, etc.)
          // The stronger signal is nextAiringEpisode — AniList nulls it
          // when there's no scheduled upcoming episode. Requiring it
          // confirms the show is actually still broadcasting.
          if (!m.nextAiringEpisode) return false;
          return true;
        })
        .map(toDiscoverItem);
      setContinuingItems(filtered);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof Error && err.name !== 'AbortError') {
        // Loud: previous quiet console.warn made a malformed query look
        // like "no continuing shows" instead of "the request errored".
        console.error('[discover] continuing fetch failed:', err);
      }
      // Don't surface a UI error — the main grid is still useful even
      // when the optional Continuing fetch fails.
    }
  };

  // On selection change: use cache when it matches; otherwise fetch.
  // The "Continuing" block fires alongside as a separate request when
  // viewing the current calendar season.
  useEffect(() => {
    const hit = findCached();
    if (hit) {
      setItems(hit.items);
      setLoading(false);
      setError(null);
    } else {
      performFetch();
    }
    const isCurrent =
      selectedSeason === defaultRef.season && selectedYear === defaultRef.year;
    if (isCurrent) {
      fetchContinuing();
    } else {
      setContinuingItems([]);
      // Drop the continuing-only filter — there's no continuing block on
      // past/future season views, leaving it on would render an empty grid.
      setContinuingOnly(false);
    }
    return () => {
      abortRef.current?.abort();
      continuingAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeason, selectedYear, selectedTags]);

  const selectedName = selectedSeason
    ? `${SEASON_LABEL[selectedSeason]} ${selectedYear}`
    : `All ${selectedYear}`;
  const isSelectionCurrentSeason =
    selectedSeason === defaultRef.season && selectedYear === defaultRef.year;

  const q = search.trim().toLowerCase();
  const formatFilterActive = selectedFormats.length > 0;
  // Continuing-only mode hides every main-grid item. Filtered continuing
  // items still render via the existing filteredContinuing path below.
  const visibleItems = continuingOnly
    ? []
    : items.filter((i) => {
        if (formatFilterActive && (!i.format || !selectedFormats.includes(i.format))) {
          return false;
        }
        if (q) {
          const titleHit = i.title.toLowerCase().includes(q);
          const engHit = i.titleEnglish?.toLowerCase().includes(q) ?? false;
          if (!titleHit && !engHit) return false;
        }
        return true;
      });

  // Format counts off the unfiltered (but search-aware) item list so each
  // pill shows how many would surface if its format were the only one
  // selected. Includes continuing items so a TV long-runner like Digimon
  // BeatBreak counts toward "TV N" — the pill filter applies to continuing
  // items, so its count should too. Dedupes by anilistId to avoid double-
  // counting if a show is somehow in both lists.
  const matchesQuery = (i: DiscoverItem) =>
    !q ||
    i.title.toLowerCase().includes(q) ||
    (i.titleEnglish?.toLowerCase().includes(q) ?? false);
  const mainIdsForCount = new Set(items.map((i) => i.anilistId));
  const countables: DiscoverItem[] = [
    ...items.filter(matchesQuery),
    ...continuingItems.filter(
      (i) => !mainIdsForCount.has(i.anilistId) && matchesQuery(i),
    ),
  ];
  const formatCounts = new Map<string, number>();
  for (const i of countables) {
    if (!i.format) continue;
    formatCounts.set(i.format, (formatCounts.get(i.format) ?? 0) + 1);
  }
  // Display order: TV + ONA come first (and share a card-grid block — no
  // separator between them since they're both "streamed weekly anime"),
  // then movies, specials, OVAs, TV shorts. Anything else AniList returns
  // (e.g. MUSIC) gets pushed to the end, sorted by descending count.
  const FORMAT_ORDER = ['TV', 'ONA', 'MOVIE', 'SPECIAL', 'OVA', 'TV_SHORT'];
  const FORMAT_LABELS: Record<string, string> = {
    TV: 'TV',
    TV_SHORT: 'TV Short',
    MOVIE: 'Movie',
    SPECIAL: 'Special',
    OVA: 'OVA',
    ONA: 'ONA',
    MUSIC: 'Music',
  };
  // "Block" assignment for the card grid — formats in the same block render
  // back-to-back without a horizontal separator. CONTINUING_BLOCK is a
  // synthetic block for long-runners from previous seasons (see
  // continuingItems) and sits at the bottom of the grid.
  const FORMAT_BLOCK: Record<string, number> = {
    TV: 0,
    ONA: 0,
    MOVIE: 1,
    SPECIAL: 2,
    OVA: 2,
    TV_SHORT: 3,
  };
  const CONTINUING_BLOCK = 4;
  // Section heading label shown on the separator line for each block (except
  // the first, which has no separator). Plural by convention since each
  // block holds many shows. The TV/ONA block has no heading.
  const FORMAT_HEADING: Record<string, string> = {
    MOVIE: 'Movies',
    TV_SHORT: 'TV Shorts',
    OVA: 'OVAs',
    SPECIAL: 'Specials',
    MUSIC: 'Music',
  };
  const formatList: string[] = [
    ...FORMAT_ORDER.filter((f) => formatCounts.has(f)),
    ...Array.from(formatCounts.keys())
      .filter((f) => !FORMAT_ORDER.includes(f))
      .sort((a, b) => (formatCounts.get(b) ?? 0) - (formatCounts.get(a) ?? 0)),
  ];
  const toggleFormat = (f: string) => {
    setSelectedFormats((cur) =>
      cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f],
    );
  };

  // Continuing items: long-runners from previous seasons that are still
  // airing now. Dedupe against the main items list (a show might appear
  // in both if AniList's season metadata mis-categorizes it) and apply the
  // same search + format filters so toggles compose predictably.
  const mainIds = new Set(items.map((i) => i.anilistId));
  const filteredContinuing = continuingItems.filter((i) => {
    if (mainIds.has(i.anilistId)) return false;
    if (formatFilterActive && (!i.format || !selectedFormats.includes(i.format))) {
      return false;
    }
    if (q) {
      const titleHit = i.title.toLowerCase().includes(q);
      const engHit = i.titleEnglish?.toLowerCase().includes(q) ?? false;
      if (!titleHit && !engHit) return false;
    }
    return true;
  });
  // Set of anilistIds that should render in the Continuing block. Cheaper
  // than per-item flag passing into the sort.
  const continuingIds = new Set(filteredContinuing.map((i) => i.anilistId));

  // Card-grid ordering: sort visibleItems + continuing by block. Continuing
  // items override their format's block with CONTINUING_BLOCK (1). TV + ONA
  // share block 0 so they interleave naturally in AniList's popularity-desc
  // order. Stable sort preserves that within each block.
  const allItems = [...visibleItems, ...filteredContinuing];
  function blockOf(item: DiscoverItem): number {
    if (continuingIds.has(item.anilistId)) return CONTINUING_BLOCK;
    return FORMAT_BLOCK[item.format ?? ''] ?? Number.MAX_SAFE_INTEGER;
  }
  const orderedItems = [...allItems].sort((a, b) => blockOf(a) - blockOf(b));

  // Collect which formats actually appear in each block. Lets the section
  // heading read "Specials & OVAs" only when both are present in the
  // current results — falls back to just "Specials" or just "OVAs" if not.
  const blockFormats = new Map<number, Set<string>>();
  for (const item of orderedItems) {
    const block = blockOf(item);
    if (!blockFormats.has(block)) blockFormats.set(block, new Set());
    blockFormats.get(block)!.add(item.format ?? '');
  }
  function blockHeading(block: number): string {
    // Continuing block has a fixed label — it's not a format-based grouping.
    if (block === CONTINUING_BLOCK) return 'Continuing';
    const formats = Array.from(blockFormats.get(block) ?? []);
    // Stable label ordering: follow FORMAT_ORDER position so "Specials &
    // OVAs" stays in that order regardless of which one appeared first
    // in the result set.
    formats.sort(
      (a, b) =>
        (FORMAT_ORDER.indexOf(a) === -1 ? 99 : FORMAT_ORDER.indexOf(a)) -
        (FORMAT_ORDER.indexOf(b) === -1 ? 99 : FORMAT_ORDER.indexOf(b)),
    );
    const labels = formats.map(
      (f) => FORMAT_HEADING[f] ?? FORMAT_LABELS[f] ?? f ?? 'Other',
    );
    return labels.join(' & ');
  }

  // Year dropdown options: current+5 down to 1940.
  // AniList's API has a bug where seasonYear values 1917-1929 silently
  // resolve to 2017-2029 (its date parser misreads two-digit years), so we
  // cap below 1940 to keep all results truthful. Years 1940-1969 are valid
  // but mostly empty; 1970+ has real data.
  const yearOptions: number[] = [];
  for (let y = defaultRef.year + 5; y >= 1940; y--) yearOptions.push(y);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="border-b border-zinc-800 pb-4 mb-6">
        <p className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">
          · Discover by Season · 
        </p>
        <h1 className="text-2xl font-bold mt-0.5 flex items-center gap-2">
          {selectedName}
          {isSelectionCurrentSeason && <Sparkles className="w-5 h-5 text-amber-400" />}
        </h1>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedSeason ?? ''}
              onChange={(e) =>
                setSelectedSeason(
                  e.target.value === '' ? null : (e.target.value as AnimeSeason),
                )
              }
              className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
            >
              <option value="">— All year —</option>
              {(['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const).map((s) => {
                const tag =
                  s === defaultRef.season
                    ? ' · Now'
                    : s === NEXT_SEASON[defaultRef.season]
                      ? ' · Next'
                      : '';
                return (
                  <option key={s} value={s}>
                    {SEASON_LABEL[s]}
                    {tag}
                  </option>
                );
              })}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y === defaultRef.year ? `${y} ★` : y}
                </option>
              ))}
            </select>
            {selectedYear !== defaultRef.year && (
              <button
                type="button"
                onClick={() => setSelectedYear(defaultRef.year)}
                className="px-2 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-indigo-300 hover:bg-zinc-800"
                title={`Jump to current year (${defaultRef.year})`}
              >
                Today ({defaultRef.year})
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                performFetch();
                // Continuing isn't cached, but the in-memory list survives
                // across re-renders — re-fetch it on Refresh so the user
                // gets up-to-date data for both blocks in one click.
                if (
                  selectedSeason === defaultRef.season &&
                  selectedYear === defaultRef.year
                ) {
                  fetchContinuing();
                }
              }}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium disabled:opacity-50 disabled:cursor-wait"
              title="Refresh from AniList (ignore cache)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            {!loading &&
              (() => {
                const hit = findCached();
                if (!hit) return null;
                return (
                  <span className="text-xs text-zinc-500">
                    Cached · {timeAgo(hit.fetchedAt)} · {cacheEntries.length}/4 stored
                  </span>
                );
              })()}
          </div>

          <div className="flex items-start gap-3">
            <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wide pt-1.5">
              Tags
            </label>
            <div className="flex-1 min-w-0">
              <TagFilterPicker
                allTags={allTags}
                selected={selectedTags}
                onChange={setSelectedTags}
              />
            </div>
          </div>

          {(formatList.length > 0 || filteredContinuing.length > 0) && (
            <div className="flex items-start gap-3">
              <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wide pt-1.5">
                Format
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                {formatList.map((f) => {
                  const active = selectedFormats.includes(f);
                  const count = formatCounts.get(f) ?? 0;
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => toggleFormat(f)}
                      className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                        active
                          ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/60'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      {FORMAT_LABELS[f] ?? f}{' '}
                      <span className={active ? 'opacity-70' : 'text-zinc-500'}>
                        {count}
                      </span>
                    </button>
                  );
                })}
                {/* Continuing-only pill — last in the row, mirrors the
                    Continuing block's position at the bottom of the grid.
                    Distinct cyan tint sets it apart from the indigo format
                    pills since it's a section filter, not a format. */}
                {filteredContinuing.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setContinuingOnly((v) => !v)}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                      continuingOnly
                        ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/60'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-cyan-500/40'
                    }`}
                    title="Show only the Continuing block"
                  >
                    Continuing{' '}
                    <span
                      className={continuingOnly ? 'opacity-70' : 'text-zinc-500'}
                    >
                      {filteredContinuing.length}
                    </span>
                  </button>
                )}
                {(selectedFormats.length > 0 || continuingOnly) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFormats([]);
                      setContinuingOnly(false);
                    }}
                    className="text-[11px] text-zinc-500 hover:text-zinc-300 px-2 py-1"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-sm text-red-300">
          {error}
        </div>
      )}

      {items.length > 0 && (
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${items.length} title${items.length === 1 ? '' : 's'}…`}
            className="w-full pl-9 pr-9 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {!loading &&
        items.length === 0 &&
        filteredContinuing.length === 0 &&
        !error && (
          <p className="text-center text-sm text-zinc-500 py-24">No results.</p>
        )}

      {items.length > 0 &&
        visibleItems.length === 0 &&
        filteredContinuing.length === 0 && (
          <p className="text-center text-sm text-zinc-500 py-12">
            No titles match &quot;{search.trim()}&quot;.
          </p>
        )}

      {orderedItems.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {(() => {
            // Walk orderedItems and inject a full-width separator whenever
            // the block changes. TV (block 0) and ONA (block 0) share
            // a block so there's no line between them. Continuing items
            // override their format's block to CONTINUING_BLOCK.
            const nodes: React.ReactNode[] = [];
            let prevBlock: number | null = null;
            for (const item of orderedItems) {
              const block = blockOf(item);
              if (prevBlock !== null && block !== prevBlock) {
                // Labeled separator: section heading on the left, a thin
                // line stretching to the right edge of the grid. Heading
                // joins the labels of every format actually present in
                // this block (e.g. "Specials & OVAs" when both appear).
                nodes.push(
                  <div
                    key={`sep-${item.anilistId}`}
                    className="col-span-full flex items-center gap-3 my-3"
                  >
                    <span className="text-sm font-semibold text-zinc-300 shrink-0">
                      {blockHeading(block)}
                    </span>
                    <div
                      className="flex-1 border-t border-zinc-800"
                      aria-hidden
                    />
                  </div>,
                );
              }
              prevBlock = block;
              nodes.push(
                <DiscoverCard
                  key={item.anilistId}
                  item={item}
                  alreadyAdded={isAddedTo(
                    item.anilistId,
                    // In all-year mode, "added" check is per-anime against
                    // the tracker season matching that anime's actual
                    // airing season.
                    selectedSeason
                      ? selectedName
                      : seasonNameFromMonth(
                          item.startDate?.year ?? selectedYear,
                          item.startDate?.month ?? undefined,
                        ),
                  )}
                  onAdd={() =>
                    onAdd(
                      item,
                      selectedSeason
                        ? selectedName
                        : seasonNameFromMonth(
                            item.startDate?.year ?? selectedYear,
                            item.startDate?.month ?? undefined,
                          ),
                    )
                  }
                  favorited={isFavorited(item.anilistId)}
                  interested={isInterested(item.anilistId)}
                  onToggleFavorite={() => onToggleFavorite(item)}
                  onToggleInterested={() => onToggleInterested(item)}
                />,
              );
            }
            return nodes;
          })()}
        </div>
      )}
    </div>
  );
}
