import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Loader2, Search, Star, Tv } from 'lucide-react';
import type { AnilistMedia } from '@/lib/types';
import { useDebounce } from '@/hooks/useDebounce';
import { useOpenDetail } from '@/lib/nav';
import { AIRING_STATUS_LABEL, FORMAT_LABEL, MENU } from '@/lib/ui';

const MIN_LENGTH = 2;

/**
 * Navbar search over all of AniList, with results in a dropdown under the box.
 * ↑/↓ move through the results, Enter opens one, Esc closes. "/" focuses it.
 */
export function GlobalSearch() {
  const openDetail = useOpenDetail();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<AnilistMedia[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const q = useDebounce(text.trim(), 300);
  const ready = q.length >= MIN_LENGTH;
  const showPanel = open && text.trim().length >= MIN_LENGTH;

  useEffect(() => {
    if (!ready) {
      setResults([]);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { searchAnime } = await import('@/lib/anilist');
        const media = await searchAnime(q, controller.signal);
        if (controller.signal.aborted) return;
        setResults(media);
        setActive(0);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Search failed.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [q, ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, []);

  const optionId = (i: number) => `${listId}-opt-${i}`;
  const pick = (m: AnilistMedia) => {
    openDetail(m.id);
    setOpen(false);
    setText('');
    inputRef.current?.blur();
  };

  useEffect(() => {
    if (showPanel) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPanel, active]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (showPanel) setOpen(false);
      else e.currentTarget.blur();
      return;
    }
    if (results.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length);
    }
  };

  return (
    <form
      ref={rootRef}
      role="search"
      className="relative min-w-0 flex-1 md:max-w-xs lg:max-w-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const target = results[active];
        if (showPanel && target) pick(target);
      }}
    >
      <label className="flex h-8 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 focus-within:border-indigo-500">
        <Search className="h-4 w-4 shrink-0 text-zinc-500" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showPanel && results[active] ? optionId(active) : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search all anime…"
          aria-label="Search all anime on AniList"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-500"
        />
        {loading && ready ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-500" aria-label="Searching" />
        ) : text ? null : (
          <kbd className="hidden rounded border border-zinc-700 px-1.5 text-[10px] text-zinc-500 sm:inline" aria-hidden>
            /
          </kbd>
        )}
      </label>

      {showPanel && (
        <div className={`${MENU} absolute right-0 top-full mt-2 w-[26rem] max-sm:fixed max-sm:inset-x-4 max-sm:top-14 max-sm:w-auto`}>
          {!ready || (loading && results.length === 0) ? (
            <p className="flex items-center gap-2 px-4 py-6 text-sm text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching AniList…
            </p>
          ) : error && results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-red-300">{error}</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-zinc-400">
              No anime found for “{q}”. Try the English or romaji title.
            </p>
          ) : (
            <>
              <ul id={listId} role="listbox" aria-label="Search results" className="max-h-[min(28rem,70vh)] overflow-y-auto p-1.5">
                {results.map((m, i) => (
                  <li
                    key={m.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => pick(m)}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg p-1.5 ${i === active ? 'bg-zinc-800' : ''}`}
                  >
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-zinc-800">
                      {m.coverImage.medium ? (
                        <img src={m.coverImage.medium} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Tv className="m-auto h-4 w-4 text-zinc-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.title.romaji || m.title.english}</p>
                      <p className="truncate text-xs text-zinc-400">
                        {m.format ? (FORMAT_LABEL[m.format] ?? m.format) : '—'}
                        {m.startDate?.year && ` · ${m.startDate.year}`}
                        {m.status && ` · ${AIRING_STATUS_LABEL[m.status] ?? m.status}`}
                      </p>
                    </div>
                    {m.averageScore != null && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-zinc-300">
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                        {m.averageScore}%
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="flex justify-between gap-2 border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">
                <span>Top {results.length} matches</span>
                <span className="hidden shrink-0 sm:inline">↑↓ · Enter</span>
              </p>
            </>
          )}
        </div>
      )}
    </form>
  );
}
