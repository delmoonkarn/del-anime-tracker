import { useEffect, useRef, useState } from 'react';

/** Small "★ N" pill that opens a 1–5 picker. Mirrors StatusPill so the meta
 *  row of a collection card has a consistent feel. */
export function UserScorePill({
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
