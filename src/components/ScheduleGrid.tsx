import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  Loader2,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { AnimeEntry, DayOfWeek, WatchStatus } from '@/lib/types';
import {
  DAYS,
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
import { ScheduleEntry } from './ScheduleEntry';
import { useConfirm } from './ConfirmDialog';
import { PageHeader } from './PageHeader';
import { ViewModeToggle, usePersistedViewMode } from './ViewModeToggle';
import { BTN_PRIMARY, FIELD, MENU, pillClass } from '@/lib/ui';

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
  // Sticky format choice — affects both Import (file-picker filter) and
  // Export (which serializer runs). Defaults to xlsx as the more-common
  // human-readable format.
  const [format, setFormat] = useState<'xlsx' | 'json'>('xlsx');
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
        <div className={`absolute right-0 mt-2 w-44 ${MENU}`}>
          {/* Format toggle — segmented control. Picks which input the
              Import button opens AND which serializer Export runs. */}
          <div className="flex gap-0.5 p-1 m-2 bg-zinc-950 rounded-lg">
            {(['xlsx', 'json'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setFormat(opt)}
                className={`flex-1 px-2 py-1 text-[11px] font-semibold rounded transition-colors ${
                  format === opt
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
              setOpen(false);
              (format === 'xlsx' ? fileRef : jsonFileRef).current?.click();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 text-left border-t border-zinc-700"
          >
            <ArrowUpFromLine className="w-4 h-4" />
            Import
          </button>
          <button
            type="button"
            onClick={async () => {
              setOpen(false);
              if (format === 'xlsx') {
                const ok = await confirm({
                  title: 'Export workbook',
                  message: 'Export all your tracker seasons to a .xlsx workbook?',
                  confirmText: 'Export',
                });
                if (ok) onExport();
              } else {
                const ok = await confirm({
                  title: 'Backup as JSON',
                  message: 'Download a lossless JSON backup of every season?',
                  confirmText: 'Download',
                });
                if (ok) onExportJson();
              }
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 text-left border-t border-zinc-700"
          >
            <ArrowDownToLine className="w-4 h-4" />
            Export
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

// Must mirror the xl: column count of the card grid.
const XL_COLS = 6;

/** Which section the day pills show: one weekday, unscheduled, movies, or everything. */
type GroupKey = DayOfWeek | 'none' | 'movies';
type DayFilter = 'all' | GroupKey;

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
  const [viewMode, setViewMode] = usePersistedViewMode('scheduleViewMode');
  const [dayFilter, setDayFilter] = useState<DayFilter>('all');
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
  // Split movies into a separate group rendered at the bottom of the grid
  // under their own "Movies" header. They don't fit the day-of-week
  // rhythm of TV entries (release date, not weekly broadcast).
  const isMovie = (e: AnimeEntry) => e.format === 'MOVIE';
  const sortedShows = [...filtered.filter((e) => !isMovie(e))].sort(sortFlow);
  const sortedMovies = [...filtered.filter(isMovie)].sort((a, b) =>
    a.title.localeCompare(b.title),
  );
  const sorted = [...sortedShows, ...sortedMovies];

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

  // Sections like the Watchlist page: one per weekday, then Unscheduled,
  // then Movies (they don't follow a weekly rhythm).
  const groupOf = (e: AnimeEntry): GroupKey => (isMovie(e) ? 'movies' : (e.day ?? 'none'));
  const countForGroup = (key: GroupKey) => sorted.filter((e) => groupOf(e) === key).length;
  const todayIdx = DAYS.indexOf(today);
  // Card view keeps the old Mon → Sun flow; list view starts from today.
  const dayOrder =
    isCurrentSeason && viewMode === 'list' ? [...DAYS.slice(todayIdx), ...DAYS.slice(0, todayIdx)] : DAYS;
  const sections: { key: GroupKey; items: AnimeEntry[] }[] = [
    ...dayOrder.map((d) => ({ key: d as GroupKey, items: sorted.filter((e) => groupOf(e) === d) })),
    { key: 'none' as GroupKey, items: sorted.filter((e) => groupOf(e) === 'none') },
    { key: 'movies' as GroupKey, items: sorted.filter((e) => groupOf(e) === 'movies') },
  ].filter((sec) =>
    dayFilter === 'all'
      ? sec.items.length > 0 || (isCurrentSeason && sec.key === today)
      : sec.key === dayFilter,
  );

  const renderEntry = (entry: AnimeEntry, inMovies: boolean) => {
    // Today / Aired highlights only fire on the calendar's current season.
    // Movies opt out — they don't air weekly.
    const isToday = isCurrentSeason && !inMovies && entry.day != null && entry.day === today;
    const airMin = isToday ? timeToMinutes(entry.time) : null;
    const isAired = isToday && airMin != null && nowMinutes >= airMin;
    const shared = {
      entry,
      onEdit,
      onDelete,
      onUpdate,
      showAiring: isCurrentSeason,
      onToggleFavorite,
      onToggleInterested,
      isFavorited: isFavorited ? isFavorited(entry.anilistId) : false,
      isInterested: isInterested ? isInterested(entry.anilistId) : false,
      isToday,
      isAired,
    };
    return <ScheduleEntry {...shared} layout={viewMode} />;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
      <PageHeader
        title={
          <>
            {seasonName}
            {isCurrentSeason && (
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
        count={animes.length}
        actions={
          <>
            <ViewModeToggle value={viewMode} onChange={setViewMode} />
            <ImportExportMenu
              onImport={onImport}
              onExport={onExport}
              onImportJson={onImportJson}
              onExportJson={onExportJson}
              importing={importing}
              exporting={exporting}
            />
            <button type="button" onClick={onAddAnime} className={BTN_PRIMARY} title="Add anime">
              <Plus className="w-4 h-4" />
              Add
            </button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${FIELD} flex w-full items-center gap-2 sm:w-60`}>
            <Search className="h-4 w-4 shrink-0 text-zinc-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Filter ${animes.length} anime…`}
              aria-label="Filter this season by title"
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
          {animes.length > 0 && (
            <>
              <span className="mx-1 hidden h-5 border-l border-zinc-800 sm:block" aria-hidden />
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Watch status">
                <button
                  type="button"
                  onClick={() => setStatusFilter('ALL')}
                  className={pillClass(statusFilter === 'ALL')}
                  aria-pressed={statusFilter === 'ALL'}
                >
                  All <span className="tabular-nums opacity-60">{statusCounts.ALL}</span>
                </button>
                {WATCH_STATUSES.map((s) => {
                  const count = statusCounts[s];
                  if (count === 0) return null;
                  const active = statusFilter === s;
                  const pill = (
                    <button
                      type="button"
                      onClick={() => setStatusFilter(s)}
                      className={
                        active
                          ? `inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium ${WATCH_STATUS_CLASS[s]}`
                          : pillClass(false)
                      }
                      aria-pressed={active}
                    >
                      {WATCH_STATUS_SHORT[s]} <span className="tabular-nums opacity-60">{count}</span>
                    </button>
                  );
                  // Slot the BEHIND pill right after WATCHING since it's a subset
                  // of "currently watching" — only on the current season and only
                  // when there's at least one show in that state.
                  const showBehindPill = s === 'WATCHING' && isCurrentSeason && statusCounts.BEHIND > 0;
                  if (!showBehindPill) return <div key={s} className="contents">{pill}</div>;
                  const behindActive = statusFilter === 'BEHIND';
                  return (
                    <div key={s} className="contents">
                      {pill}
                      <button
                        type="button"
                        onClick={() => setStatusFilter('BEHIND')}
                        className={
                          behindActive
                            ? 'inline-flex h-7 items-center gap-1.5 rounded-full border border-orange-400 bg-orange-500/20 px-3 text-xs font-medium text-orange-200'
                            : pillClass(false)
                        }
                        aria-pressed={behindActive}
                        title="Currently watching and behind on aired episodes"
                      >
                        Behind <span className="tabular-nums opacity-60">{statusCounts.BEHIND}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </PageHeader>

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

      {animes.length > 0 && filtered.length > 0 && (
        <div className="flex flex-col gap-6">
          {/* Sticks under the navbar so the day filter stays reachable while scrolling. */}
          <div
            className="sticky top-14 z-10 -mx-4 -my-2 flex items-center gap-1.5 overflow-x-auto bg-zinc-950/90 px-4 py-2 backdrop-blur-md [scrollbar-width:none] sm:flex-wrap [&>*]:shrink-0"
            role="group"
            aria-label="Filter by airing day"
          >
            <button
              type="button"
              className={pillClass(dayFilter === 'all')}
              aria-pressed={dayFilter === 'all'}
              onClick={() => setDayFilter('all')}
            >
              All days <span className="tabular-nums opacity-60">{sorted.length}</span>
            </button>
            {DAYS.map((d) => {
              const n = countForGroup(d);
              const isTodayPill = isCurrentSeason && d === today;
              return (
                <button
                  key={d}
                  type="button"
                  className={`${pillClass(dayFilter === d)} ${n === 0 && dayFilter !== d ? 'opacity-50' : ''}`}
                  aria-pressed={dayFilter === d}
                  aria-label={`${DAY_LABELS[d]}${isTodayPill ? ' (today)' : ''}, ${n} show${n === 1 ? '' : 's'}`}
                  onClick={() => setDayFilter(d)}
                >
                  {isTodayPill && <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" aria-hidden />}
                  {d} <span className="tabular-nums opacity-60">{n}</span>
                </button>
              );
            })}
            {countForGroup('none') > 0 && (
              <button
                type="button"
                className={pillClass(dayFilter === 'none', 'info')}
                aria-pressed={dayFilter === 'none'}
                onClick={() => setDayFilter('none')}
              >
                No day <span className="tabular-nums opacity-60">{countForGroup('none')}</span>
              </button>
            )}
            {countForGroup('movies') > 0 && (
              <button
                type="button"
                className={pillClass(dayFilter === 'movies', 'info')}
                aria-pressed={dayFilter === 'movies'}
                onClick={() => setDayFilter('movies')}
              >
                Movies <span className="tabular-nums opacity-60">{countForGroup('movies')}</span>
              </button>
            )}
          </div>

          {viewMode === 'card' && sections.every((sec) => sec.items.length === 0) ? (
            <p className="py-12 text-center text-sm text-zinc-400">
              {dayFilter === 'none'
                ? 'No unscheduled shows.'
                : dayFilter === 'movies'
                  ? 'No movies this season.'
                  : dayFilter !== 'all'
                    ? `Nothing airs on ${DAY_LABELS[dayFilter]}.`
                    : 'Nothing to show.'}
            </p>
          ) : viewMode === 'card' ? (
            // Card view: one continuous grid, the day name floating above the
            // first card of each day (repeated at the start of each xl row),
            // and a full-width "Movies" / "Unscheduled" line before those.
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-10 pt-7">
              {sections.flatMap((sec) =>
                sec.items.map((entry, i) => {
                  const inMovies = sec.key === 'movies';
                  const flatIndex = sections
                    .slice(0, sections.indexOf(sec))
                    .reduce((n, x) => n + x.items.length, 0) + i;
                  const isXlRowStart = flatIndex > 0 && flatIndex % XL_COLS === 0;
                  const isTodayGroup = isCurrentSeason && sec.key === today;
                  const label =
                    sec.key === 'none' ? 'Unscheduled' : sec.key === 'movies' ? 'Movies' : DAY_LABELS[sec.key];
                  return (
                    <div key={entry.id} className="contents">
                      {inMovies && i === 0 && (
                        <div className="col-span-full flex items-center gap-3 mt-2">
                          <span className="text-sm font-semibold text-zinc-300 shrink-0">Movies</span>
                          <div className="flex-1 border-t border-zinc-800" aria-hidden />
                        </div>
                      )}
                      <div className="relative">
                        {!inMovies && i === 0 && (
                          <span
                            className={`absolute -top-7 left-0 text-xs font-semibold whitespace-nowrap ${
                              isTodayGroup
                                ? 'px-2 py-0.5 rounded-full bg-indigo-500 text-white shadow shadow-indigo-500/30'
                                : sec.key === 'none'
                                  ? 'text-zinc-500 italic'
                                  : 'text-indigo-300'
                            }`}
                          >
                            {label}
                            {isTodayGroup && ' · Today'}
                          </span>
                        )}
                        {!inMovies && i > 0 && isXlRowStart && (
                          <span
                            className={`hidden xl:inline absolute -top-7 left-0 text-xs font-semibold whitespace-nowrap ${
                              isTodayGroup ? 'text-indigo-300' : 'text-zinc-500'
                            }`}
                          >
                            {label}
                            {isTodayGroup && ' · Today'}
                          </span>
                        )}
                        {renderEntry(entry, inMovies)}
                      </div>
                    </div>
                  );
                }),
              )}
            </div>
          ) : (
          sections.map((sec) => {
            const isTodaySection = isCurrentSeason && sec.key === today;
            const title =
              sec.key === 'none' ? 'Unscheduled' : sec.key === 'movies' ? 'Movies' : DAY_LABELS[sec.key];
            return (
              <section
                key={sec.key}
                aria-current={isTodaySection ? 'date' : undefined}
                aria-labelledby={`sched-${sec.key}`}
                className={`scroll-mt-32 rounded-xl ${
                  isTodaySection ? 'border border-indigo-500/40 bg-indigo-500/5 p-3 sm:p-4' : ''
                }`}
              >
                <h2 id={`sched-${sec.key}`} className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <span className={sec.key === 'none' ? 'italic text-zinc-400' : ''}>{title}</span>
                  {isTodaySection && (
                    <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-[0.6875rem] font-semibold text-white">
                      Today
                    </span>
                  )}
                  <span className="tabular-nums text-zinc-500">{sec.items.length}</span>
                  <span className="flex-1 border-t border-zinc-800" aria-hidden />
                </h2>
                {sec.items.length === 0 ? (
                  <p className="text-sm text-zinc-400">
                    {isTodaySection ? 'Nothing on this schedule airs today.' : `Nothing airs on ${title}.`}
                  </p>
                ) : viewMode === 'list' ? (
                  <ul className="flex flex-col gap-3">
                    {sec.items.map((entry) => (
                      <li key={entry.id}>{renderEntry(entry, sec.key === 'movies')}</li>
                    ))}
                  </ul>
                ) : (
                  <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {sec.items.map((entry) => (
                      <li key={entry.id}>{renderEntry(entry, sec.key === 'movies')}</li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })
          )}
        </div>
      )}
    </div>
  );
}
