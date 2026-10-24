import { useState } from 'react';
import { ArrowLeft, Flame, Heart, Search, X } from 'lucide-react';
import type { CollectionSort, HFavoriteEntry, ScheduleProgress } from '@/lib/types';
import { anilistUrl } from '@/lib/nav';
import { BTN, FIELD } from '@/lib/ui';
import { compareReleaseDate } from '@/lib/utils';
import { CollectionCard } from './CollectionCard';
import { useConfirm } from './ConfirmDialog';
import { PageHeader } from './PageHeader';
import { passesStatusFilter, StatusFilterPills, type StatusFilter } from './StatusFilter';

interface Props {
  items: HFavoriteEntry[];
  onRemove: (anilistId: number) => void;
  onUpdateProgress: (anilistId: number, next: ScheduleProgress) => void;
  onSetUserScore: (anilistId: number, score: number | null) => void;
  onBack: () => void;
}

/** H favorites, laid out and tracked like the Collection. Cards open the
 *  show on AniList, so H never reaches the detail page's list buttons. */
export function HFavoritesPage({ items, onRemove, onUpdateProgress, onSetUserScore, onBack }: Props) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<CollectionSort>('ADDED_NEW');
  const [statuses, setStatuses] = useState<Set<StatusFilter>>(new Set());
  const confirm = useConfirm();

  const q = search.trim().toLowerCase();
  const filtered = items.filter(
    (i) =>
      (!q || i.title.toLowerCase().includes(q) || (i.titleEnglish?.toLowerCase().includes(q) ?? false)) &&
      passesStatusFilter(i.watchStatus, statuses),
  );
  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'RELEASED_NEW':
        return compareReleaseDate(b, a);
      case 'RELEASED_OLD':
        return compareReleaseDate(a, b);
      case 'ADDED_NEW':
        return b.addedAt - a.addedAt;
      case 'ADDED_OLD':
        return a.addedAt - b.addedAt;
      case 'TITLE_AZ':
        return a.title.localeCompare(b.title);
      case 'TITLE_ZA':
        return b.title.localeCompare(a.title);
      case 'SCORE_DESC':
        return (b.userScore ?? -1) - (a.userScore ?? -1);
    }
  });

  async function remove(entry: HFavoriteEntry) {
    const ok = await confirm({
      title: 'Remove favorite',
      message: `Remove "${entry.title}" from your H favorites?`,
      kind: 'danger',
      confirmText: 'Remove',
    });
    if (ok) onRemove(entry.anilistId);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
      <PageHeader
        title={
          <>
            <Heart className="h-6 w-6 fill-current text-rose-400" />
            H Favorites
          </>
        }
        count={items.length}
        description="Kept apart from your Collection and Watchlist."
        actions={
          <button type="button" onClick={onBack} className={BTN}>
            <ArrowLeft className="h-4 w-4" />
            Back to H
          </button>
        }
      >
        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <label className={`${FIELD} flex w-full items-center gap-2 sm:w-60`}>
              <Search className="h-4 w-4 shrink-0 text-zinc-500" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Filter ${items.length} title${items.length === 1 ? '' : 's'}…`}
                aria-label="Filter this list by title"
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
              value={sort}
              onChange={(e) => setSort(e.target.value as CollectionSort)}
              className={FIELD}
              aria-label="Sort"
            >
              <option value="ADDED_NEW">Added — newest</option>
              <option value="ADDED_OLD">Added — oldest</option>
              <option value="RELEASED_NEW">Released — newest</option>
              <option value="RELEASED_OLD">Released — oldest</option>
              <option value="TITLE_AZ">Title A → Z</option>
              <option value="TITLE_ZA">Title Z → A</option>
              <option value="SCORE_DESC">Your score (high → low)</option>
            </select>
            <span className="mx-1 hidden h-5 border-l border-zinc-800 sm:block" aria-hidden />
            <StatusFilterPills statuses={items.map((i) => i.watchStatus)} selected={statuses} onChange={setStatuses} />
          </div>
        )}
      </PageHeader>

      {items.length === 0 && (
        <div className="mx-auto max-w-md py-24 text-center">
          <Flame className="mx-auto mb-3 h-10 w-10 text-rose-400/60" />
          <h2 className="mb-1 text-lg font-semibold">No H favorites yet</h2>
          <p className="text-sm text-zinc-400">
            On the H page, press <strong>Add to favorites</strong> on any card to keep it here.
          </p>
        </div>
      )}

      {items.length > 0 && sorted.length === 0 && <p className="py-12 text-center text-sm text-zinc-500">No results.</p>}

      {sorted.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {sorted.map((entry) => (
            <CollectionCard
              key={entry.anilistId}
              entry={entry}
              favorited
              onToggleFavorite={() => void remove(entry)}
              onRemove={() => void remove(entry)}
              progress={{
                watchStatus: entry.watchStatus,
                episodesWatched: entry.episodesWatched,
                totalEpisodes: entry.episodes,
              }}
              onUpdateProgress={(next) => onUpdateProgress(entry.anilistId, next)}
              userScore={entry.userScore}
              onSetUserScore={(score) => onSetUserScore(entry.anilistId, score)}
              openUrl={anilistUrl(entry.anilistId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
