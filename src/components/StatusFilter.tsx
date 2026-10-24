import type { WatchStatus } from '@/lib/types';
import { PILL_ROW, pillClass } from '@/lib/ui';
import { WATCH_STATUSES, WATCH_STATUS_CLASS, WATCH_STATUS_SHORT } from '@/lib/utils';

/** Extra "filter bucket" for shows with no watch status yet. */
const UNTRACKED = 'UNTRACKED' as const;
export type StatusFilter = WatchStatus | typeof UNTRACKED;

const OPTIONS: StatusFilter[] = [...WATCH_STATUSES, UNTRACKED];

const LABEL: Record<StatusFilter, string> = {
  WATCHING: WATCH_STATUS_SHORT.WATCHING,
  COMPLETED: WATCH_STATUS_SHORT.COMPLETED,
  DROPPED: WATCH_STATUS_SHORT.DROPPED,
  ON_HOLD: WATCH_STATUS_SHORT.ON_HOLD,
  PLAN: WATCH_STATUS_SHORT.PLAN,
  UNTRACKED: 'Untracked',
};

const CLASS: Record<StatusFilter, string> = {
  ...WATCH_STATUS_CLASS,
  UNTRACKED: 'bg-zinc-800/70 text-zinc-300 border-zinc-700',
};

/** Whether a show passes the filter. Nothing selected passes everything. */
export function passesStatusFilter(status: WatchStatus | undefined, selected: Set<StatusFilter>): boolean {
  return selected.size === 0 || selected.has(status ?? UNTRACKED);
}

/** Watch-status filter pills with counts (any selected status matches).
 *  `statuses` is every listed show's status; a status none has is hidden. */
export function StatusFilterPills({
  statuses,
  selected,
  onChange,
}: {
  statuses: (WatchStatus | undefined)[];
  selected: Set<StatusFilter>;
  onChange: (next: Set<StatusFilter>) => void;
}) {
  return (
    <div className={PILL_ROW} role="group" aria-label="Watch status">
      {OPTIONS.map((s) => {
        const active = selected.has(s);
        const n = statuses.filter((st) => (st ?? UNTRACKED) === s).length;
        if (n === 0 && !active) return null;
        return (
          <button
            key={s}
            type="button"
            onClick={() => {
              const next = new Set(selected);
              if (next.has(s)) next.delete(s);
              else next.add(s);
              onChange(next);
            }}
            className={
              active
                ? `inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium ${CLASS[s]}`
                : pillClass(false)
            }
            aria-pressed={active}
            title={`Filter by ${LABEL[s]}`}
          >
            {LABEL[s]} <span className="tabular-nums opacity-60">{n}</span>
          </button>
        );
      })}
      {selected.size > 0 && (
        <button
          type="button"
          onClick={() => onChange(new Set())}
          className="px-2 text-xs text-zinc-500 hover:text-zinc-300"
          title="Clear status filter"
        >
          Clear
        </button>
      )}
    </div>
  );
}
