'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  Loader2,
  Plus,
  Search,
  X,
} from 'lucide-react';
import type { AnimeEntry, DayOfWeek, WatchStatus } from '@/lib/types';
import {
  DAY_LABELS,
  WATCH_STATUSES,
  WATCH_STATUS_CLASS,
  WATCH_STATUS_SHORT,
  computeAiredEpisodes,
  getTodayDay,
  timeToMinutes,
} from '@/lib/utils';

/** True iff the entry is actively WATCHING and its aired-episode count
 *  exceeds what the user has watched — i.e. you're behind on this show. */
function isWatchingBehind(a: AnimeEntry): boolean {
  if (a.watchStatus !== 'WATCHING') return false;
  const aired = computeAiredEpisodes(a);
  const watched = a.episodesWatched ?? 0;
  return aired != null && watched < aired;
}
import { AnimeCard } from './AnimeCard';
import { useConfirm } from './ConfirmDialog';

interface Props {
  animes: AnimeEntry[];
  seasonName: string;
  /** True iff this is the calendar's current season. Gates the airing-vs-
   *  watched indicator on each card — past seasons are done airing, future
   *  seasons haven't started, so the indicator is only useful here. */
  isCurrentSeason: boolean;
  onEdit: (entry: AnimeEntry) => void;
  onDelete: (id: string) => void;
  onUpdate: (entry: AnimeEntry) => void;
  onAddAnime: () => void;
  onImport: (file: File) => void;
  onExport: () => void;
  onImportJson: (file: File) => void;
  onExportJson: () => void;
  onToggleFavorite?: (entry: AnimeEntry) => void;
  onToggleInterested?: (entry: AnimeEntry) => void;
  isFavorited?: (anilistId: number) => boolean;
  isInterested?: (anilistId: number) => boolean;
  importing?: boolean;
  exporting?: boolean;
}

function ImportExportMenu({
  onImport,
  onExport,
  onImportJson,
  onExportJson,
  importing,
  exporting,
}: {
  onImport: (file: File) => void;
  onExport: () => void;
  onImportJson: (file: File) => void;
  onExportJson: () => void;
  importing?: boolean;
  exporting?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonFileRef = useRef<HTMLInputElement>(null);
  const busy = importing || exporting;
  const confirm = useConfirm();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          const ok = await confirm({
            title: 'Import workbook',
            message: `Import "${f.name}"? New seasons are appended; existing seasons get their anime merged (duplicates skipped).`,
            confirmText: 'Import',
          });
          if (ok) onImport(f);
        }}
      />
      <input
        ref={jsonFileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          const ok = await confirm({
            title: 'Restore from backup',
            message: `Restore from "${f.name}"? Existing entries with matching IDs will be updated; new entries appended. Nothing is deleted.`,
            confirmText: 'Restore',
          });
          if (ok) onImportJson(f);
        }}
      />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium disabled:opacity-50 disabled:cursor-wait"
        title="Import or export .xlsx"
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <ArrowDownToLine className="w-4 h-4" />
        )}
        <span className="hidden sm:inline">
          {importing ? 'Importing…' : exporting ? 'Exporting…' : 'I/O'}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-44 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl overflow-hidden z-30">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              fileRef.current?.click();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 text-left"
          >
            <ArrowUpFromLine className="w-4 h-4" />
            Import .xlsx
          </button>
          <button
            type="button"
            onClick={async () => {
              setOpen(false);
              const ok = await confirm({
                title: 'Export workbook',
                message: 'Export all your tracker seasons to a .xlsx workbook?',
                confirmText: 'Export',
              });
              if (ok) onExport();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 text-left border-t border-zinc-800"
          >
            <ArrowDownToLine className="w-4 h-4" />
            Export .xlsx
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              jsonFileRef.current?.click();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 text-left border-t-2 border-zinc-700"
          >
            <ArrowUpFromLine className="w-4 h-4" />
            Restore .json
          </button>
          <button
            type="button"
            onClick={async () => {
              setOpen(false);
              const ok = await confirm({
                title: 'Backup as JSON',
                message: 'Download a lossless JSON backup of every season?',
                confirmText: 'Download',
              });
              if (ok) onExportJson();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 text-left border-t border-zinc-800"
          >
            <ArrowDownToLine className="w-4 h-4" />
            Backup .json
          </button>
        </div>
      )}
    </div>
  );
}

