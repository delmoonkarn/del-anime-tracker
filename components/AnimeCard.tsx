'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  Clock,
  ExternalLink,
  Heart,
  Minus,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  Tv,
} from 'lucide-react';
import type { AnimeEntry, WatchStatus } from '@/lib/types';
import {
  WATCH_STATUSES,
  WATCH_STATUS_CLASS,
  WATCH_STATUS_LABELS,
  computeAiredEpisodes,
  formatCountdown,
} from '@/lib/utils';
import { useConfirm } from './ConfirmDialog';

interface Props {
  entry: AnimeEntry;
  onEdit: (entry: AnimeEntry) => void;
  onDelete: (id: string) => void;
  /** Inline-edit path for progress + watch status. When omitted, the card
   *  renders the read-only counter & status pill. */
  onUpdate?: (entry: AnimeEntry) => void;
  /** True only on the calendar's current season — gates the "ep N aired /
   *  X behind" indicator. Past/future seasons get just the progress row. */
  showAiring?: boolean;
  onToggleFavorite?: (entry: AnimeEntry) => void;
  onToggleInterested?: (entry: AnimeEntry) => void;
  isFavorited?: boolean;
  isInterested?: boolean;
  isToday?: boolean;
  isAired?: boolean;
}

/** Status dropdown — small pill that opens a floating menu of the 5 enum
 *  values plus a "Clear" option. Native <select> would be simpler but doesn't
 *  style well across browsers; this matches the rest of the app's menus. */
function StatusPill({
  status,
  onChange,
}: {
  status?: WatchStatus;
  onChange: (next: WatchStatus | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const pillClass = status
    ? WATCH_STATUS_CLASS[status]
    : 'bg-zinc-800/70 text-zinc-400 border-zinc-700';
  const label = status ? WATCH_STATUS_LABELS[status] : '— Status —';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`text-[10px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap hover:brightness-125 ${pillClass}`}
        title="Watch status"
      >
        {label}
      </button>
      {open && (
        <div className="absolute left-0 bottom-full mb-1 w-32 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl overflow-hidden z-30">
          {WATCH_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setOpen(false);
                onChange(s);
              }}
              className={`w-full text-left text-[11px] px-2.5 py-1.5 hover:bg-zinc-800 ${
                s === status ? 'bg-zinc-800/50 font-semibold' : ''
              }`}
            >
              {WATCH_STATUS_LABELS[s]}
            </button>
          ))}
          {status && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onChange(null);
              }}
              className="w-full text-left text-[11px] px-2.5 py-1.5 text-zinc-400 hover:bg-zinc-800 border-t border-zinc-800"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** "ep N aired · caught up / X behind · airs in 3h" — the airing-vs-watched
 *  comparison shown right below the progress row. Returns null when there's
 *  no useful info (no airing cache AND no totalEpisodes). */
function AiringIndicator({ entry }: { entry: AnimeEntry }) {
  // Re-render every minute so the "in 3h 12m" countdown stays fresh without
  // waiting for an external state change.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const aired = computeAiredEpisodes(entry);
  const watched = entry.episodesWatched ?? 0;
  const nowSec = Date.now() / 1000;
  const upcoming =
    entry.nextAiringEpisode != null &&
    entry.nextAiringAt != null &&
    entry.nextAiringAt > nowSec;

  // Nothing useful to show — bail.
  if (aired == null && !upcoming) return null;

  const delta = aired != null ? aired - watched : null;
  let deltaLabel: string | null = null;
  let deltaClass = 'text-zinc-500';
  if (delta != null) {
    if (delta > 0) {
      deltaLabel = `${delta} behind`;
      deltaClass = 'text-amber-400';
    } else if (delta === 0 && aired != null && aired > 0) {
      deltaLabel = 'caught up';
      deltaClass = 'text-emerald-400';
    }
  }

  const showFirstRow = (aired != null && aired > 0) || deltaLabel != null;
  const showSecondRow =
    upcoming && entry.nextAiringEpisode != null && entry.nextAiringAt != null;

  return (
    <div className="text-xs mt-0.5 leading-tight space-y-0.5">
      {/* Row 1: "what's happened" — aired so far + the delta vs watched. */}
      {showFirstRow && (
        <div className="flex items-center gap-1.5">
          {aired != null && aired > 0 && (
            <span className="text-zinc-300 tabular-nums">ep {aired} aired</span>
          )}
          {deltaLabel && (
            <>
              {aired != null && aired > 0 && (
                <span className="text-zinc-500">·</span>
              )}
              <span className={`font-medium ${deltaClass}`}>{deltaLabel}</span>
            </>
          )}
        </div>
      )}
      {/* Row 2: "what's coming" — next-airing episode countdown. */}
      {showSecondRow && (
        <div
          className="text-indigo-300 tabular-nums"
          title={`Episode ${entry.nextAiringEpisode}`}
        >
          ep {entry.nextAiringEpisode} {formatCountdown(entry.nextAiringAt!)}
        </div>
      )}
    </div>
  );
}

