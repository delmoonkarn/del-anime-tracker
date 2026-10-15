import { useCallback, useRef, useState } from 'react';
import {
  Bookmark,
  Check,
  Clock,
  Heart,
  Minus,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  Tv,
} from 'lucide-react';
import type { AnimeEntry, WatchStatus } from '@/lib/types';
import { entryLink, useOpenDetail, useWatchLinks } from '@/lib/nav';
import { BTN_ICON, MENU, MENU_ITEM, SURFACE } from '@/lib/ui';
import {
  WATCH_STATUS_CLASS,
  WATCH_STATUS_LABELS,
  computeAiredEpisodes,
  formatNextAiring,
  nextProgressOnDec,
  nextProgressOnInc,
  nextProgressOnSetStatus,
} from '@/lib/utils';
import { useClickOutside } from '@/hooks/useClickOutside';
import { StatusPill } from './StatusPill';
import { useConfirm } from './ConfirmDialog';
import { ServiceLinks } from './ServiceLogo';
import type { ViewMode } from './ViewModeToggle';

interface Props {
  entry: AnimeEntry;
  layout: ViewMode;
  onEdit: (entry: AnimeEntry) => void;
  onDelete: (id: string) => void;
  onUpdate?: (entry: AnimeEntry) => void;
  /** True only on the calendar's current season — gates the aired / next /
   *  behind info, which needs live airing data. */
  showAiring?: boolean;
  onToggleFavorite?: (entry: AnimeEntry) => void;
  onToggleInterested?: (entry: AnimeEntry) => void;
  isFavorited?: boolean;
  isInterested?: boolean;
  isToday?: boolean;
  isAired?: boolean;
}


/** A schedule entry drawn like a Watchlist entry: poster card (card view) or
 *  row (list view), with the status pill, the episode stepper and a ⋯ menu
 *  holding edit, favorite / interested and delete. */
