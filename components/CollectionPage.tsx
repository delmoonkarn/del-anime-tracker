'use client';

import { useEffect, useState } from 'react';
import { useRef } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bookmark,
  ChevronDown,
  Heart,
  Loader2,
  Plus,
  Search,
  X,
} from 'lucide-react';
import type {
  AnilistTag,
  CollectionEntry,
  CollectionSection,
  CollectionSort,
  DiscoverItem,
} from '@/lib/types';
import { DiscoverCard } from './DiscoverCard';
import { TagFilterPicker } from './TagFilterPicker';
import { AddToCollectionModal } from './AddToCollectionModal';
import { useConfirm } from './ConfirmDialog';

interface Props {
  section: CollectionSection;
  collection: CollectionEntry[];
  onAdd: (item: DiscoverItem, section: CollectionSection) => void;
  onRemove: (anilistId: number, section: CollectionSection) => void;
  onSwitchSection: (section: CollectionSection) => void;
  onImport: (file: File) => void;
  onImportJson: (file: File) => void;
  onExportJson: () => void;
  importing?: boolean;
}

function compareReleaseDateAsc(a: CollectionEntry, b: CollectionEntry) {
  const ya = a.startDate?.year ?? 9999;
  const yb = b.startDate?.year ?? 9999;
  if (ya !== yb) return ya - yb;
  const ma = a.startDate?.month ?? 12;
  const mb = b.startDate?.month ?? 12;
  if (ma !== mb) return ma - mb;
  return (a.startDate?.day ?? 31) - (b.startDate?.day ?? 31);
}

