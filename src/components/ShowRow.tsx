import type { ReactNode } from 'react';
import { SURFACE } from '@/lib/ui';

/** Poster size in a phone row, for the poster element each entry passes in. */
export const ROW_POSTER = 'h-[4.5rem] w-12 shrink-0 overflow-hidden rounded-md bg-zinc-800';

/**
 * A show as one compact row, the phone layout of the schedule, watchlist and
 * collection (like AniList's and MAL's lists): small poster, title, one info
 * line, then status and the episode counter. About 80px tall.
 */
export function ShowRow({
  poster,
  title,
  info,
  chips,
  progress,
  menu,
  className = '',
}: {
  poster: ReactNode;
  title: ReactNode;
  info?: ReactNode;
  chips?: ReactNode;
  progress?: ReactNode;
  menu?: ReactNode;
  /** Border / dimming for states like "behind" or "dropped". */
  className?: string;
}) {
  return (
    <div className={`${SURFACE} flex gap-3 p-2 ${className}`}>
      {poster}
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-1">
        <div className="flex min-w-0 items-start gap-1">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5 text-sm font-semibold leading-tight">{title}</div>
            {info && <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-zinc-400">{info}</div>}
          </div>
          {menu}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {/* Not clipped: the status pill's menu opens upward out of it. */}
          <div className="flex min-w-0 flex-1 items-center gap-1">{chips}</div>
          {progress}
        </div>
      </div>
    </div>
  );
}
