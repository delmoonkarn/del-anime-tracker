import { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  Check,
  ExternalLink,
  Heart,
  Minus,
  MoreVertical,
  Plus,
  X,
} from 'lucide-react';
import type { DiscoverItem, ScheduleProgress, WatchStatus } from '@/lib/types';
import {
  WATCH_STATUSES,
  WATCH_STATUS_CLASS,
  WATCH_STATUS_LABELS,
  WATCH_STATUS_SHORT,
  nextProgressOnDec,
  nextProgressOnInc,
  nextProgressOnSetStatus,
} from '@/lib/utils';

interface Props {
  item: DiscoverItem;
  alreadyAdded: boolean;
  onAdd: () => void;
  onRemove?: () => void;
  favorited?: boolean;
  interested?: boolean;
  onToggleFavorite?: () => void;
  onToggleInterested?: () => void;
  /** Watch progress mirrored from the Schedule (when this show is also being
   *  tracked there). Renders as a small status pill + watched/total counter. */
  progress?: ScheduleProgress;
  /** When supplied, the progress row becomes editable (status dropdown +
   *  +/- buttons). The new progress state is passed back so App.tsx can
   *  broadcast it to every schedule entry with the same anilistId. */
  onUpdateProgress?: (next: ScheduleProgress) => void;
  /** Your own 1–5 rating for this item, if any. */
  userScore?: number;
  /** When supplied, AniList's average score is hidden and replaced with a
   *  1–5 dropdown that calls this back with the picked value (or null to
   *  clear). Drives the Collection card's personal scoring. */
  onSetUserScore?: (score: number | null) => void;
}

/** Small "★ N" pill that opens a 1–5 picker. Mirrors StatusPill so the meta
 *  row of a collection card has a consistent feel. */
