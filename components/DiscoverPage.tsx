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
  const [allTags, setAllTags] = useState<AnilistTag[] | null>(null);
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  // On selection change: use cache when it matches; otherwise fetch.
  useEffect(() => {
    const hit = findCached();
    if (hit) {
      setItems(hit.items);
      setLoading(false);
      setError(null);
      return;
    }
    performFetch();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeason, selectedYear, selectedTags]);

  const selectedName = selectedSeason
    ? `${SEASON_LABEL[selectedSeason]} ${selectedYear}`
    : `All ${selectedYear}`;
  const isSelectionCurrentSeason =
    selectedSeason === defaultRef.season && selectedYear === defaultRef.year;

  const q = search.trim().toLowerCase();
  const visibleItems = q
    ? items.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.titleEnglish?.toLowerCase().includes(q) ?? false),
      )
    : items;

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
              <option value="WINTER">Winter</option>
              <option value="SPRING">Spring</option>
              <option value="SUMMER">Summer</option>
              <option value="FALL">Fall</option>
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y === defaultRef.year ? `${y} ★ current` : y}
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
              onClick={performFetch}
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

      {!loading && items.length === 0 && !error && (
        <p className="text-center text-sm text-zinc-500 py-24">No results.</p>
      )}

      {items.length > 0 && visibleItems.length === 0 && (
        <p className="text-center text-sm text-zinc-500 py-12">
          No titles match &quot;{search.trim()}&quot;.
        </p>
      )}

      {visibleItems.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {visibleItems.map((item) => (
            <DiscoverCard
              key={item.anilistId}
              item={item}
              alreadyAdded={isAddedTo(
                item.anilistId,
                // In all-year mode, "added" check is per-anime against the
                // tracker season matching that anime's actual airing season.
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
