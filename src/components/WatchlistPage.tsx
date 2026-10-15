import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clock, Compass, Heart, Loader2, Minus, MoreVertical, Pencil, Plus, Tv } from 'lucide-react';
import type { AnilistMedia, DiscoverItem, ScheduleProgress, WatchStatus } from '@/lib/types';
import { useOpenDetail, useRememberAnilistLinks, useWatchLinks } from '@/lib/nav';
import { toAnilistLinks } from '@/lib/streamLinks';
import { AIRING_STATUS_LABEL, BTN_ICON, BTN_PRIMARY, MENU, SURFACE, pillClass } from '@/lib/ui';
import { formatNextAiring, nextProgressOnDec, nextProgressOnInc, nextProgressOnSetStatus } from '@/lib/utils';
import { useClickOutside } from '@/hooks/useClickOutside';
import { StatusPill } from './StatusPill';
import { PageHeader } from './PageHeader';
import { ServiceLinks } from './ServiceLogo';
import { ViewModeToggle, usePersistedViewMode, type ViewMode } from './ViewModeToggle';

/** A show marked Watching, from any schedule season or the collection. */
export interface WatchItem {
  anilistId: number;
  title: string;
  titleEnglish?: string;
  imageUrl: string;
  totalEpisodes?: number;
  /** Cached airing data from the schedule entry, used until AniList answers. */
  nextAiringEpisode?: number;
  nextAiringAt?: number;
}

interface Props {
  items: WatchItem[];
  progressOf: (anilistId: number) => ScheduleProgress | undefined;
  onUpdateProgress: (anilistId: number, next: ScheduleProgress) => void;
  isFavorited: (anilistId: number) => boolean;
  onToggleFavorite: (item: DiscoverItem) => void;
  onExplore: () => void;
  /** True when the show has a schedule entry the Edit form can open. */
  canEdit: (anilistId: number) => boolean;
  onEdit: (anilistId: number) => void;
}

// 0 = Sunday, like Date#getDay.
const WEEKDAY_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
// Must mirror the xl: column count of the card grid.
const XL_COLS = 6;
/** null = shows with no upcoming episode date. */
type DayFilter = 'all' | number | null;

interface Row {
  item: WatchItem;
  media?: AnilistMedia;
  total?: number;
  /** Episodes out so far, null when unknown. */
  aired: number | null;
  next: { episode: number; airingAt: number } | null;
  /** Weekday of the next episode. */
  day: number | null;
  /** Seconds since the start of the week, for ordering within a day. */
  sortKey: number;
}

function buildRow(item: WatchItem, media: AnilistMedia | undefined, nowSec: number): Row {
  const total = media?.episodes ?? item.totalEpisodes ?? undefined;
  const next =
    media !== undefined
      ? (media.nextAiringEpisode ?? null)
      : item.nextAiringEpisode != null && item.nextAiringAt != null
        ? { episode: item.nextAiringEpisode, airingAt: item.nextAiringAt }
        : null;
  let aired: number | null = null;
  if (next) aired = Math.max(0, nowSec < next.airingAt ? next.episode - 1 : next.episode);
  else if (media?.status === 'NOT_YET_RELEASED') aired = 0;
  else if (total != null) aired = total;
  if (aired != null && total != null) aired = Math.min(aired, total);
  const date = next ? new Date(next.airingAt * 1000) : null;
  return {
    item,
    media,
    total,
    aired,
    next,
    day: date ? date.getDay() : null,
    sortKey: date ? date.getDay() * 86400 + date.getHours() * 3600 + date.getMinutes() * 60 : Infinity,
  };
}