function UserScorePill({
  score,
  onChange,
}: {
  score?: number;
  onChange: (next: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const hasScore = score != null;
  const label = hasScore ? `★ ${score}/5` : '★ Rate';
  const pillClass = hasScore
    ? 'text-amber-300 bg-amber-500/10 border-amber-500/40'
    : 'text-zinc-400 bg-zinc-800/70 border-zinc-700';

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border whitespace-nowrap hover:brightness-125 ${pillClass}`}
        title="Your score"
      >
        {label}
      </button>
      {open && (
        <div className="absolute left-0 bottom-full mb-1 w-24 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl overflow-hidden z-30">
          {[5, 4, 3, 2, 1].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setOpen(false);
                onChange(s);
              }}
              className={`w-full text-left text-[11px] px-2.5 py-1.5 hover:bg-zinc-800 text-amber-300 ${
                s === score ? 'bg-zinc-800/50 font-semibold' : ''
              }`}
            >
              ★ {s}/5
            </button>
          ))}
          {hasScore && (
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

/** Compact status pill dropdown — same color system as the schedule card,
 *  trimmed down to fit the collection card's narrow column. */
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
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const pillClass = status
    ? WATCH_STATUS_CLASS[status]
    : 'bg-zinc-800/70 text-zinc-400 border-zinc-700';
  const label = status ? WATCH_STATUS_SHORT[status] : '— Status —';

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

/** Compact progress row for the Collection / Discover card. Two modes:
 *   - read-only: pill (when status set) + watched/total counter
 *   - editable (onUpdate provided): pill becomes a dropdown, counter gets
 *     +/- buttons. Auto-flip rules are shared with the schedule card via
 *     nextProgressOnInc / nextProgressOnDec so behavior matches across
 *     views. Returns null only in the read-only path when there's nothing
 *     meaningful to render. */
function ProgressRow({
  progress,
  onUpdate,
}: {
  progress: ScheduleProgress;
  onUpdate?: (next: ScheduleProgress) => void;
}) {
  const { watchStatus, episodesWatched, totalEpisodes } = progress;
  const watched = episodesWatched ?? 0;
  const hasCounter = watched > 0 || totalEpisodes != null;

  if (!onUpdate) {
    if (!watchStatus && !hasCounter) return null;
    return (
      <div className="flex items-center gap-1.5 text-[10px]" title="From your schedule">
        {watchStatus && (
          <span
            className={`px-1.5 py-0.5 rounded-full border font-medium whitespace-nowrap ${WATCH_STATUS_CLASS[watchStatus]}`}
          >
            {WATCH_STATUS_SHORT[watchStatus]}
          </span>
        )}
        {hasCounter && (
          <span className="tabular-nums text-zinc-300">
            {watched}
            {totalEpisodes != null && <span className="text-zinc-500">/{totalEpisodes}</span>}
            <span className="ml-1 text-zinc-500">ep</span>
          </span>
        )}
      </div>
    );
  }

  // Editable mode — always render (gives the user controls even when nothing
  // has been touched yet, matching how the schedule card always shows them).
  const atCap = totalEpisodes != null && watched >= totalEpisodes;

  const handleInc = () => {
    if (atCap) return;
    const n = nextProgressOnInc(watched, totalEpisodes, watchStatus);
    onUpdate({ ...n, totalEpisodes });
  };
  const handleDec = () => {
    if (watched === 0) return;
    const n = nextProgressOnDec(watched, totalEpisodes, watchStatus);
    onUpdate({ ...n, totalEpisodes });
  };
  const handleSetStatus = (s: WatchStatus | null) => {
    // nextProgressOnSetStatus handles the COMPLETED → fill-to-total bump.
    const n = nextProgressOnSetStatus(s ?? undefined, watched, totalEpisodes);
    onUpdate({ ...n, totalEpisodes });
  };

  return (
    <div className="flex items-center gap-1.5" title="From your schedule">
      <StatusPill status={watchStatus} onChange={handleSetStatus} />
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
          {totalEpisodes != null && <span className="text-zinc-400">/{totalEpisodes}</span>}
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

function DiscoverActionMenu({
  favorited,
  interested,
  onToggleFavorite,
  onToggleInterested,
}: {
  favorited?: boolean;
  interested?: boolean;
  onToggleFavorite?: () => void;
  onToggleInterested?: () => void;
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

  if (!onToggleFavorite && !onToggleInterested) return null;

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
        <div className="absolute right-0 top-full mt-1 w-40 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl overflow-hidden z-30">
          {onToggleFavorite && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onToggleFavorite();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-200 hover:bg-rose-500 hover:text-white text-left"
            >
              <Heart
                className={`w-3.5 h-3.5 ${favorited ? 'fill-current text-rose-400' : ''}`}
              />
              {favorited ? 'Unfavorite' : 'Favorite'}
            </button>
          )}
          {onToggleInterested && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onToggleInterested();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-200 hover:bg-sky-500 hover:text-white text-left border-t border-zinc-800"
            >
              <Bookmark
                className={`w-3.5 h-3.5 ${interested ? 'fill-current text-sky-400' : ''}`}
              />
              {interested ? 'Not interested' : 'Interested'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function DiscoverCard({
  item,
  alreadyAdded,
  onAdd,
  onRemove,
  favorited,
  interested,
  onToggleFavorite,
  onToggleInterested,
  progress,
  onUpdateProgress,
  userScore,
  onSetUserScore,
}: Props) {
  return (
    <div className="group bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col shadow-lg hover:border-zinc-700 transition-colors">
      <a
        href={`https://anilist.co/anime/${item.anilistId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full aspect-[2/3] bg-zinc-800 relative"
      >
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.title}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : null}
        <div className="absolute bottom-1.5 right-1.5 flex gap-1">
          {interested && (
            <span
              className="w-6 h-6 rounded-full bg-black/70 backdrop-blur flex items-center justify-center text-sky-400"
              title="In your Interested list"
            >
              <Bookmark className="w-3.5 h-3.5 fill-current" />
            </span>
          )}
          {favorited && (
            <span
              className="w-6 h-6 rounded-full bg-black/70 backdrop-blur flex items-center justify-center text-rose-400"
              title="In your Favorites"
            >
              <Heart className="w-3.5 h-3.5 fill-current" />
            </span>
          )}
        </div>
        <div
          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
          onClick={(e) => e.preventDefault()}
        >
          <DiscoverActionMenu
            favorited={favorited}
            interested={interested}
            onToggleFavorite={onToggleFavorite}
            onToggleInterested={onToggleInterested}
          />
        </div>
      </a>

      <div className="p-3 flex-1 flex flex-col gap-1.5">
        <div>
          <h3 className="font-bold text-sm leading-tight line-clamp-2" title={item.title}>
            {item.title}
          </h3>
          {item.titleEnglish && (
            <p
              className="text-xs text-zinc-300 line-clamp-1 leading-tight mt-0.5"
              title={item.titleEnglish}
            >
              {item.titleEnglish}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
          {item.format && <span className="uppercase font-semibold">{item.format}</span>}
          {item.episodes != null && <span>{item.episodes} eps</span>}
          {/* AniList's average score is hidden in collection mode (where
              onSetUserScore is supplied) — replaced by the 1–5 user pill
              below. Discover-mode cards keep the AniList score as before. */}
          {onSetUserScore == null && item.averageScore != null && (
            <span className="text-amber-300">★ {item.averageScore}%</span>
          )}
          {onSetUserScore != null && (
            <UserScorePill score={userScore} onChange={onSetUserScore} />
          )}
        </div>

        {progress && <ProgressRow progress={progress} onUpdate={onUpdateProgress} />}

        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {/* Card shows only the top 5 highest-ranked tags; full list lives
                on the entry so search/filter still works against everything. */}
            {item.tags.slice(0, 5).map((t) => (
              <span
                key={t}
                className="px-1.5 py-0.5 rounded-full text-[10px] bg-zinc-800 text-zinc-400"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {item.description && (
          <p className="text-[11px] text-zinc-400 line-clamp-3 leading-relaxed whitespace-pre-line">
            {item.description}
          </p>
        )}

        <div className="mt-auto pt-2 flex items-center justify-between gap-2">
          <a
            href={`https://anilist.co/anime/${item.anilistId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-indigo-300"
          >
            <ExternalLink className="w-3 h-3" />
            AL
          </a>
          {onRemove ? (
            <button
              onClick={onRemove}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800 hover:bg-red-500 hover:text-white text-zinc-300 text-[11px] font-medium border border-zinc-700"
              title="Remove"
            >
              <X className="w-3 h-3" />
              Remove
            </button>
          ) : alreadyAdded ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px] font-medium">
              <Check className="w-3 h-3" />
              Added
            </span>
          ) : (
            <button
              onClick={onAdd}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500 hover:bg-indigo-600 text-white text-[11px] font-medium"
            >
              <Plus className="w-3 h-3" />
              Add
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
