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
  ScheduleProgress,
} from '@/lib/types';
import { BTN_PRIMARY, EYEBROW, FIELD, MENU } from '@/lib/ui';
import { compareReleaseDate } from '@/lib/utils';
import { useIsPhone } from '@/hooks/useIsPhone';
import { CollectionCard } from './CollectionCard';
import { PageHeader } from './PageHeader';
import { TagFilterPicker } from './TagFilterPicker';
import { AddToCollectionModal } from './AddToCollectionModal';
import { useConfirm } from './ConfirmDialog';
import { passesStatusFilter, StatusFilterPills, type StatusFilter } from './StatusFilter';

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
  /** anilistId → watch progress from the Schedule, mirrored onto collection
   *  cards so favorites/interested entries show "Watching · 3/12" etc. */
  progressByAnilistId?: Map<number, ScheduleProgress>;
  /** When present, the collection card's progress row becomes editable:
   *  status pill turns into a dropdown, counter gets +/- buttons. Updates
   *  flow back through App and broadcast to all matching schedule entries. */
  onUpdateProgress?: (anilistId: number, next: ScheduleProgress) => void;
  /** Set / clear the user's personal 1–5 rating for the collection item. */
  onSetUserScore?: (anilistId: number, score: number | null) => void;
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
  progressByAnilistId,
  onUpdateProgress,
  onSetUserScore,
}: Props) {

  // A show can be in both lists; the card's heart / bookmark reflect both.
  const inSection = (anilistId: number, which: CollectionSection) =>
    collection.some((c) => c.anilistId === anilistId && c.section === which);
  /** Removing from the list being viewed asks first, since the card goes away. */
  const removeFrom = async (entry: CollectionEntry, which: CollectionSection) => {
    if (which === section) {
      const what = which === 'favorites' ? 'Favorites' : 'Interested';
      const ok = await confirm({
        title: `Remove from ${what}`,
        message: `Remove "${entry.title}" from ${what}?`,
        kind: 'danger',
        confirmText: 'Remove',
      });
      if (!ok) return;
    }
    onRemove(entry.anilistId, which);
  };
  const toggleSection = async (entry: CollectionEntry, which: CollectionSection) => {
    if (inSection(entry.anilistId, which)) await removeFrom(entry, which);
    else onAdd(entry, which);
  };
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<CollectionSort>('RELEASED_NEW');
  const [addOpen, setAddOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  // Multi-select status filter — empty set means "no filter, show everything".
  const [selectedStatuses, setSelectedStatuses] = useState<Set<StatusFilter>>(
    new Set(),
  );
  const [allTags, setAllTags] = useState<AnilistTag[] | null>(null);
  const [exporting, setExporting] = useState(false);
  const [ioMenuOpen, setIoMenuOpen] = useState(false);
  // Sticky format choice — drives both Import (file picker filter) and
  // Export (which serializer runs). Defaults to xlsx.
  const [ioFormat, setIoFormat] = useState<'xlsx' | 'json'>('xlsx');
  const ioMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const phone = useIsPhone();

  useEffect(() => {
    if (!ioMenuOpen) return;
    const h = (e: MouseEvent) => {
      if (ioMenuRef.current && !ioMenuRef.current.contains(e.target as Node))
        setIoMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ioMenuOpen]);

  // Reset search/sort/tags/status when switching section so each page feels fresh.
  useEffect(() => {
    setSearch('');
    setSelectedTags([]);
    setSelectedStatuses(new Set());
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
  // Filter by selected watch statuses (any match). Untracked: not on the
  // schedule, or there with no status yet.
  filtered = filtered.filter((c) =>
    passesStatusFilter(progressByAnilistId?.get(c.anilistId)?.watchStatus, selectedStatuses),
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
        // Sort by the user's own 1–5 rating now that AniList's average score
        // is hidden on collection cards. Unrated entries sink to the bottom.
        return (b.userScore ?? -1) - (a.userScore ?? -1);
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
    <div className="max-w-7xl mx-auto px-4 py-4 sm:py-8">
      <PageHeader
        title="Collection"
        actions={
          <>
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
                <div className={`absolute right-0 mt-2 w-44 ${MENU}`}>
                  {/* Format toggle — segmented control. Picks which input
                      the Import button opens AND which serializer Export
                      runs. */}
                  <div className="flex gap-0.5 p-1 m-2 bg-zinc-950 rounded-lg">
                    {(['xlsx', 'json'] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setIoFormat(opt)}
                        className={`flex-1 px-2 py-1 text-[11px] font-semibold rounded transition-colors ${
                          ioFormat === opt
                            ? 'bg-indigo-500 text-white'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        .{opt}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIoMenuOpen(false);
                      (ioFormat === 'xlsx'
                        ? fileInputRef
                        : jsonFileInputRef
                      ).current?.click();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 text-left border-t border-zinc-700"
                  >
                    <ArrowUpFromLine className="w-4 h-4" />
                    Import
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setIoMenuOpen(false);
                      if (collection.length === 0) return;
                      if (ioFormat === 'xlsx') {
                        handleExport();
                      } else {
                        const ok = await confirm({
                          title: 'Backup collection as JSON',
                          message: `Download a lossless JSON backup of ${collection.length} entr${
                            collection.length === 1 ? 'y' : 'ies'
                          }?`,
                          confirmText: 'Download',
                        });
                        if (ok) onExportJson();
                      }
                    }}
                    disabled={collection.length === 0}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 text-left border-t border-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ArrowDownToLine className="w-4 h-4" />
                    Export
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className={BTN_PRIMARY}
              title={`Add anime to ${isFavoritesView ? 'Favorites' : 'Interested'}`}
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </>
        }
      >
        {/* Favorites / Interested tabs */}
        <div role="tablist" className="flex gap-1 border-b border-zinc-800">
          {(
            [
              { key: 'favorites', label: 'Favorites', Icon: Heart, tone: 'border-rose-500 text-rose-300' },
              { key: 'interested', label: 'Interested', Icon: Bookmark, tone: 'border-sky-500 text-sky-300' },
            ] as const
          ).map(({ key, label, Icon, tone }) => {
            const active = section === key;
            const n = collection.filter((c) => c.section === key).length;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSwitchSection(key)}
                className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  active ? tone : 'border-transparent text-zinc-400 hover:text-zinc-100'
                }`}
              >
                <Icon className={`h-4 w-4 ${active ? 'fill-current' : ''}`} />
                {label}
                <span className="rounded-full bg-zinc-800 px-1.5 text-[0.6875rem] font-semibold tabular-nums text-zinc-300">
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        {sectionItems.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className={`${FIELD} flex w-full items-center gap-2 sm:w-60`}>
                <Search className="h-4 w-4 shrink-0 text-zinc-500" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Filter ${sectionItems.length} title${sectionItems.length === 1 ? '' : 's'}…`}
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
                <option value="RELEASED_NEW">Released — newest</option>
                <option value="RELEASED_OLD">Released — oldest</option>
                <option value="ADDED_NEW">Added — newest</option>
                <option value="ADDED_OLD">Added — oldest</option>
                <option value="TITLE_AZ">Title A → Z</option>
                <option value="TITLE_ZA">Title Z → A</option>
                <option value="SCORE_DESC">Your score (high → low)</option>
              </select>
              <span className="mx-1 hidden h-5 border-l border-zinc-800 sm:block" aria-hidden />
              <StatusFilterPills
                statuses={sectionItems.map((c) => progressByAnilistId?.get(c.anilistId)?.watchStatus)}
                selected={selectedStatuses}
                onChange={setSelectedStatuses}
              />
            </div>
            <div className="flex items-start gap-3">
              <span className={`${EYEBROW} pt-1.5`}>Tags</span>
              <div className="min-w-0 flex-1">
                <TagFilterPicker allTags={allTags} selected={selectedTags} onChange={setSelectedTags} />
              </div>
            </div>
          </>
        )}
      </PageHeader>

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
        <div className={phone ? 'flex flex-col gap-2' : 'grid grid-cols-3 gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'}>
          {sorted.map((entry) => (
            <CollectionCard
              key={entry.anilistId}
              entry={entry}
              layout={phone ? 'row' : 'card'}
              favorited={inSection(entry.anilistId, 'favorites')}
              interested={inSection(entry.anilistId, 'interested')}
              onToggleFavorite={() => void toggleSection(entry, 'favorites')}
              onToggleInterested={() => void toggleSection(entry, 'interested')}
              onRemove={() => void removeFrom(entry, entry.section)}
              // Fall back to an empty progress object so the editor renders
              // even for items that have no stored progress yet (untouched
              // collection-only entries). totalEpisodes defaults to the
              // AniList episode count from the entry itself.
              progress={
                progressByAnilistId?.get(entry.anilistId) ?? {
                  totalEpisodes: entry.episodes,
                }
              }
              onUpdateProgress={
                onUpdateProgress
                  ? (next) => onUpdateProgress(entry.anilistId, next)
                  : undefined
              }
              userScore={entry.userScore}
              onSetUserScore={
                onSetUserScore
                  ? (score) => onSetUserScore(entry.anilistId, score)
                  : undefined
              }
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
