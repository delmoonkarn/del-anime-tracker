import { useEffect, useRef, useState } from 'react';
import type { WatchStatus } from '@/lib/types';
import { WATCH_STATUSES, WATCH_STATUS_CLASS, WATCH_STATUS_LABELS } from '@/lib/utils';
import { MENU } from '@/lib/ui';

/** Status dropdown — small pill that opens a floating menu of the 5 enum
 *  values plus a "Clear" option. Native <select> would be simpler but doesn't
 *  style well across browsers; this matches the rest of the app's menus. */
export function StatusPill({
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
        <div className={`absolute left-0 bottom-full mb-1 w-32 ${MENU}`}>
          {WATCH_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setOpen(false);
                onChange(s);
              }}
              className={`w-full text-left text-[11px] px-2.5 py-1.5 hover:bg-zinc-700 ${
                s === status ? 'bg-zinc-700/50 font-semibold' : ''
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
              className="w-full text-left text-[11px] px-2.5 py-1.5 text-zinc-400 hover:bg-zinc-700 border-t border-zinc-700"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
