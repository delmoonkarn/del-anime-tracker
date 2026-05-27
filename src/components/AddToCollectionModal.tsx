
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plus, Search, X } from 'lucide-react';
import type { AnilistMedia, DiscoverItem } from '@/lib/types';
import { useDebounce } from '@/hooks/useDebounce';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (item: DiscoverItem) => void;
  isInCollection: (anilistId: number) => boolean;
}

export function AddToCollectionModal({ open, onClose, onAdd, isInCollection }: Props) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 450);
  const [results, setResults] = useState<AnilistMedia[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setError(null);
    // Focus the search input when the modal opens
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const q = debouncedQuery.trim();
    if (q.length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setError(null);
    (async () => {
      try {
        const { searchAnime } = await import('@/lib/anilist');
        const media = await searchAnime(q, controller.signal);
        setResults(media);
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err.message || 'Search failed.');
          setResults([]);
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    })();
    return () => controller.abort();
  }, [debouncedQuery, open]);

  if (!open) return null;

  const handleAdd = (m: AnilistMedia) => {
    const title = m.title.romaji || m.title.native || m.title.english || `#${m.id}`;
    const english =
      m.title.english && m.title.english !== title ? m.title.english : undefined;
    onAdd({
      anilistId: m.id,
      title,
      titleEnglish: english,
      imageUrl: m.coverImage.large || m.coverImage.medium,
      tags: [],
      format: m.format ?? undefined,
      episodes: m.episodes ?? undefined,
      averageScore: m.averageScore ?? undefined,
      startDate: m.startDate ?? undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold">Add to collection</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-4 border-b border-zinc-800">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search AniList for a title…"
              className="w-full pl-9 pr-9 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-400 animate-spin" />
            )}
          </div>
          {error && (
            <p className="mt-2 text-xs text-red-300">{error}</p>
          )}
          {!error && debouncedQuery.trim().length >= 2 && !searching && results.length === 0 && (
            <p className="mt-2 text-xs text-zinc-500">No matches.</p>
          )}
        </div>

        <ul className="overflow-y-auto divide-y divide-zinc-800">
          {results.map((m) => {
            const title = m.title.romaji || m.title.native || m.title.english || `#${m.id}`;
            const english =
              m.title.english && m.title.english !== title ? m.title.english : null;
            const added = isInCollection(m.id);
            return (
              <li key={m.id} className="flex items-center gap-3 p-3 hover:bg-zinc-800/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.coverImage.medium}
                  alt={title}
                  className="w-10 h-14 object-cover rounded shrink-0 bg-zinc-800"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{title}</p>
                  {english && (
                    <p className="text-xs text-zinc-500 truncate">{english}</p>
                  )}
                </div>
                {added ? (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-medium shrink-0">
                    <Check className="w-3.5 h-3.5" />
                    Added
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleAdd(m)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-medium shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
