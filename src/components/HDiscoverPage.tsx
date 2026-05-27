
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Flame, Heart, Loader2, Search, X } from 'lucide-react';
import type {
  AnilistTag,
  DiscoverItem,
  HDateSort,
  HPopularitySort,
} from '@/lib/types';
import { loadHPrefs, saveHPrefs } from '@/lib/storage';
import { useDebounce } from '@/hooks/useDebounce';
import { DiscoverCard } from './DiscoverCard';
import { TagFilterPicker } from './TagFilterPicker';
import { useConfirm } from './ConfirmDialog';

interface Props {
  isFavoritedH: (anilistId: number) => boolean;
  onAddHFavorite: (item: DiscoverItem) => void;
  onRemoveHFavorite: (anilistId: number) => void;
  hFavoritesCount: number;
  onOpenFavorites: () => void;
}

export function HDiscoverPage({
  isFavoritedH,
  onAddHFavorite,
  onRemoveHFavorite,
  hFavoritesCount,
  onOpenFavorites,
}: Props) {
  const confirm = useConfirm();
  const [dateSort, setDateSort] = useState<HDateSort>('NEW');
  const [popularitySort, setPopularitySort] = useState<HPopularitySort>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [excludeUnreleased, setExcludeUnreleased] = useState(false);
  const [allTags, setAllTags] = useState<AnilistTag[] | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 450);
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Load saved sort + tag prefs once on mount.
  useEffect(() => {
    (async () => {
      const prefs = await loadHPrefs();
      if (prefs) {
        setDateSort(prefs.dateSort);
        setPopularitySort(prefs.popularitySort);
        setSelectedTags(prefs.tags);
        setExcludeUnreleased(prefs.excludeUnreleased ?? false);
      }
      setPrefsLoaded(true);
    })();
  }, []);

  // Save prefs whenever they change (but not before initial load — otherwise
  // the defaults would overwrite the user's stored values).
  useEffect(() => {
    if (!prefsLoaded) return;
    saveHPrefs({
      dateSort,
      popularitySort,
      tags: selectedTags,
      excludeUnreleased,
    });
  }, [dateSort, popularitySort, selectedTags, excludeUnreleased, prefsLoaded]);

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

  // Re-fetch from page 1 whenever sort, tags, or search change.
  useEffect(() => {
    if (!prefsLoaded) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setItems([]);
    setPage(0);
    setHasNextPage(false);

    (async () => {
      try {
        const [{ getHAnime }, { toDiscoverItem }] = await Promise.all([
          import('@/lib/anilist'),
          import('@/lib/discover'),
        ]);
        const result = await getHAnime({
          page: 1,
          dateSort,
          popularitySort,
          tags: selectedTags,
          search: debouncedSearch,
          excludeUnreleased,
          signal: controller.signal,
        });
        setItems(result.media.map(toDiscoverItem));
        setHasNextPage(result.hasNextPage);
        setPage(1);
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err.message || 'Failed to fetch from AniList.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [
    dateSort,
    popularitySort,
    selectedTags,
    debouncedSearch,
    excludeUnreleased,
    prefsLoaded,
  ]);

  const handleLoadMore = async () => {
    if (loadingMore || !hasNextPage) return;
    setLoadingMore(true);
    try {
      const [{ getHAnime }, { toDiscoverItem }] = await Promise.all([
        import('@/lib/anilist'),
        import('@/lib/discover'),
      ]);
      const result = await getHAnime({
        page: page + 1,
        dateSort,
        popularitySort,
        tags: selectedTags,
        search: debouncedSearch,
        excludeUnreleased,
      });
      setItems((prev) => [...prev, ...result.media.map(toDiscoverItem)]);
      setHasNextPage(result.hasNextPage);
      setPage((p) => p + 1);
    } catch (err) {
      console.error('Load more failed', err);
      setError(err instanceof Error ? err.message : 'Failed to load more.');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="border-b border-zinc-800 pb-4 mb-6">
        <p className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">
          · H · Discover ·
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Flame className="w-5 h-5 text-rose-400" />
            H
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </h1>
          <button
            type="button"
            onClick={onOpenFavorites}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-rose-500 hover:text-white transition-colors"
            title="Open H favorites"
          >
            <Heart className="w-4 h-4" />
            Favorites
            <span className="text-xs opacity-70">({hFavoritesCount})</span>
          </button>
        </div>
        <p className="text-xs text-zinc-500 mt-1">
          Adult content. Stored in a separate table from your main collection.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search titles…"
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

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wide">
              Sort
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Date</span>
              <select
                value={dateSort ?? ''}
                onChange={(e) =>
                  setDateSort((e.target.value || null) as HDateSort)
                }
                className="px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
              >
                <option value="">—</option>
                <option value="NEW">Newest first</option>
                <option value="OLD">Oldest first</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Popularity</span>
              <select
                value={popularitySort ?? ''}
                onChange={(e) =>
                  setPopularitySort((e.target.value || null) as HPopularitySort)
                }
                className="px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
              >
                <option value="">—</option>
                <option value="POPULAR">Most popular</option>
                <option value="LEAST_POPULAR">Least popular</option>
              </select>
            </div>
            {dateSort && popularitySort && (
              <span className="text-[10px] text-zinc-500 italic">
                Popularity primary, date as tiebreaker
              </span>
            )}
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

          <label className="inline-flex items-center gap-2 text-sm text-zinc-300 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={excludeUnreleased}
              onChange={(e) => setExcludeUnreleased(e.target.checked)}
              className="accent-indigo-500"
            />
            Hide unreleased / cancelled titles
          </label>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && items.length === 0 && (
        <div className="text-center py-24 text-zinc-500">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-indigo-400" />
          Loading…
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <p className="text-center text-sm text-zinc-500 py-24">No results.</p>
      )}

      {items.length > 0 && (
        <>
          <p className="text-xs text-zinc-500 mb-3">
            Showing {items.length} title{items.length === 1 ? '' : 's'}
            {debouncedSearch.trim() ? ` matching "${debouncedSearch.trim()}"` : ''}
            {selectedTags.length > 0
              ? ` · ${selectedTags.length} tag${selectedTags.length === 1 ? '' : 's'} (any)`
              : ''}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {items.map((item) => {
              const isFav = isFavoritedH(item.anilistId);
              return (
                <DiscoverCard
                  key={item.anilistId}
                  item={item}
                  alreadyAdded={isFav}
                  onAdd={() => onAddHFavorite(item)}
                  // When already favorited, expose Remove (with confirmation).
                  onRemove={
                    isFav
                      ? async () => {
                          const ok = await confirm({
                            title: 'Remove favorite',
                            message: `Remove "${item.title}" from your H favorites?`,
                            kind: 'danger',
                            confirmText: 'Remove',
                          });
                          if (ok) onRemoveHFavorite(item.anilistId);
                        }
                      : undefined
                  }
                  // No 3-dot menu on h cards — toggle is the bottom button.
                  // (DiscoverCard hides the menu when no toggle callbacks are passed.)
                />
              );
            })}
          </div>

          {hasNextPage && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm font-medium disabled:opacity-50 disabled:cursor-wait"
              >
                {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
