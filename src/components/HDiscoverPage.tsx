import { useEffect, useRef, useState } from 'react';
import { Heart, Loader2, Search, X } from 'lucide-react';
import type {
  AnilistTag,
  DiscoverItem,
  HDateSort,
  HPopularitySort,
} from '@/lib/types';
import { anilistUrl } from '@/lib/nav';
import { loadHPrefs, saveHPrefs } from '@/lib/storage';
import { BTN, EYEBROW, FIELD } from '@/lib/ui';
import { useDebounce } from '@/hooks/useDebounce';
import { ExploreCard } from './ExploreCard';
import { useIsPhone } from '@/hooks/useIsPhone';
import { PageHeader } from './PageHeader';
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
  const phone = useIsPhone();
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

  async function toggleFavorite(item: DiscoverItem) {
    if (!isFavoritedH(item.anilistId)) {
      onAddHFavorite(item);
      return;
    }
    const ok = await confirm({
      title: 'Remove favorite',
      message: `Remove "${item.title}" from your H favorites?`,
      kind: 'danger',
      confirmText: 'Remove',
    });
    if (ok) onRemoveHFavorite(item.anilistId);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-4 sm:py-8">
      <PageHeader
        title={
          <>
            H
            <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-300">18+</span>
          </>
        }
        description="Adult titles from AniList. Your H favorites are kept apart from your Collection."
        actions={
          <button type="button" onClick={onOpenFavorites} className={BTN} title="Open H favorites">
            <Heart className="h-4 w-4 text-rose-400" />
            Favorites
            <span className="tabular-nums text-zinc-400">{hFavoritesCount}</span>
          </button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${FIELD} flex w-full items-center gap-2 sm:w-60`}>
            <Search className="h-4 w-4 shrink-0 text-zinc-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search titles…"
              aria-label="Search AniList titles"
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
          <select
            value={dateSort ?? ''}
            onChange={(e) => setDateSort((e.target.value || null) as HDateSort)}
            className={FIELD}
            aria-label="Sort by date"
          >
            <option value="">Date: any</option>
            <option value="NEW">Newest first</option>
            <option value="OLD">Oldest first</option>
          </select>
          <select
            value={popularitySort ?? ''}
            onChange={(e) => setPopularitySort((e.target.value || null) as HPopularitySort)}
            className={FIELD}
            aria-label="Sort by popularity"
          >
            <option value="">Popularity: any</option>
            <option value="POPULAR">Most popular</option>
            <option value="LEAST_POPULAR">Least popular</option>
          </select>
          <label className="inline-flex h-8 cursor-pointer items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={excludeUnreleased}
              onChange={(e) => setExcludeUnreleased(e.target.checked)}
              className="h-4 w-4 accent-indigo-500"
            />
            Hide unreleased / cancelled
          </label>
          {dateSort && popularitySort && (
            <span className="text-xs text-zinc-500">Popularity first, then date</span>
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
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">{error}</div>
      )}

      {loading && items.length === 0 && (
        <div className="py-24 text-center text-zinc-500">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-indigo-400" />
          Loading…
        </div>
      )}

      {!loading && items.length === 0 && !error && <p className="py-24 text-center text-sm text-zinc-500">No results.</p>}

      {items.length > 0 && (
        <>
          <p className="mb-3 text-xs text-zinc-500">
            Showing {items.length} title{items.length === 1 ? '' : 's'}
            {debouncedSearch.trim() ? ` matching "${debouncedSearch.trim()}"` : ''}
            {selectedTags.length > 0
              ? ` · ${selectedTags.length} tag${selectedTags.length === 1 ? '' : 's'} (any)`
              : ''}
          </p>
          <div className="grid grid-cols-3 gap-x-2 gap-y-4 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {items.map((item) => (
              <ExploreCard
                key={item.anilistId}
                item={item}
                compact={phone}
                favorited={isFavoritedH(item.anilistId)}
                onToggleFavorite={() => void toggleFavorite(item)}
                openUrl={anilistUrl(item.anilistId)}
              />
            ))}
          </div>

          {hasNextPage && (
            <div className="mt-6 flex justify-center">
              <button type="button" onClick={handleLoadMore} disabled={loadingMore} className={BTN}>
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