export function ScheduleEntry({
  entry,
  layout,
  onEdit,
  onDelete,
  onUpdate,
  showAiring,
  onToggleFavorite,
  onToggleInterested,
  isFavorited,
  isInterested,
  isToday,
  isAired,
}: Props) {
  const openDetail = useOpenDetail();
  const confirm = useConfirm();
  const canOpen = entry.anilistId > 0;
  // Bound shows use their saved links; an unbound row has its one link inline.
  const savedLinks = useWatchLinks(entry.anilistId);
  const links = canOpen ? savedLinks : entryLink(entry);

  const watched = entry.episodesWatched ?? 0;
  const total = entry.totalEpisodes;
  const status = entry.watchStatus;
  const atEnd = total != null && watched >= total;
  const aired = showAiring ? computeAiredEpisodes(entry) : null;
  const behind = aired != null && status === 'WATCHING' ? aired - watched : null;
  const isBehind = behind != null && behind > 0;
  const isDropped = !!showAiring && status === 'DROPPED';
  const nowSec = Date.now() / 1000;
  const next =
    showAiring && entry.nextAiringEpisode != null && entry.nextAiringAt != null && entry.nextAiringAt > nowSec
      ? { episode: entry.nextAiringEpisode, airingAt: entry.nextAiringAt }
      : null;
  const showEnglish = entry.titleEnglish && entry.titleEnglish.trim() && entry.titleEnglish !== entry.title;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useClickOutside(menuRef, menuOpen, closeMenu);

  const update = (n: { episodesWatched: number; watchStatus: WatchStatus | undefined }) =>
    onUpdate?.({ ...entry, episodesWatched: n.episodesWatched, watchStatus: n.watchStatus });
  const setStatus = (s: WatchStatus | undefined) => {
    update(nextProgressOnSetStatus(s, watched, total));
    setMenuOpen(false);
  };
  const remove = async () => {
    setMenuOpen(false);
    if (
      await confirm({
        title: 'Remove anime',
        message: `Remove "${entry.title}" from this season?`,
        kind: 'danger',
        confirmText: 'Remove',
      })
    ) {
      onDelete(entry.id);
    }
  };

  const airedLine = showAiring && aired != null ? `Aired: ep ${aired}` : null;
  const nextLine = next ? `Next: ${formatNextAiring(next.episode, next.airingAt)}` : null;
  // Air time and "Aired: ep N" share one line to keep the card short.
  const timeLine = (
    <p className="flex items-center gap-1.5 text-xs text-zinc-300">
      <Clock className={`h-3.5 w-3.5 shrink-0 ${isToday ? 'text-indigo-300' : ''}`} />
      <span className={`${isToday ? 'font-semibold text-indigo-300' : ''} ${isAired ? 'line-through opacity-80' : ''}`}>
        {entry.time || '—'}
      </span>
      {airedLine && (
        <>
          <span className="text-zinc-600">·</span>
          <span className="truncate">{airedLine}</span>
        </>
      )}
    </p>
  );

  const chips = (
    <div className="flex flex-wrap items-center gap-1">
      {/* The schedule's own status pill: click to pick a watch status. */}
      {onUpdate ? (
        <StatusPill status={status} onChange={(s) => setStatus(s ?? undefined)} />
      ) : (
        status && (
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${WATCH_STATUS_CLASS[status]}`}>
            {WATCH_STATUS_LABELS[status]}
          </span>
        )
      )}
      {isAired && (
        <span className="rounded-md bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-zinc-950">Aired</span>
      )}
      {behind != null &&
        (behind > 0 ? (
          <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium text-amber-300">Behind by {behind}</span>
        ) : (
          aired != null &&
          aired > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-xs font-medium text-emerald-300">
              <Check className="h-3 w-3" />
              Caught up
            </span>
          )
        ))}
    </div>
  );

  // Card layout squeezes into a 2-column phone grid, so its stepper is tighter.
  const stepW = layout === 'card' ? 'w-7' : 'w-8';
  const stepper = onUpdate && (
    <div
      className={`flex h-8 overflow-hidden rounded-lg border border-zinc-800 ${layout === 'card' ? 'flex-1' : ''}`}
      role="group"
      aria-label={`Episodes watched of ${entry.title}`}
    >
      <button
        type="button"
        className={`grid ${stepW} shrink-0 place-items-center bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40`}
        disabled={watched <= 0}
        onClick={() => update(nextProgressOnDec(watched, total, status))}
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
        onClick={() => update(nextProgressOnInc(watched, total, status))}
        aria-label="One episode more"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const canFavorite = entry.anilistId > 0;
  const menu = (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        className={BTN_ICON}
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        aria-label={`More actions for ${entry.title}`}
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
          <button
            type="button"
            className={MENU_ITEM}
            onClick={() => {
              setMenuOpen(false);
              onEdit(entry);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          {canFavorite && onToggleFavorite && (
            <button
              type="button"
              className={MENU_ITEM}
              onClick={() => {
                setMenuOpen(false);
                onToggleFavorite(entry);
              }}
            >
              <Heart className={`h-3.5 w-3.5 ${isFavorited ? 'fill-current text-rose-400' : ''}`} />
              {isFavorited ? 'Unfavorite' : 'Favorite'}
            </button>
          )}
          {canFavorite && onToggleInterested && (
            <button
              type="button"
              className={MENU_ITEM}
              onClick={() => {
                setMenuOpen(false);
                onToggleInterested(entry);
              }}
            >
              <Bookmark className={`h-3.5 w-3.5 ${isInterested ? 'fill-current text-sky-400' : ''}`} />
              {isInterested ? 'Not interested' : 'Interested'}
            </button>
          )}
          <button type="button" className={`${MENU_ITEM} text-red-300`} onClick={() => void remove()}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );

  const posterImg = entry.imageUrl ? (
    <img
      src={entry.imageUrl}
      alt=""
      loading="lazy"
      className={`h-full w-full object-cover ${layout === 'card' ? 'transition-transform duration-300 group-hover:scale-[1.03]' : ''} ${
        isAired ? 'opacity-70 saturate-75' : ''
      }`}
    />
  ) : (
    <Tv className="m-auto h-5 w-5 text-zinc-600" />
  );
  // Poster opens the detail page; entries with no AniList match have no
  // detail page, so they keep linking to the streaming site.
  const poster = (className: string) =>
    canOpen ? (
      <button type="button" onClick={() => openDetail(entry.anilistId)} className={className} aria-label={`Open ${entry.title}`}>
        {posterImg}
      </button>
    ) : entry.platformUrl ? (
      <a href={entry.platformUrl} target="_blank" rel="noopener noreferrer" className={className}>
        {posterImg}
      </a>
    ) : (
      <div className={className}>{posterImg}</div>
    );
  const title = (className: string) =>
    canOpen ? (
      <button type="button" onClick={() => openDetail(entry.anilistId)} className={`${className} text-left hover:text-indigo-300`} title={entry.title}>
        {entry.title}
      </button>
    ) : (
      <span className={className} title={entry.title}>
        {entry.title}
      </span>
    );
  const marks = (isInterested || isFavorited) && (
    <span className="flex gap-1">
      {isInterested && <Bookmark className="h-3.5 w-3.5 fill-current text-sky-400" aria-label="Interested" />}
      {isFavorited && <Heart className="h-3.5 w-3.5 fill-current text-rose-400" aria-label="Favorite" />}
    </span>
  );

  const outline = isBehind ? 'border-amber-500/50' : 'hover:border-zinc-700';
  const dim = isDropped ? 'opacity-60 saturate-50' : '';

  if (layout === 'card') {
    return (
      <article
        className={`group ${SURFACE} flex h-full flex-col transition-shadow hover:shadow-lg hover:shadow-black/30 ${outline} ${dim}`}
      >
        {/* Only the poster is clipped, so the ⋯ / status menus can spill past
            the card's edges on narrow (2-column) layouts. */}
        <div className="relative overflow-hidden rounded-t-xl">
          {poster('block aspect-[2/3] w-full overflow-hidden bg-zinc-800')}
          {entry.status && (
            <span className="pointer-events-none absolute left-2 top-2 rounded-full border border-indigo-500/30 bg-black/70 px-2 py-0.5 text-xs font-medium text-indigo-200 backdrop-blur">
              {entry.status}
            </span>
          )}
          {marks && (
            <span className="pointer-events-none absolute right-2 top-2 drop-shadow-[0_0_3px_rgba(0,0,0,0.85)]">{marks}</span>
          )}
          <ServiceLinks links={links} title={entry.title} className="absolute bottom-2 left-2" />
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-3">
          <h3 className="text-sm font-semibold leading-snug">{title('line-clamp-2')}</h3>
          {timeLine}
          {nextLine && <p className="text-xs text-indigo-300">{nextLine}</p>}
          {chips}
          <div className="mt-auto flex items-center gap-1.5 pt-2">
            {stepper ?? <span className="flex-1" />}
            {menu}
          </div>
        </div>
      </article>
    );
  }

  return (
    <div className={`${SURFACE} flex flex-wrap items-center gap-3 p-3 transition-colors sm:flex-nowrap sm:gap-4 ${outline} ${dim}`}>
      {poster('h-20 w-14 shrink-0 overflow-hidden rounded-md bg-zinc-800')}

      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          {title('truncate font-semibold')}
          {marks}
        </div>
        {showEnglish && (
          <p className="truncate text-xs text-zinc-400" title={entry.titleEnglish}>
            {entry.titleEnglish}
          </p>
        )}
        <p className="flex flex-wrap items-center gap-x-2 text-xs">
          {timeLine}
          {nextLine && (
            <>
              <span className="text-zinc-600">·</span>
              <span className="text-indigo-300">{nextLine}</span>
            </>
          )}
        </p>
        {chips}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {entry.status && (
          <span className="hidden rounded-full border border-indigo-500/30 bg-black/40 px-2 py-0.5 text-xs font-medium text-indigo-200 lg:inline">
            {entry.status}
          </span>
        )}
        <ServiceLinks links={links} title={entry.title} size="w-6 h-6" className="justify-end" />
        {stepper}
        {menu}
      </div>
    </div>
  );
}