/** Episode counter + status pill row, with the auto-flip rules:
 *   - 0 → 1     : PLAN/undefined → WATCHING
 *   - n → total : WATCHING → COMPLETED
 *   - back down : COMPLETED → WATCHING when watched drops below total again
 */
function WatchProgressRow({
  entry,
  onUpdate,
}: {
  entry: AnimeEntry;
  onUpdate: (e: AnimeEntry) => void;
}) {
  const watched = entry.episodesWatched ?? 0;
  const total = entry.totalEpisodes;
  const atCap = total != null && watched >= total;

  const handleInc = () => {
    if (atCap) return;
    const next = watched + 1;
    let watchStatus = entry.watchStatus;
    if (watched === 0 && (watchStatus === undefined || watchStatus === 'PLAN')) {
      watchStatus = 'WATCHING';
    }
    if (total != null && next === total) {
      watchStatus = 'COMPLETED';
    }
    onUpdate({ ...entry, episodesWatched: next, watchStatus });
  };

  const handleDec = () => {
    if (watched === 0) return;
    const next = watched - 1;
    let watchStatus = entry.watchStatus;
    if (watchStatus === 'COMPLETED' && (total == null || next < total)) {
      watchStatus = 'WATCHING';
    }
    onUpdate({ ...entry, episodesWatched: next, watchStatus });
  };

  const handleSetStatus = (s: WatchStatus | null) => {
    onUpdate({ ...entry, watchStatus: s ?? undefined });
  };

  return (
    <div className="flex items-center gap-1 mt-1">
      <StatusPill status={entry.watchStatus} onChange={handleSetStatus} />
      <div className="ml-auto inline-flex items-center gap-0.5">
        <button
          type="button"
          onClick={handleDec}
          disabled={watched === 0}
          className="w-5 h-5 rounded bg-zinc-800 hover:bg-indigo-500 hover:text-white text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-zinc-800 flex items-center justify-center"
          title="Decrement episodes watched"
        >
          <Minus className="w-3 h-3" />
        </button>
        <span className="text-[11px] tabular-nums px-1 text-zinc-300">
          {watched}
          {total != null && <span className="text-zinc-400">/{total}</span>}
        </span>
        <button
          type="button"
          onClick={handleInc}
          disabled={atCap}
          className="w-5 h-5 rounded bg-zinc-800 hover:bg-indigo-500 hover:text-white text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-zinc-800 flex items-center justify-center"
          title={atCap ? 'All episodes watched' : 'Increment episodes watched'}
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function CardActionMenu({
  onEdit,
  onDelete,
  onToggleFavorite,
  onToggleInterested,
  isFavorited,
  isInterested,
  canFavorite,
}: {
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite?: () => void;
  onToggleInterested?: () => void;
  isFavorited?: boolean;
  isInterested?: boolean;
  canFavorite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="p-1.5 rounded-full bg-black/70 backdrop-blur text-zinc-200 hover:bg-zinc-700"
        title="More actions"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl overflow-hidden z-20">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-200 hover:bg-indigo-500 hover:text-white text-left"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
          {canFavorite && onToggleFavorite && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onToggleFavorite();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-200 hover:bg-rose-500 hover:text-white text-left border-t border-zinc-800"
            >
              <Heart
                className={`w-3.5 h-3.5 ${isFavorited ? 'fill-current text-rose-400' : ''}`}
              />
              {isFavorited ? 'Unfavorite' : 'Favorite'}
            </button>
          )}
          {canFavorite && onToggleInterested && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onToggleInterested();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-200 hover:bg-sky-500 hover:text-white text-left border-t border-zinc-800"
            >
              <Bookmark
                className={`w-3.5 h-3.5 ${isInterested ? 'fill-current text-sky-400' : ''}`}
              />
              {isInterested ? 'Not interested' : 'Interested'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-200 hover:bg-red-500 hover:text-white text-left border-t border-zinc-800"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function CoverWrap({
  url,
  className,
  children,
}: {
  url: string;
  className: string;
  children: React.ReactNode;
}) {
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return <div className={className}>{children}</div>;
}

export function AnimeCard({
  entry,
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
  const confirm = useConfirm();

  // "Behind" = actively WATCHING but the aired count exceeds what's watched.
  // Gated on showAiring because only the current calendar season has live
  // airing data — past seasons would falsely flag everything as "behind".
  const aired = showAiring ? computeAiredEpisodes(entry) : null;
  const watched = entry.episodesWatched ?? 0;
  const isBehind =
    !!showAiring &&
    entry.watchStatus === 'WATCHING' &&
    aired != null &&
    watched < aired;
  // On-hold dim only fires on the current season — past/future season
  // schedules stay at full saturation so completed/dropped/on-hold cards
  // read uniformly. The +/- counter and status pill themselves stay
  // editable on every season; this only affects card-level opacity.
  const isOnHold = !!showAiring && entry.watchStatus === 'ON_HOLD';

  // Card-outer priority: behind beats today, because "you're falling behind"
  // is a stronger signal than "it airs today". Single loud "shine" variant
  // — two concentric halos (tight + wide) — applied to every behind state
  // regardless of whether it airs today. Static, no animation.
  let cardOuter: string;
  if (isBehind) {
    cardOuter =
      'border-orange-300 ring-[3px] ring-orange-400 shadow-[0_0_30px_rgba(249,115,22,0.65),0_0_60px_rgba(249,115,22,0.35)]';
  } else if (isToday && isAired) {
    cardOuter =
      'border-amber-400 ring-2 ring-amber-500/60 shadow-lg shadow-amber-500/30';
  } else if (isToday) {
    cardOuter =
      'border-indigo-400 ring-2 ring-indigo-500/60 shadow-lg shadow-indigo-500/30';
  } else {
    cardOuter = 'border-zinc-800 hover:border-zinc-700';
  }
  // On-hold cards are visually muted — the show is paused, lower priority.
  const onHoldDim = isOnHold ? 'opacity-60 saturate-50' : '';
  const bodyTint = isBehind ? 'bg-orange-500/25' : '';

  const showEnglish =
    entry.titleEnglish && entry.titleEnglish.trim() && entry.titleEnglish !== entry.title;

  return (
    <div
      className={`group relative bg-zinc-900 rounded-xl overflow-hidden border transition-all hover:-translate-y-0.5 shadow-lg shadow-black/20 flex flex-col ${cardOuter} ${onHoldDim}`}
    >
      <CoverWrap
        url={entry.platformUrl}
        className="block aspect-[2/3] overflow-hidden bg-zinc-800 relative"
      >
        {entry.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.imageUrl}
            alt={entry.title}
            loading="lazy"
            className={`w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 ${
              isAired ? 'opacity-70 saturate-75' : ''
            }`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-600">
            <Tv className="w-10 h-10" />
          </div>
        )}
        {entry.status && (
          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs font-medium bg-black/70 backdrop-blur text-indigo-200 border border-indigo-500/30">
            {entry.status}
          </span>
        )}
        {isToday && !isAired && (
          <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-indigo-500 text-white shadow">
            Today
          </span>
        )}
        {isAired && (
          <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-amber-500 text-zinc-950 shadow">
            Aired
          </span>
        )}
        <div className="absolute bottom-2 right-2 flex gap-1">
          {isInterested && (
            <span
              className="w-6 h-6 rounded-full bg-black/70 backdrop-blur flex items-center justify-center text-sky-400 shadow"
              title="In your Interested list"
            >
              <Bookmark className="w-3.5 h-3.5 fill-current" />
            </span>
          )}
          {isFavorited && (
            <span
              className="w-6 h-6 rounded-full bg-black/70 backdrop-blur flex items-center justify-center text-rose-400 shadow"
              title="In your Favorites"
            >
              <Heart className="w-3.5 h-3.5 fill-current" />
            </span>
          )}
        </div>
      </CoverWrap>

      <div className={`p-3 pb-9 flex-1 flex flex-col gap-0.5 ${bodyTint}`}>
        <h3 className="font-bold text-sm leading-tight line-clamp-2" title={entry.title}>
          {entry.title}
        </h3>
        {showEnglish && (
          <p
            className="text-xs text-zinc-300 leading-tight line-clamp-1"
            title={entry.titleEnglish}
          >
            {entry.titleEnglish}
          </p>
        )}

        <div
          className={`flex items-center gap-1.5 text-xs mt-1.5 ${
            isAired
              ? 'text-amber-400 font-semibold'
              : isToday
                ? 'text-indigo-300 font-semibold'
                : 'text-zinc-300'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span className={isAired ? 'line-through opacity-80' : ''}>
            {entry.time || '—'}
          </span>
        </div>

        {entry.platform && (
          <div className="text-xs text-zinc-300 truncate" title={entry.platform}>
            {entry.platform}
          </div>
        )}

        {onUpdate && <WatchProgressRow entry={entry} onUpdate={onUpdate} />}
        {onUpdate && showAiring && <AiringIndicator entry={entry} />}
      </div>

      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <CardActionMenu
          onEdit={() => onEdit(entry)}
          onDelete={async () => {
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
          }}
          onToggleFavorite={onToggleFavorite ? () => onToggleFavorite(entry) : undefined}
          onToggleInterested={
            onToggleInterested ? () => onToggleInterested(entry) : undefined
          }
          isFavorited={isFavorited}
          isInterested={isInterested}
          canFavorite={entry.anilistId > 0}
        />
      </div>

      {entry.anilistId > 0 && (
        <a
          href={`https://anilist.co/anime/${entry.anilistId}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-2 right-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-800/90 backdrop-blur text-[10px] font-semibold text-zinc-300 hover:bg-indigo-500 hover:text-white transition-colors"
          title="View on AniList"
        >
          AL
          <ExternalLink className="w-2.5 h-2.5" />
        </a>
      )}
    </div>
  );
}
