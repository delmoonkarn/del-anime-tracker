
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { AnilistTag } from '@/lib/types';

interface Props {
  allTags: AnilistTag[] | null;
  selected: string[];
  onChange: (next: string[]) => void;
}

export function TagFilterPicker({ allTags, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Group filtered tags by category for easier scanning
  const grouped = useMemo(() => {
    if (!allTags) return [];
    const q = query.trim().toLowerCase();
    const selectedSet = new Set(selected);
    const visible = allTags.filter(
      (t) =>
        !selectedSet.has(t.name) &&
        (q === '' ||
          t.name.toLowerCase().includes(q) ||
          (t.category && t.category.toLowerCase().includes(q))),
    );
    const byCategory = new Map<string, AnilistTag[]>();
    for (const t of visible) {
      const key = t.category ?? 'Other';
      const arr = byCategory.get(key) ?? [];
      arr.push(t);
      byCategory.set(key, arr);
    }
    return [...byCategory.entries()]
      .map(([cat, items]) => ({
        category: cat,
        items: items.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [allTags, query, selected]);

  const add = (name: string) => {
    if (!selected.includes(name)) onChange([...selected, name]);
  };
  const remove = (name: string) => onChange(selected.filter((n) => n !== name));

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-indigo-500/15 text-indigo-200 border border-indigo-500/30 text-xs"
          >
            {t}
            <button
              type="button"
              onClick={() => remove(t)}
              className="p-0.5 rounded-full hover:bg-indigo-500/30"
              aria-label={`Remove ${t}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={!allTags}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs disabled:opacity-50"
        >
          <Plus className="w-3 h-3" />
          {selected.length === 0 ? 'Add tag filter' : 'Add tag'}
        </button>
      </div>

      {open && (
        <div className="absolute left-0 mt-2 w-80 max-w-[90vw] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-30 overflow-hidden flex flex-col max-h-96">
          <div className="p-2 border-b border-zinc-800">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  // Select the very first visible tag across all categories,
                  // then clear the input so the next tag is easy to add.
                  const firstGroup = grouped[0];
                  const firstTag = firstGroup?.items[0];
                  if (firstTag) {
                    add(firstTag.name);
                    setQuery('');
                  }
                }
              }}
              placeholder={
                allTags
                  ? `Search ${allTags.length} tags…`
                  : 'Loading tags…'
              }
              className="w-full px-3 py-1.5 rounded-md bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
            />
          </div>
          <div className="overflow-y-auto">
            {grouped.length === 0 && (
              <p className="px-3 py-3 text-sm text-zinc-500 text-center">
                {allTags ? 'No matches.' : 'Loading…'}
              </p>
            )}
            {grouped.map(({ category, items }) => (
              <div key={category}>
                <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-zinc-500 font-semibold sticky top-0 bg-zinc-900">
                  {category}
                </p>
                <ul>
                  {items.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => add(t.name)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left hover:bg-zinc-800 text-zinc-200"
                      >
                        <span>{t.name}</span>
                        {t.isAdult && (
                          <span className="text-[10px] text-red-400 font-semibold">
                            18+
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
