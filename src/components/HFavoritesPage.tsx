
import { useState } from 'react';
import { ArrowLeft, Flame, Heart, Search, X } from 'lucide-react';
import type { HFavoriteEntry } from '@/lib/types';
import { useConfirm } from './ConfirmDialog';
import { DiscoverCard } from './DiscoverCard';

interface Props {
  items: HFavoriteEntry[];
  onRemove: (anilistId: number) => void;
  onBack: () => void;
}

type SortKey = 'NEWEST_ADDED' | 'OLDEST_ADDED' | 'TITLE_AZ' | 'SCORE_DESC';

export function HFavoritesPage({ items, onRemove, onBack }: Props) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('NEWEST_ADDED');
  const confirm = useConfirm();

  const q = search.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.titleEnglish?.toLowerCase().includes(q) ?? false),
      )
    : items;

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'NEWEST_ADDED':
        return b.addedAt - a.addedAt;
      case 'OLDEST_ADDED':
        return a.addedAt - b.addedAt;
      case 'TITLE_AZ':
        return a.title.localeCompare(b.title);
      case 'SCORE_DESC':
        return (b.averageScore ?? -1) - (a.averageScore ?? -1);
    }
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="border-b border-zinc-800 pb-4 mb-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-indigo-300 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to H
        </button>
        <p className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">
          H · Favorites
        </p>
        <h1 className="text-2xl font-bold mt-0.5 flex items-center gap-2">
          <Heart className="w-5 h-5 text-rose-400 fill-current" />
          H Favorites
          <span className="text-xs text-zinc-500 font-normal">· {items.length}</span>
        </h1>

        <div className="mt-4 flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                items.length > 0
                  ? `Search ${items.length} favorite${items.length === 1 ? '' : 's'}…`
                  : 'No favorites yet'
              }
              disabled={items.length === 0}
              className="w-full pl-9 pr-9 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm disabled:opacity-50"
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

          {items.length > 0 && (
            <div className="flex items-center gap-3">
              <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wide">
                Sort
              </label>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
              >
                <option value="NEWEST_ADDED">Newest added</option>
                <option value="OLDEST_ADDED">Oldest added</option>
                <option value="TITLE_AZ">Title A → Z</option>
                <option value="SCORE_DESC">Score (high → low)</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {items.length === 0 && (
        <div className="text-center py-24 max-w-md mx-auto">
          <Flame className="w-10 h-10 mx-auto mb-3 text-rose-400/60" />
          <h2 className="text-lg font-semibold mb-1">No H favorites yet</h2>
          <p className="text-sm text-zinc-400">
            Browse the H page and click <strong>Add</strong> on any card to favorite it
            here.
          </p>
        </div>
      )}

      {items.length > 0 && sorted.length === 0 && (
        <p className="text-center text-sm text-zinc-500 py-12">
          No favorites match &quot;{search.trim()}&quot;.
        </p>
      )}

      {sorted.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {sorted.map((entry) => (
            <DiscoverCard
              key={entry.anilistId}
              item={entry}
              alreadyAdded
              onAdd={() => {}}
              onRemove={async () => {
                if (
                  await confirm({
                    title: 'Remove favorite',
                    message: `Remove "${entry.title}" from your H favorites?`,
                    kind: 'danger',
                    confirmText: 'Remove',
                  })
                ) {
                  onRemove(entry.anilistId);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