export function WatchlistPage({
  items,
  progressOf,
  onUpdateProgress,
  isFavorited,
  onToggleFavorite,
  onExplore,
  canEdit,
  onEdit,
}: Props) {
  const [fresh, setFresh] = useState<Map<number, AnilistMedia>>(new Map());
  const rememberAnilistLinks = useRememberAnilistLinks();
  const [loading, setLoading] = useState(false);
  const [dayFilter, setDayFilter] = useState<DayFilter>('all');
  const [viewMode, setViewMode] = usePersistedViewMode('watchlistViewMode', 'list');
  const today = new Date().getDay();
  const nowSec = Date.now() / 1000;

  // Live airing data, episode counts and streaming links for every show on
  // the list — only for ids we haven't fetched yet, 50 per request.
  const idsKey = items.map((i) => i.anilistId).sort((a, b) => a - b).join(',');
  useEffect(() => {
    const missing = items.map((i) => i.anilistId).filter((id) => !fresh.has(id));
    if (missing.length === 0) return;
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const { getAnimesByIds } = await import('@/lib/anilist');
        for (let i = 0; i < missing.length; i += 50) {
          const media = await getAnimesByIds(missing.slice(i, i + 50), controller.signal);
          if (controller.signal.aborted) return;
          rememberAnilistLinks(Object.fromEntries(media.map((m) => [m.id, toAnilistLinks(m.externalLinks)])));
          setFresh((prev) => {
            const next = new Map(prev);
            for (const m of media) next.set(m.id, m);
            return next;
          });
        }
      } catch (err) {
        if (!controller.signal.aborted) console.warn('[watchlist] airing fetch failed:', err);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
    // Keyed on the id list; `fresh` is read only to skip known ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const rows = items.map((i) => buildRow(i, fresh.get(i.anilistId), nowSec));
  const countFor = (day: number | null) => rows.filter((r) => r.day === day).length;
  // List view starts from today so what airs next is on top; card view keeps
  // the schedule's Mon → Sun flow.
  const dayOrder =
    viewMode === 'list'
      ? [...WEEK_ORDER.slice(WEEK_ORDER.indexOf(today)), ...WEEK_ORDER.slice(0, WEEK_ORDER.indexOf(today))]
      : WEEK_ORDER;
  const groups: { day: number | null; items: Row[] }[] = [
    ...dayOrder.map((d) => ({
      day: d as number | null,
      items: rows.filter((r) => r.day === d).sort((a, b) => a.sortKey - b.sortKey),
    })),
    { day: null, items: rows.filter((r) => r.day === null) },
  ].filter((g) => (dayFilter === 'all' ? g.items.length > 0 || g.day === today : g.day === dayFilter));

  if (items.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
        <PageHeader title="Watchlist" description="Every show you're watching, across all seasons." />
        <div className="my-6 flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-800 px-6 py-14 text-center">
          <span className="mb-1 grid h-12 w-12 place-items-center rounded-full bg-zinc-800 text-zinc-500">
            <Tv className="h-6 w-6" />
          </span>
          <h3 className="font-semibold">You're not watching anything</h3>
          <p className="text-sm text-zinc-400">Set a show's status to “Watching” to see how far behind you are.</p>
          <button type="button" className={`${BTN_PRIMARY} mt-3`} onClick={onExplore}>
            <Compass className="h-4 w-4" />
            Browse this season
          </button>
        </div>
      </div>
    );
  }

  const noDateCount = countFor(null);
  const renderEntry = (r: Row) => (
    <WatchingEntry
      row={r}
      layout={viewMode}
      progress={progressOf(r.item.anilistId)}
      onUpdate={(next) => onUpdateProgress(r.item.anilistId, next)}
      favorited={isFavorited(r.item.anilistId)}
      onEdit={canEdit(r.item.anilistId) ? () => onEdit(r.item.anilistId) : undefined}
      onToggleFavorite={() =>
        onToggleFavorite({
          anilistId: r.item.anilistId,
          title: r.item.title,
          titleEnglish: r.item.titleEnglish,
          imageUrl: r.item.imageUrl,
          tags: [],
        })
      }
    />
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
      <PageHeader
        title="Watchlist"
        count={items.length}
        description="Every show you're watching, across all seasons, by the day its next episode airs."
        actions={
          <>
            {loading && (
              <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Checking AniList…
              </span>
            )}
            <ViewModeToggle value={viewMode} onChange={setViewMode} />
          </>
        }
      />

      <div className="flex flex-col gap-6">
        {/* Sticks under the navbar so the filter stays reachable while scrolling. */}
        <div
          className="sticky top-14 z-10 -mx-4 -my-2 flex items-center gap-1.5 overflow-x-auto bg-zinc-950/90 px-4 py-2 backdrop-blur-md [scrollbar-width:none] sm:flex-wrap [&>*]:shrink-0"
          role="group"
          aria-label="Filter by airing day"
        >
          <button type="button" className={pillClass(dayFilter === 'all')} aria-pressed={dayFilter === 'all'} onClick={() => setDayFilter('all')}>
            All days <span className="tabular-nums opacity-60">{items.length}</span>
          </button>
          {WEEK_ORDER.map((d) => {
            const n = countFor(d);
            return (
              <button
                key={d}
                type="button"
                className={`${pillClass(dayFilter === d)} ${n === 0 && dayFilter !== d ? 'opacity-50' : ''}`}
                aria-pressed={dayFilter === d}
                aria-label={`${WEEKDAY_LABEL[d]}${d === today ? ' (today)' : ''}, ${n} show${n === 1 ? '' : 's'}`}
                onClick={() => setDayFilter(d)}
              >
                {d === today && <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" aria-hidden />}
                {WEEKDAY_LABEL[d].slice(0, 3)} <span className="tabular-nums opacity-60">{n}</span>
              </button>
            );
          })}
          {noDateCount > 0 && (
            <button type="button" className={pillClass(dayFilter === null, 'info')} aria-pressed={dayFilter === null} onClick={() => setDayFilter(null)}>
              No date <span className="tabular-nums opacity-60">{noDateCount}</span>
            </button>
          )}
        </div>

        {viewMode === 'card' && groups.every((g) => g.items.length === 0) ? (
          <p className="py-12 text-center text-sm text-zinc-400">
            {dayFilter === null
              ? 'Every show has a next episode date.'
              : dayFilter !== 'all'
                ? `Nothing you watch airs on ${WEEKDAY_LABEL[dayFilter]}.`
                : 'Nothing to show.'}
          </p>
        ) : viewMode === 'card' ? (
          // Card view, like the schedule's: one continuous grid with the day
          // name floating above each day's first card (repeated at the start
          // of each xl row), "No upcoming episode" shows after a full-width line.
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-10 pt-7">
            {groups.flatMap((g, gi) =>
              g.items.map((r, i) => {
                const flatIndex = groups.slice(0, gi).reduce((n, x) => n + x.items.length, 0) + i;
                const isXlRowStart = flatIndex > 0 && flatIndex % XL_COLS === 0;
                const isToday = g.day === today;
                const noDate = g.day === null;
                const label = noDate ? '' : WEEKDAY_LABEL[g.day as number];
                return (
                  <div key={r.item.anilistId} className="contents">
                    {noDate && i === 0 && (
                      <div className="col-span-full flex items-center gap-3 mt-2">
                        <span className="text-sm font-semibold text-zinc-300 shrink-0">No upcoming episode</span>
                        <div className="flex-1 border-t border-zinc-800" aria-hidden />
                      </div>
                    )}
                    <div className="relative">
                      {!noDate && i === 0 && (
                        <span
                          className={`absolute -top-7 left-0 text-xs font-semibold whitespace-nowrap ${
                            isToday
                              ? 'px-2 py-0.5 rounded-full bg-indigo-500 text-white shadow shadow-indigo-500/30'
                              : 'text-indigo-300'
                          }`}
                        >
                          {label}
                          {isToday && ' · Today'}
                        </span>
                      )}
                      {!noDate && i > 0 && isXlRowStart && (
                        <span
                          className={`hidden xl:inline absolute -top-7 left-0 text-xs font-semibold whitespace-nowrap ${
                            isToday ? 'text-indigo-300' : 'text-zinc-500'
                          }`}
                        >
                          {label}
                          {isToday && ' · Today'}
                        </span>
                      )}
                      {renderEntry(r)}
                    </div>
                  </div>
                );
              }),
            )}
          </div>
        ) : (
        groups.map((g) => {
          const isToday = g.day === today;
          return (
            <section
              key={g.day ?? 'none'}
              aria-current={isToday ? 'date' : undefined}
              aria-labelledby={`day-${g.day ?? 'none'}`}
              className={`scroll-mt-32 rounded-xl ${isToday ? 'border border-indigo-500/40 bg-indigo-500/5 p-3 sm:p-4' : ''}`}
            >
              <h2 id={`day-${g.day ?? 'none'}`} className="mb-3 flex items-center gap-2 text-sm font-semibold">
                {g.day === null ? 'No upcoming episode' : WEEKDAY_LABEL[g.day]}
                {isToday && (
                  <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-[0.6875rem] font-semibold text-white">Today</span>
                )}
                <span className="tabular-nums text-zinc-500">{g.items.length}</span>
                <span className="flex-1 border-t border-zinc-800" aria-hidden />
              </h2>
              {g.items.length === 0 ? (
                <p className="text-sm text-zinc-400">
                  {isToday
                    ? 'Nothing you watch airs today.'
                    : g.day === null
                      ? 'Every show has a next episode date.'
                      : `Nothing you watch airs on ${WEEKDAY_LABEL[g.day]}.`}
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {g.items.map((r) => (
                    <li key={r.item.anilistId}>{renderEntry(r)}</li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
        )}
      </div>
    </div>
  );
}

/** One watched show, as a row (list view) or a poster card (card view).
 *  Both layouts share the same stepper, status menu and links. */
function WatchingEntry({
  row,
  layout,
  progress,
  onUpdate,
  favorited,
  onToggleFavorite,
  onEdit,
}: {
  row: Row;
  layout: ViewMode;
  progress?: ScheduleProgress;
  onUpdate: (next: ScheduleProgress) => void;
  favorited: boolean;
  onToggleFavorite: () => void;
  /** Opens the schedule Edit form; absent for collection-only shows. */
  onEdit?: () => void;
}) {
  const { item, media, total, aired, next } = row;
  const openDetail = useOpenDetail();
  const links = useWatchLinks(item.anilistId);
  const watched = progress?.episodesWatched ?? 0;
  const status = progress?.watchStatus;
  const behind = aired != null ? aired - watched : null;
  const atEnd = total != null && watched >= total;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useClickOutside(menuRef, menuOpen, closeMenu);
  const setStatus = (s: WatchStatus | undefined) => {
    onUpdate({ ...nextProgressOnSetStatus(s, watched, total), totalEpisodes: total });
    setMenuOpen(false);
  };

  const airedLine = aired === null ? 'Aired: unknown' : `Aired: ep ${aired}`;
  // Local air time of the weekly slot, from the next episode's timestamp.
  const airTime = next
    ? `${String(new Date(next.airingAt * 1000).getHours()).padStart(2, '0')}:${String(
        new Date(next.airingAt * 1000).getMinutes(),
      ).padStart(2, '0')}`
    : null;
  const nextLine = next ? `Next: ${formatNextAiring(next.episode, next.airingAt)}` : null;

  const chips = (
    <div className="flex flex-wrap items-center gap-1">
      {/* Same status pill as the schedule cards. */}
      <StatusPill status={status} onChange={(s) => setStatus(s ?? undefined)} />
      {media?.status && (
        <span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-xs font-medium text-zinc-300">
          {AIRING_STATUS_LABEL[media.status] ?? media.status}
        </span>
      )}
      {behind !== null &&
        (behind > 0 ? (
          <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium text-amber-300">Behind by {behind}</span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-xs font-medium text-emerald-300">
            <Check className="h-3 w-3" />
            Caught up
          </span>
        ))}
    </div>
  );

  // Card layout squeezes into a 2-column phone grid, so its stepper is tighter.
  const stepW = layout === 'card' ? 'w-7' : 'w-8';
  const stepper = (
    <div
      className={`flex h-8 overflow-hidden rounded-lg border border-zinc-800 ${layout === 'card' ? 'flex-1' : ''}`}
      role="group"
      aria-label={`Episodes watched of ${item.title}`}
    >
      <button
        type="button"
        className={`grid ${stepW} shrink-0 place-items-center bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40`}
        disabled={watched <= 0}
        onClick={() => onUpdate({ ...nextProgressOnDec(watched, total, status), totalEpisodes: total })}
        aria-label="One episode less"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className={`flex flex-1 items-center justify-center bg-zinc-950 text-sm font-medium tabular-nums ${layout === 'card' ? 'min-w-0 px-1' : 'min-w-16 px-2'}`}>
        {layout === 'card' ? `${watched}/${total ?? '?'}` : `${watched} / ${total ?? '?'}`}
      </span>
      <button
        type="button"
        className={`grid ${stepW} shrink-0 place-items-center bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40`}
        disabled={atEnd}
        onClick={() => onUpdate({ ...nextProgressOnInc(watched, total, status), totalEpisodes: total })}
        aria-label="One episode more"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const menu = (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        className={BTN_ICON}
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        aria-label={`More actions for ${item.title}`}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {menuOpen && (
        <div
          className={`${MENU} absolute right-0 p-1 text-sm ${
            // Card view opens upward so the next row of cards can't cover it.
            layout === 'card' ? 'w-40 bottom-full mb-1' : 'w-48 top-full mt-1'
          }`}
        >
          {onEdit && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-zinc-800"
              onClick={() => {
                setMenuOpen(false);
                onEdit();
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          )}
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-zinc-800"
            onClick={() => {
              onToggleFavorite();
              setMenuOpen(false);
            }}
          >
            <Heart className={`h-3.5 w-3.5 ${favorited ? 'fill-current text-rose-400' : ''}`} />
            {favorited ? 'Unfavorite' : 'Favorite'}
          </button>
        </div>
      )}
    </div>
  );

  const poster = item.imageUrl ? (
    <img
      src={item.imageUrl}
      alt=""
      loading="lazy"
      className={`h-full w-full object-cover ${layout === 'card' ? 'transition-transform duration-300 group-hover:scale-[1.03]' : ''}`}
    />
  ) : (
    <Tv className="m-auto h-5 w-5 text-zinc-600" />
  );

  if (layout === 'card') {
    const behindCard = behind !== null && behind > 0;
    return (
      <article
        className={`group ${SURFACE} flex h-full flex-col transition-shadow hover:shadow-lg hover:shadow-black/30 ${
          behindCard ? 'border-amber-500/50' : 'hover:border-zinc-700'
        }`}
      >
        {/* Only the poster is clipped, so menus can spill past the card. */}
        <div className="relative overflow-hidden rounded-t-xl">
          <button
            type="button"
            onClick={() => openDetail(item.anilistId)}
            className="block aspect-[2/3] w-full overflow-hidden bg-zinc-800"
            aria-label={`Open ${item.title}`}
          >
            {poster}
          </button>
          <ServiceLinks links={links} title={item.title} className="absolute bottom-2 left-2" />
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-3">
          <h3 className="text-sm font-semibold leading-snug">
            <button
              type="button"
              onClick={() => openDetail(item.anilistId)}
              className="line-clamp-2 text-left hover:text-indigo-300"
              title={item.title}
            >
              {item.title}
            </button>
          </h3>
          <p className="flex items-center gap-1.5 text-xs text-zinc-300">
            {airTime && (
              <>
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span>{airTime}</span>
                <span className="text-zinc-600">·</span>
              </>
            )}
            <span className="truncate">{airedLine}</span>
          </p>
          {nextLine && <p className="text-xs text-indigo-300">{nextLine}</p>}
          {chips}
          <div className="mt-auto flex items-center gap-1.5 pt-2">
            {stepper}
            {menu}
          </div>
        </div>
      </article>
    );
  }

  return (
    <div className={`${SURFACE} flex flex-wrap items-center gap-3 p-3 transition-colors hover:border-zinc-700 sm:flex-nowrap sm:gap-4`}>
      <button
        type="button"
        onClick={() => openDetail(item.anilistId)}
        className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-zinc-800"
        aria-label={`Open ${item.title}`}
      >
        {poster}
      </button>

      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
        <button
          type="button"
          onClick={() => openDetail(item.anilistId)}
          className="truncate text-left font-semibold hover:text-indigo-300"
          title={item.title}
        >
          {item.title}
        </button>
        <p className="text-xs text-zinc-300 sm:text-sm">
          {airedLine}
          {nextLine && (
            <>
              <span className="mx-2 text-zinc-600">·</span>
              <span className="text-indigo-300">{nextLine}</span>
            </>
          )}
        </p>
        {chips}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <ServiceLinks links={links} title={item.title} max={6} size="w-6 h-6" className="justify-end" />
        {stepper}
        {menu}
      </div>
    </div>
  );
}
