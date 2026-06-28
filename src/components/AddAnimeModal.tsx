import { useEffect, useState } from 'react';
import { Loader2, RefreshCcw, Search, X } from 'lucide-react';
import type { AnilistMedia, AnimeEntry, DayOfWeek } from '@/lib/types';
import {
  DAYS,
  DAY_LABELS,
  PLATFORM_PRESETS,
  deriveDayFromStartDate,
  deriveDayTimeFromAiringAt,
  newId,
} from '@/lib/utils';
import { searchAnime } from '@/lib/anilist';
import { useDebounce } from '@/hooks/useDebounce';

interface Props {
  open: boolean;
  initial?: AnimeEntry | null;
  /** When adding a new entry and the user picks a search result whose
   *  AniList ID already exists elsewhere in the tracker, prefill the
   *  airing-slot fields from that sibling. Caller returns null when no
   *  sibling exists or when the anilistId is 0 (unbound). */
  findSiblingForAnilist?: (anilistId: number) => AnimeEntry | null;
  onClose: () => void;
  onSave: (entry: AnimeEntry) => void;
}

interface SelectedAnime {
  anilistId: number;
  title: string;
  titleEnglish: string;
  imageUrl: string;
  /** Episode count from AniList, threaded into AnimeEntry.totalEpisodes
   *  so the schedule card's progress widget knows the denominator. */
  episodes?: number;
  /** Airing data — drives the "ep N aired / X behind" card indicator. */
  nextAiringEpisode?: number;
  nextAiringAt?: number;
  /** AniList MediaFormat — schedule groups movies in their own block. */
  format?: string;
  /** Carried over from a sibling entry (same AniList ID, another season) so
   *  a continuing title doesn't reset to 0/untracked on its new cour. Unset
   *  when there's no sibling. */
  watchStatus?: AnimeEntry['watchStatus'];
  episodesWatched?: number;
}

function primaryTitle(m: AnilistMedia): string {
  return m.title.romaji || m.title.native || m.title.english || `#${m.id}`;
}

function englishTitle(m: AnilistMedia): string {
  // English is the secondary line; only meaningful if it differs from the primary
  const eng = m.title.english ?? '';
  return eng && eng !== primaryTitle(m) ? eng : '';
}