export function CollectionPage({
  section,
  collection,
  onAdd,
  onRemove,
  onSwitchSection,
  onImport,
  onImportJson,
  onExportJson,
  importing,
}: Props) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<CollectionSort>('RELEASED_NEW');
  const [addOpen, setAddOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<AnilistTag[] | null>(null);
  const [exporting, setExporting] = useState(false);
  const [ioMenuOpen, setIoMenuOpen] = useState(false);
  const ioMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();

  useEffect(() => {
    if (!ioMenuOpen) return;
    const h = (e: MouseEvent) => {
      if (ioMenuRef.current && !ioMenuRef.current.contains(e.target as Node))
        setIoMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ioMenuOpen]);

  // Reset search/sort/tags when switching section so each page feels fresh.
  useEffect(() => {
    setSearch('');
    setSelectedTags([]);
  }, [section]);

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

  // Slice collection to current section
  const sectionItems = collection.filter((c) => c.section === section);

  // Filter by search
  const q = search.trim().toLowerCase();
  let filtered = q
    ? sectionItems.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          (c.titleEnglish?.toLowerCase().includes(q) ?? false),
      )
    : sectionItems;
  // Filter by selected tags (any match)
  if (selectedTags.length > 0) {
    const tagSet = new Set(selectedTags);
    filtered = filtered.filter((c) => c.tags.some((t) => tagSet.has(t)));
  }

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'RELEASED_NEW':
        return compareReleaseDateAsc(b, a);
      case 'RELEASED_OLD':
        return compareReleaseDateAsc(a, b);
      case 'ADDED_NEW':
        return b.addedAt - a.addedAt;
      case 'ADDED_OLD':
        return a.addedAt - b.addedAt;
      case 'TITLE_AZ':
        return a.title.localeCompare(b.title);
      case 'TITLE_ZA':
        return b.title.localeCompare(a.title);
      case 'SCORE_DESC':
        return (b.averageScore ?? -1) - (a.averageScore ?? -1);
    }
  });

  const isInCollection = (anilistId: number) =>
    collection.some((c) => c.anilistId === anilistId);

  const handleExport = async () => {
    if (exporting || collection.length === 0) return;
    const total = collection.length;
    const fav = collection.filter((c) => c.section === 'favorites').length;
    const intr = total - fav;
    const ok = await confirm({
      title: 'Export collection',
      message: `Export ${total} title${total === 1 ? '' : 's'} (${fav} favorites · ${intr} interested) to .xlsx?`,
      confirmText: 'Export',
    });
    if (!ok) return;
    setExporting(true);
    try {
      const { exportCollection } = await import('@/lib/export');
      await exportCollection(collection);
    } catch (err) {
      console.error('Collection export failed', err);
      await confirm({
        title: 'Export failed',
        message: 'Something went wrong while exporting. See the browser console for details.',
        alert: true,
        kind: 'danger',
      });
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (file: File) => {
    const ok = await confirm({
      title: 'Import collection',
      message: `Import "${file.name}" into your collection? New titles will be added; duplicates are skipped.`,
      confirmText: 'Import',
    });
    if (ok) onImport(file);
  };

  const isFavoritesView = section === 'favorites';
  const otherSection: CollectionSection = isFavoritesView ? 'interested' : 'favorites';
  const otherCount = collection.filter((c) => c.section === otherSection).length;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="border-b border-zinc-800 pb-4 mb-6">
        <p className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">
          My Collection
        </p>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <button
            type="button"
            onClick={() => onSwitchSection('favorites')}
            className={`text-2xl font-bold flex items-center gap-2 transition-colors ${
              isFavoritesView ? 'text-rose-400' : 'text-zinc-500 hover:text-zinc-200'
            }`}
            title="Go to Favorites"
          >
            <Heart
              className={`w-5 h-5 ${isFavoritesView ? 'fill-current' : ''}`}
            />
            Favorites
            <span
              className={`text-xs font-normal ${isFavoritesView ? 'text-zinc-500' : ''}`}
            >
              · {collection.filter((c) => c.section === 'favorites').length}
            </span>
          </button>
          <span className="text-zinc-700">/</span>
          <button
            type="button"
            onClick={() => onSwitchSection('interested')}
            className={`text-2xl font-bold flex items-center gap-2 transition-colors ${
              !isFavoritesView ? 'text-sky-400' : 'text-zinc-500 hover:text-zinc-200'
            }`}
            title="Go to Interested"
          >
            <Bookmark
              className={`w-5 h-5 ${!isFavoritesView ? 'fill-current' : ''}`}
            />
            Interested
            <span
              className={`text-xs font-normal ${!isFavoritesView ? 'text-zinc-500' : ''}`}
            >
              · {collection.filter((c) => c.section === 'interested').length}
            </span>
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium shrink-0"
              title={`Add anime to ${isFavoritesView ? 'Favorites' : 'Interested'}`}
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add</span>
            </button>
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  sectionItems.length > 0
                    ? `Search ${sectionItems.length} title${sectionItems.length === 1 ? '' : 's'}…`
                    : 'No entries yet'
                }
                disabled={sectionItems.length === 0}
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
            <div ref={ioMenuRef} className="relative shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImportFile(f);
                  e.target.value = '';
                }}
              />
              <input
                ref={jsonFileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  const ok = await confirm({
                    title: 'Restore collection',
                    message: `Restore from "${f.name}"? Existing entries (matched by AniList ID + section) will be updated; new entries appended. Nothing is deleted.`,
                    confirmText: 'Restore',
                  });
                  if (ok) onImportJson(f);
                }}
              />
              <button
                type="button"
                onClick={() => setIoMenuOpen((o) => !o)}
                disabled={importing || exporting}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium disabled:opacity-50 disabled:cursor-wait"
                title="Import or export .xlsx"
              >
                {importing || exporting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowDownToLine className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">
                  {importing ? 'Importing…' : exporting ? 'Exporting…' : 'I/O'}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${ioMenuOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {ioMenuOpen && (
                <div className="absolute right-0 mt-2 w-44 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl overflow-hidden z-30">
                  <button
                    type="button"
                    onClick={() => {
                      setIoMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 text-left"
                  >
                    <ArrowUpFromLine className="w-4 h-4" />
                    Import .xlsx
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIoMenuOpen(false);
                      handleExport();
                    }}
                    disabled={collection.length === 0}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 text-left border-t border-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ArrowDownToLine className="w-4 h-4" />
                    Export .xlsx
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIoMenuOpen(false);
                      jsonFileInputRef.current?.click();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 text-left border-t-2 border-zinc-700"
                  >
                    <ArrowUpFromLine className="w-4 h-4" />
                    Restore .json
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setIoMenuOpen(false);
                      if (collection.length === 0) return;
                      const ok = await confirm({
                        title: 'Backup collection as JSON',
                        message: `Download a lossless JSON backup of ${collection.length} entr${
                          collection.length === 1 ? 'y' : 'ies'
                        }?`,
                        confirmText: 'Download',
                      });
                      if (ok) onExportJson();
                    }}
                    disabled={collection.length === 0}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 text-left border-t border-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ArrowDownToLine className="w-4 h-4" />
                    Backup .json
                  </button>
                </div>
              )}
            </div>
          </div>

          {sectionItems.length > 0 && (
            <>
              <div className="flex items-center gap-3">
                <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wide">
                  Sort
                </label>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as CollectionSort)}
                  className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
                >
                  <option value="RELEASED_NEW">Released — newest</option>
                  <option value="RELEASED_OLD">Released — oldest</option>
                  <option value="ADDED_NEW">Added — newest</option>
                  <option value="ADDED_OLD">Added — oldest</option>
                  <option value="TITLE_AZ">Title A → Z</option>
                  <option value="TITLE_ZA">Title Z → A</option>
                  <option value="SCORE_DESC">Score (high → low)</option>
                </select>
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
            </>
          )}
        </div>
      </div>

      {sectionItems.length === 0 && (
        <div className="text-center py-24 max-w-md mx-auto">
          {isFavoritesView ? (
            <Heart className="w-10 h-10 mx-auto mb-3 text-rose-400/60" />
          ) : (
            <Bookmark className="w-10 h-10 mx-auto mb-3 text-sky-400/60" />
          )}
          <h2 className="text-lg font-semibold mb-1">
            No {isFavoritesView ? 'favorites' : 'interested titles'} yet
          </h2>
          <p className="text-sm text-zinc-400">
            Click <strong>Add</strong> above to search AniList, or use the menu on any
            schedule / discover card.
            {otherCount > 0 && (
              <>
                {' '}
                You have {otherCount} {isFavoritesView ? 'interested' : 'favorite'}
                {otherCount === 1 ? '' : 's'} on the other tab.
              </>
            )}
          </p>
        </div>
      )}

      {sectionItems.length > 0 && sorted.length === 0 && (
        <p className="text-center text-sm text-zinc-500 py-12">No results.</p>
      )}

      {sorted.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {sorted.map((entry) => (
            <DiscoverCard
              key={entry.anilistId}
              item={entry}
              alreadyAdded
              onAdd={() => {}}
              favorited={entry.section === 'favorites'}
              interested={entry.section === 'interested'}
              onRemove={async () => {
                const what =
                  entry.section === 'favorites' ? 'Favorites' : 'Interested';
                const ok = await confirm({
                  title: `Remove from ${what}`,
                  message: `Remove "${entry.title}" from ${what}?`,
                  kind: 'danger',
                  confirmText: 'Remove',
                });
                if (ok) onRemove(entry.anilistId, entry.section);
              }}
            />
          ))}
        </div>
      )}

      <AddToCollectionModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={(item) => onAdd(item, section)}
        isInCollection={isInCollection}
      />
    </div>
  );
}
