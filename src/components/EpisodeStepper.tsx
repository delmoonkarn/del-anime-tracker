import { Minus, Plus } from 'lucide-react';

/**
 * The "− 3/12 +" episode counter on schedule, watchlist and collection
 * entries. `size`: `card` fills a card's bottom row, `list` is a desktop
 * list row's fixed-width control, `row` is the small one in phone rows.
 */
export function EpisodeStepper({
  watched,
  total,
  onDec,
  onInc,
  size,
  title,
}: {
  watched: number;
  total?: number;
  onDec: () => void;
  onInc: () => void;
  size: 'card' | 'list' | 'row';
  /** The show's title, for screen readers. */
  title: string;
}) {
  const button = size === 'list' ? 'w-8' : 'w-7';
  return (
    <div
      className={`flex ${size === 'row' ? 'h-7 shrink-0' : 'h-8'} overflow-hidden rounded-lg border border-zinc-800 ${size === 'card' ? 'flex-1' : ''}`}
      role="group"
      aria-label={`Episodes watched of ${title}`}
    >
      <button
        type="button"
        className={`grid ${button} shrink-0 place-items-center bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40`}
        disabled={watched <= 0}
        onClick={onDec}
        aria-label="One episode less"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span
        className={`flex flex-1 items-center justify-center bg-zinc-950 font-medium tabular-nums ${
          size === 'list' ? 'min-w-16 px-2 text-sm' : size === 'row' ? 'min-w-11 px-1 text-xs' : 'min-w-0 px-1 text-sm'
        }`}
      >
        {size === 'list' ? `${watched} / ${total ?? '?'}` : `${watched}/${total ?? '?'}`}
      </span>
      <button
        type="button"
        className={`grid ${button} shrink-0 place-items-center bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40`}
        disabled={total != null && watched >= total}
        onClick={onInc}
        aria-label="One episode more"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