export function AddAnimeModal({
  open,
  initial,
  findSiblingForAnilist,
  onClose,
  onSave,
}: Props) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 450);
  const [results, setResults] = useState<AnilistMedia[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [selected, setSelected] = useState<SelectedAnime | null>(null);

  const [title, setTitle] = useState('');
  const [titleEnglish, setTitleEnglish] = useState('');
  const [day, setDay] = useState<DayOfWeek | ''>('');
  const [time, setTime] = useState('');
  const [platform, setPlatform] = useState('');
  const [platformUrl, setPlatformUrl] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setSelected({
        anilistId: initial.anilistId,
        title: initial.title,
        titleEnglish: initial.titleEnglish ?? '',
        imageUrl: initial.imageUrl,
        episodes: initial.totalEpisodes,
        nextAiringEpisode: initial.nextAiringEpisode,
        nextAiringAt: initial.nextAiringAt,
        format: initial.format,
      });
      setTitle(initial.title);
      setTitleEnglish(initial.titleEnglish ?? '');
      setDay(initial.day ?? '');
      setTime(initial.time);
      setPlatform(initial.platform);
      setPlatformUrl(initial.platformUrl);
      setStatus(initial.status);
    } else {
      setSelected(null);
      setTitle('');
      setTitleEnglish('');
      setDay('');
      setTime('');
      setPlatform('');
      setPlatformUrl('');
      setStatus('');
    }
    setQuery('');
    setResults([]);
    setSearchError(null);
  }, [open, initial]);

  useEffect(() => {
    if (!open || selected) {
      setResults([]);
      return;
    }
    const q = debouncedQuery.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setSearchError(null);
    searchAnime(q, controller.signal)
      .then((data) => setResults(data))
      .catch((err: Error) => {
        if (err.name !== 'AbortError') {
          setSearchError(err.message || 'Search failed. Try again in a moment.');
          setResults([]);
        }
      })
      .finally(() => setSearching(false));
    return () => controller.abort();
  }, [debouncedQuery, open, selected, retryToken]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canSave = (selected !== null || (initial !== null && initial !== undefined)) && title.trim().length > 0;

  const handleSave = () => {
    const finalTitle = title.trim();
    if (!finalTitle) return;
    const finalEnglish = titleEnglish.trim();
    const entry: AnimeEntry = {
      id: initial?.id ?? newId(),
      anilistId: selected?.anilistId ?? initial?.anilistId ?? 0,
      title: finalTitle,
      titleEnglish: finalEnglish || undefined,
      imageUrl: selected?.imageUrl ?? initial?.imageUrl ?? '',
      day: (day || null) as DayOfWeek | null,
      time,
      platform,
      platformUrl,
      status,
      // Preserve any progress already tracked on the entry — editing the
      // metadata shouldn't reset the user's episode count or watch status.
      // For a brand-new entry that matched a sibling (continuing title),
      // `selected` carries that sibling's progress so it's linked instead
      // of starting back at 0/untracked.
      watchStatus: initial?.watchStatus ?? selected?.watchStatus,
      episodesWatched: initial?.episodesWatched ?? selected?.episodesWatched,
      totalEpisodes: selected?.episodes ?? initial?.totalEpisodes,
      // Re-binding refreshes airing data; otherwise keep whatever was cached.
      nextAiringEpisode: selected?.nextAiringEpisode ?? initial?.nextAiringEpisode,
      nextAiringAt: selected?.nextAiringAt ?? initial?.nextAiringAt,
      format: selected?.format ?? initial?.format,
      addedAt: initial?.addedAt ?? Date.now(),
    };
    onSave(entry);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold">{initial ? 'Edit Anime' : 'Add Anime'}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="overflow-y-auto p-4 space-y-4">
          {!selected && (
            <div>
              <label className="text-xs uppercase tracking-wide text-zinc-500 font-semibold">
                {initial ? 'Re-bind to AniList' : 'Search AniList'}
              </label>
              <div className="mt-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Start typing an anime title…"
                  className="w-full pl-9 pr-9 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
                />
                {searching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-400 animate-spin" />
                )}
              </div>

              {searchError && (
                <div className="mt-2 flex items-start justify-between gap-2 p-2 rounded-lg border border-red-500/30 bg-red-500/5">
                  <p className="text-xs text-red-300 leading-relaxed">{searchError}</p>
                  <button
                    type="button"
                    onClick={() => setRetryToken((n) => n + 1)}
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-red-200 hover:bg-red-500/10"
                    title="Retry search"
                  >
                    <RefreshCcw className="w-3 h-3" />
                    Retry
                  </button>
                </div>
              )}

              {results.length > 0 && (
                <ul className="mt-2 border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950 divide-y divide-zinc-800">
                  {results.map((r) => {
                    const main = primaryTitle(r);
                    const eng = englishTitle(r);
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => {
                            // Sibling prefill (only when adding fresh, not
                            // editing). If another entry in any season has
                            // the same AniList ID, copy its airing-slot
                            // fields so the user doesn't retype them.
                            // Sibling wins over AniList-derived defaults.
                            const sibling =
                              !initial && findSiblingForAnilist
                                ? findSiblingForAnilist(r.id)
                                : null;
                            setSelected({
                              anilistId: r.id,
                              title: main,
                              titleEnglish: eng,
                              imageUrl: r.coverImage.large || r.coverImage.medium,
                              episodes: r.episodes ?? undefined,
                              nextAiringEpisode: r.nextAiringEpisode?.episode ?? undefined,
                              nextAiringAt: r.nextAiringEpisode?.airingAt ?? undefined,
                              format: r.format ?? undefined,
                              // Continuing title (e.g. a new cour): inherit
                              // the watch progress already tracked on the
                              // sibling instead of starting back at 0/untracked.
                              watchStatus: sibling?.watchStatus,
                              episodesWatched: sibling?.episodesWatched,
                            });
                            setTitle(main);
                            setTitleEnglish(eng);
                            // Auto-fill day/time from AniList. Prefer
                            // nextAiringEpisode (gives both day + time);
                            // fall back to startDate for finished shows
                            // (day only — time can't be derived from a date).
                            // We never clobber values the user already set
                            // (including those from `initial` during edits).
                            const fromAiring = deriveDayTimeFromAiringAt(
                              r.nextAiringEpisode?.airingAt ?? null,
                            );
                            const dayHint =
                              sibling?.day ??
                              fromAiring?.day ??
                              deriveDayFromStartDate(r.startDate);
                            const timeHint = sibling?.time || fromAiring?.time;
                            if (!day && dayHint) setDay(dayHint);
                            if (!time && timeHint) setTime(timeHint);
                            if (!platform && sibling?.platform) {
                              setPlatform(sibling.platform);
                            }
                            if (!platformUrl && sibling?.platformUrl) {
                              setPlatformUrl(sibling.platformUrl);
                            }
                            if (!status && sibling?.status) {
                              setStatus(sibling.status);
                            }
                            setQuery('');
                            setResults([]);
                          }}
                          className="w-full flex items-center gap-3 p-2 hover:bg-zinc-800/60 text-left"
                        >
                          <img
                            src={r.coverImage.medium}
                            alt={main}
                            className="w-10 h-14 object-cover rounded shrink-0 bg-zinc-800"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{main}</p>
                            {eng && <p className="text-xs text-zinc-500 truncate">{eng}</p>}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {!searching &&
                debouncedQuery.trim().length >= 2 &&
                results.length === 0 &&
                !searchError && <p className="mt-2 text-xs text-zinc-500">No matches.</p>}
            </div>
          )}

          {selected && (
            <div className="flex items-center gap-3 p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
              <img
                src={selected.imageUrl}
                alt={selected.title}
                className="w-14 h-20 object-cover rounded bg-zinc-800 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-zinc-500">
                  {selected.anilistId > 0
                    ? `AniList ID #${selected.anilistId}`
                    : 'Imported — no AniList binding'}
                </p>
                <p className="text-sm font-semibold truncate" title={selected.title}>
                  {selected.title}
                </p>
                {selected.titleEnglish && selected.titleEnglish !== selected.title && (
                  <p
                    className="text-xs text-zinc-500 truncate"
                    title={selected.titleEnglish}
                  >
                    {selected.titleEnglish}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setQuery(title || selected.title);
                    setSelected(null);
                  }}
                  className="mt-1 text-xs text-indigo-400 hover:text-indigo-300"
                >
                  {selected.anilistId > 0 ? 'Change selection' : 'Search AniList to bind'}
                </button>
              </div>
            </div>
          )}

          {(selected || initial) && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Title (Japanese / Romaji)" full>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Sousou no Frieren"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
                />
              </Field>

              <Field label="Title (English)" full>
                <input
                  value={titleEnglish}
                  onChange={(e) => setTitleEnglish(e.target.value)}
                  placeholder="e.g. Frieren: Beyond Journey's End — optional"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
                />
              </Field>

              <Field label="Day">
                <select
                  value={day}
                  onChange={(e) => setDay(e.target.value as DayOfWeek | '')}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
                >
                  <option value="">— Unscheduled —</option>
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {DAY_LABELS[d]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Time (TH)">
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
                />
              </Field>

              <Field label="Platform">
                <input
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  list="platform-presets"
                  placeholder="e.g. Bilibili"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
                />
                <datalist id="platform-presets">
                  {PLATFORM_PRESETS.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </Field>

              <Field label="Platform URL">
                <input
                  type="url"
                  value={platformUrl}
                  onChange={(e) => setPlatformUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
                />
              </Field>

              <Field label="Status / Note" full>
                <input
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  placeholder="e.g. peak, ดอง, ok, dropped"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-indigo-500 outline-none text-sm"
                />
              </Field>
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 p-4 border-t border-zinc-800 bg-zinc-900">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            disabled={!canSave}
            onClick={handleSave}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-500 hover:bg-indigo-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white"
          >
            {initial ? 'Save Changes' : 'Add to Season'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="text-xs uppercase tracking-wide text-zinc-500 font-semibold">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
