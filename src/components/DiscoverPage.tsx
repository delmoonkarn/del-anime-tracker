import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Play, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import type {
  AnilistTag,
  AnimeSeason,
  AnimeSeasonRef,
  DiscoverCacheEntry,
  DiscoverItem,
  StreamLink,
} from '@/lib/types';
import { tagsMatch } from '@/lib/utils';
import { useLinksResolver, useRememberAnilistLinks } from '@/lib/nav';
import { serviceLabel } from '@/lib/streamLinks';
import { BTN, BTN_ICON, EYEBROW, FIELD, MENU, pillClass } from '@/lib/ui';
import { useClickOutside } from '@/hooks/useClickOutside';
import { ExploreCard } from './ExploreCard';
import { PageHeader } from './PageHeader';
import { ServiceLogo } from './ServiceLogo';
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
  /** Streaming service names; a show passes if it is on any of them. */
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const linksOf = useLinksResolver();
  const rememberAnilistLinks = useRememberAnilistLinks();
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
        tagsMatch(c.tags, selectedTags) &&
        // Results saved while AniList links weren't fetched are refetched
        // once so the channel icons and the service filter have data.
        c.items.every((i) => i.streamLinks !== undefined),
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
      rememberAnilistLinks(
        Object.fromEntries(filtered.map((i) => [i.anilistId, i.streamLinks ?? []])),
      );
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
  const servicesOf = (i: DiscoverItem) => linksOf(i.anilistId).map(serviceLabel);
  const onSelectedService = (i: DiscoverItem) =>
    selectedServices.length === 0 || servicesOf(i).some((s) => selectedServices.includes(s));
  // Continuing-only mode hides every main-grid item. Filtered continuing
  // items still render via the existing filteredContinuing path below.
  const visibleItems = continuingOnly
    ? []
    : items.filter((i) => {
        if (formatFilterActive && (!i.format || !selectedFormats.includes(i.format))) {
          return false;
        }
        if (!onSelectedService(i)) return false;
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
    if (!onSelectedService(i)) return false;
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

  // Streaming services the listed shows are on — your links plus AniList's
  // (search-aware, like the format pills), with one sample link each for the logo.
  const serviceCounts = new Map<string, number>();
  const serviceLogo = new Map<string, StreamLink>();
  for (const i of countables) {
    // One count per show per service, even if a show has two links for it.
    for (const name of new Set(linksOf(i.anilistId).map(serviceLabel))) {
      serviceCounts.set(name, (serviceCounts.get(name) ?? 0) + 1);
    }
    for (const l of linksOf(i.anilistId)) {
      const name = serviceLabel(l);
      // Prefer a link with AniList's brand icon for the filter's logo.
      if (!serviceLogo.has(name) || (l.icon && !serviceLogo.get(name)!.icon)) serviceLogo.set(name, l);
    }
  }
  // A selected service stays listed even when the search hides all its shows.
  for (const s of selectedServices) if (!serviceCounts.has(s)) serviceCounts.set(s, 0);
  const serviceList = [...serviceCounts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));

  const anyFilter = selectedFormats.length > 0 || continuingOnly || selectedServices.length > 0;
  const cached = !loading ? findCached() : undefined;
  const targetSeasonFor = (item: DiscoverItem) =>
    // In all-year mode each anime lands in the tracker season matching its
    // actual airing season.
    selectedSeason
      ? selectedName
      : seasonNameFromMonth(item.startDate?.year ?? selectedYear, item.startDate?.month ?? undefined);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
      <PageHeader
        title={
          <>
            {selectedSeason ? selectedName : `All of ${selectedYear}`}
            {isSelectionCurrentSeason && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300"
                title="Current season"
              >
                <Sparkles className="h-3 w-3" />
                Now
              </span>
            )}
          </>
        }
        actions={
          <>
            {cached && (
              <span className="text-xs text-zinc-500">Updated {timeAgo(cached.fetchedAt)}</span>
            )}
            <button
              type="button"
              onClick={() => {
                performFetch();
                // Continuing isn't cached — refetch it too so both blocks
                // are fresh after one click.
                if (isSelectionCurrentSeason) fetchContinuing();
              }}
              disabled={loading}
              className={BTN_ICON}
              title="Refresh from AniList (ignore cache)"
              aria-label="Refresh from AniList"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedSeason ?? ''}
            onChange={(e) =>
              setSelectedSeason(e.target.value === '' ? null : (e.target.value as AnimeSeason))
            }
            className={FIELD}
            aria-label="Season"
          >
            <option value="">— All year —</option>
            {(['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const).map((s) => {
              const nextYear = defaultRef.season === 'FALL' ? defaultRef.year + 1 : defaultRef.year;
              const tag =
                selectedYear === defaultRef.year && s === defaultRef.season
                  ? ' · Now'
                  : selectedYear === nextYear && s === NEXT_SEASON[defaultRef.season]
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
            className={FIELD}
            aria-label="Year"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y === defaultRef.year ? `${y} ★` : y}
              </option>
            ))}
          </select>
          {!isSelectionCurrentSeason && (
            <button
              type="button"
              onClick={() => {
                setSelectedSeason(defaultRef.season);
                setSelectedYear(defaultRef.year);
              }}
              className="h-8 rounded-lg px-2.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-indigo-300"
            >
              Today ({defaultRef.name})
            </button>
          )}
          <ServiceFilter
            list={serviceList}
            logos={serviceLogo}
            selected={selectedServices}
            onToggle={(s) =>
              setSelectedServices((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))
            }
            onClear={() => setSelectedServices([])}
          />
          <span className="mx-1 hidden h-5 border-l border-zinc-800 sm:block" aria-hidden />
          <label className={`${FIELD} flex w-full items-center gap-2 sm:w-60`}>
            <Search className="h-4 w-4 shrink-0 text-zinc-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={items.length > 0 ? `Filter ${items.length} titles…` : 'Filter titles…'}
              aria-label="Filter these results by title"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-zinc-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="text-zinc-500 hover:text-zinc-300"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
          {(formatList.length > 0 || filteredContinuing.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Format">
              {formatList.map((f) => {
                const active = selectedFormats.includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => toggleFormat(f)}
                    className={pillClass(active)}
                    aria-pressed={active}
                  >
                    {FORMAT_LABELS[f] ?? f}{' '}
                    <span className="tabular-nums opacity-60">{formatCounts.get(f) ?? 0}</span>
                  </button>
                );
              })}
              {filteredContinuing.length > 0 && (
                <button
                  type="button"
                  onClick={() => setContinuingOnly((v) => !v)}
                  className={pillClass(continuingOnly, 'info')}
                  aria-pressed={continuingOnly}
                  title="Show only shows from earlier seasons that are still airing"
                >
                  Continuing <span className="tabular-nums opacity-60">{filteredContinuing.length}</span>
                </button>
              )}
              {anyFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFormats([]);
                    setContinuingOnly(false);
                    setSelectedServices([]);
                  }}
                  className="px-2 text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-start gap-3">
          <span className={`${EYEBROW} pt-1.5`}>Tags</span>
          <div className="min-w-0 flex-1">
            <TagFilterPicker allTags={allTags} selected={selectedTags} onChange={setSelectedTags} />
          </div>
        </div>
      </PageHeader>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && items.length === 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" aria-busy="true">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900" aria-hidden>
              <div className="aspect-[2/3] w-full animate-pulse bg-zinc-800" />
              <div className="flex flex-col gap-2 p-3">
                <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-800" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-800" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && items.length === 0 && filteredContinuing.length === 0 && !error && (
        <p className="py-24 text-center text-sm text-zinc-500">AniList has no anime listed for this season.</p>
      )}

      {items.length > 0 && orderedItems.length === 0 && (
        <p className="py-12 text-center text-sm text-zinc-500">
          {search.trim() ? `No titles match “${search.trim()}”.` : 'No titles match these filters.'}
        </p>
      )}

      {orderedItems.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {(() => {
            // Walk orderedItems and inject a full-width heading whenever the
            // block changes. TV and ONA share a block so there's no line
            // between them. Continuing items override their format's block.
            const nodes: React.ReactNode[] = [];
            let prevBlock: number | null = null;
            for (const item of orderedItems) {
              const block = blockOf(item);
              if (prevBlock !== null && block !== prevBlock) {
                nodes.push(
                  <div key={`sep-${item.anilistId}`} className="col-span-full mt-4 mb-1 flex items-center gap-3">
                    <h2 className="shrink-0 text-sm font-semibold text-zinc-200">{blockHeading(block)}</h2>
                    <div className="flex-1 border-t border-zinc-800" aria-hidden />
                  </div>,
                );
              }
              prevBlock = block;
              const target = targetSeasonFor(item);
              nodes.push(
                <ExploreCard
                  key={item.anilistId}
                  item={item}
                  seasonName={target}
                  added={isAddedTo(item.anilistId, target)}
                  onAdd={() => onAdd(item, target)}
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

/** Multi-select dropdown of the streaming services the listed shows are on,
 *  with a logo and a count each. A show passes if it is on any selected one. */
function ServiceFilter({
  list,
  logos,
  selected,
  onToggle,
  onClear,
}: {
  list: [string, number][];
  logos: Map<string, StreamLink>;
  selected: string[];
  onToggle: (service: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);

  const label =
    selected.length === 0 ? 'All services' : selected.length === 1 ? selected[0] : `${selected[0]} +${selected.length - 1}`;
  const firstLogo = selected[0] !== undefined ? logos.get(selected[0]) : undefined;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={list.length === 0}
        className={`${BTN} min-w-36 justify-between font-normal ${
          selected.length > 0 ? 'bg-indigo-500/10 text-indigo-300 ring-1 ring-indigo-500/50' : ''
        }`}
        aria-expanded={open}
        aria-label={`Streaming service filter: ${label}`}
        title={list.length === 0 ? 'No show in this list has streaming links' : undefined}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {firstLogo ? <ServiceLogo link={firstLogo} className="h-4 w-4" /> : <Play className="h-3.5 w-3.5 opacity-60" />}
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className={`${MENU} absolute left-0 mt-1 w-64 p-1.5`}>
          <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto" aria-label="Streaming services">
            {list.map(([s, n]) => {
              const logo = logos.get(s);
              return (
                <li key={s}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-700">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-indigo-500"
                      checked={selected.includes(s)}
                      onChange={() => onToggle(s)}
                      aria-label={`${s}, ${n} show${n === 1 ? '' : 's'}`}
                    />
                    {logo && <ServiceLogo link={logo} className="h-5 w-5" />}
                    <span className="min-w-0 flex-1 truncate">{s}</span>
                    <span className="text-xs tabular-nums text-zinc-500">{n}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="mt-1 w-full rounded-lg py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            >
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}