const DAY_ORDER: Record<DayOfWeek, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

function sortFlow(a: AnimeEntry, b: AnimeEntry): number {
  const da = a.day != null ? DAY_ORDER[a.day] : 99;
  const db = b.day != null ? DAY_ORDER[b.day] : 99;
  if (da !== db) return da - db;
  if (!a.time && !b.time) return a.title.localeCompare(b.title);
  if (!a.time) return 1;
  if (!b.time) return -1;
  return a.time.localeCompare(b.time);
}

// Must mirror the xl: column count in the grid below.
const XL_COLS = 6;

export function ScheduleGrid({
  animes,
  seasonName,
  isCurrentSeason,
  onEdit,
  onDelete,
  onUpdate,
  onAddAnime,
  onImport,
  onExport,
  onImportJson,
  onExportJson,
  onToggleFavorite,
  onToggleInterested,
  isFavorited,
  isInterested,
  importing,
  exporting,
}: Props) {
  // Re-render once a minute so the "aired" highlight updates as time passes
  // without needing the user to refresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // If we're not on the current season, drop the BEHIND filter (it'd match
  // nothing meaningful and the pill wouldn't render anyway).
  useEffect(() => {
    if (!isCurrentSeason && statusFilter === 'BEHIND') {
      setStatusFilter('ALL');
    }
    // setStatusFilter is stable; intentionally narrow deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCurrentSeason]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    WatchStatus | 'ALL' | 'BEHIND'
  >('ALL');
  const q = search.trim().toLowerCase();
  const searched = q
    ? animes.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          (a.titleEnglish?.toLowerCase().includes(q) ?? false),
      )
    : animes;
  const filtered =
    statusFilter === 'ALL'
      ? searched
      : statusFilter === 'BEHIND'
        ? searched.filter(isWatchingBehind)
        : searched.filter((a) => a.watchStatus === statusFilter);
  const sorted = [...filtered].sort(sortFlow);

  // Pre-compute per-status counts off the unfiltered list so the pills show
  // how much each filter would surface even when one is currently active.
  // BEHIND is only meaningful on the current season — past seasons have no
  // live airing data, so we don't count or expose the pill there.
  const statusCounts: Record<WatchStatus | 'ALL' | 'BEHIND', number> = {
    ALL: animes.length,
    WATCHING: 0,
    COMPLETED: 0,
    DROPPED: 0,
    ON_HOLD: 0,
    PLAN: 0,
    BEHIND: 0,
  };
  for (const a of animes) {
    if (a.watchStatus) statusCounts[a.watchStatus]++;
    if (isCurrentSeason && isWatchingBehind(a)) statusCounts.BEHIND++;
  }
  const today = getTodayDay();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex gap-2 mb-6">
        <button
          type="button"
          onClick={onAddAnime}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium shrink-0"
          title="Add anime"
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
            placeholder={`Search ${animes.length} anime…`}
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
        <ImportExportMenu
          onImport={onImport}
          onExport={onExport}
          onImportJson={onImportJson}
          onExportJson={onExportJson}
          importing={importing}
          exporting={exporting}
        />
      </div>

      {animes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-5">
          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
              statusFilter === 'ALL'
                ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/60'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700'
            }`}
          >
            All{' '}
            <span className="text-zinc-500 tabular-nums">{statusCounts.ALL}</span>
          </button>
          {WATCH_STATUSES.map((s) => {
            const count = statusCounts[s];
            if (count === 0) return null;
            const active = statusFilter === s;
            const pill = (
              <button
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                  active
                    ? WATCH_STATUS_CLASS[s]
                    : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                {WATCH_STATUS_SHORT[s]}{' '}
                <span className={active ? 'opacity-70' : 'text-zinc-500'}>
                  {count}
                </span>
              </button>
            );
            // Slot the BEHIND pill right after WATCHING since it's a subset
            // of "currently watching" — only on the current season and only
            // when there's at least one show in that state.
            const showBehindPill =
              s === 'WATCHING' &&
              isCurrentSeason &&
              statusCounts.BEHIND > 0;
            if (!showBehindPill) return <div key={s}>{pill}</div>;
            const behindActive = statusFilter === 'BEHIND';
            return (
              <div key={s} className="contents">
                {pill}
                <button
                  type="button"
                  onClick={() => setStatusFilter('BEHIND')}
                  className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                    behindActive
                      ? 'bg-orange-500/20 text-orange-200 border-orange-400'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-orange-500/40'
                  }`}
                  title="Currently watching and behind on aired episodes"
                >
                  Behind{' '}
                  <span className={behindActive ? 'opacity-70' : 'text-zinc-500'}>
                    {statusCounts.BEHIND}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {q && sorted.length === 0 && animes.length > 0 && (
        <p className="text-center text-sm text-zinc-500 py-12">
          No titles match &quot;{search.trim()}&quot;.
        </p>
      )}

      {!q && filtered.length === 0 && animes.length > 0 && (
        <p className="text-center text-sm text-zinc-500 py-12">
          No anime under that filter.
        </p>
      )}

      {animes.length === 0 && (
        <div className="text-center py-16 max-w-md mx-auto">
          <h2 className="text-base font-semibold mb-1">
            No anime in &quot;{seasonName}&quot; yet
          </h2>
          <p className="text-sm text-zinc-400">
            Click <strong>Add</strong> above to search AniList, or import an .xlsx via
            the I/O menu.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-10 pt-7">
        {sorted.map((entry, i) => {
          const prev = i > 0 ? sorted[i - 1] : null;
          const isFirstOfDay = !prev || prev.day !== entry.day;
          const isXlRowStart = i > 0 && i % XL_COLS === 0;
          const dayName = entry.day ? DAY_LABELS[entry.day] : 'Unscheduled';
          const isUnscheduled = entry.day == null;
          // Today / Aired highlights only fire on the calendar's current
          // season. Past seasons are done airing; future seasons haven't
          // started — flagging a weekday as "today" there is misleading.
          const isToday =
            isCurrentSeason && !isUnscheduled && entry.day === today;
          const airMin = isToday ? timeToMinutes(entry.time) : null;
          const isAired = isToday && airMin != null && nowMinutes >= airMin;

          return (
            <div key={entry.id} className="relative">
              {isFirstOfDay && (
                <span
                  className={`absolute -top-7 left-0 text-xs font-semibold whitespace-nowrap ${
                    isToday
                      ? 'px-2 py-0.5 rounded-full bg-indigo-500 text-white shadow shadow-indigo-500/30'
                      : isUnscheduled
                        ? 'text-zinc-500 italic'
                        : 'text-indigo-300'
                  }`}
                >
                  {dayName}
                  {isToday && ' · Today'}
                </span>
              )}
              {!isFirstOfDay && isXlRowStart && (
                <span
                  className={`hidden xl:inline absolute -top-7 left-0 text-xs font-semibold whitespace-nowrap ${
                    isToday ? 'text-indigo-300' : 'text-zinc-500'
                  }`}
                >
                  {dayName}
                  {isToday && ' · Today'}
                </span>
              )}
              <AnimeCard
                entry={entry}
                onEdit={onEdit}
                onDelete={onDelete}
                onUpdate={onUpdate}
                showAiring={isCurrentSeason}
                onToggleFavorite={onToggleFavorite}
                onToggleInterested={onToggleInterested}
                isFavorited={isFavorited ? isFavorited(entry.anilistId) : false}
                isInterested={isInterested ? isInterested(entry.anilistId) : false}
                isToday={isToday}
                isAired={isAired}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
