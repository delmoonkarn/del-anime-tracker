import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Heart,
  Minus,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  Tv,
} from 'lucide-react';
import type { AnimeDetail, AnimeRelation } from '@/lib/anilist';
import type { DiscoverItem, ScheduleProgress, StreamLink, WatchStatus } from '@/lib/types';
import { stripHtml, toDiscoverItem } from '@/lib/discover';
import { useOpenDetail, useOwnLinks, useRememberAnilistLinks, useSetLinks } from '@/lib/nav';
import { mergeLinks, normalizeStreamUrl, toAnilistLinks } from '@/lib/streamLinks';
import { AIRING_STATUS_LABEL, BTN, BTN_PRIMARY, EYEBROW, FIELD, FORMAT_LABEL, MENU, MENU_ITEM, SURFACE } from '@/lib/ui';
import {
  WATCH_STATUSES,
  WATCH_STATUS_LABELS,
  formatNextAiring,
  nextProgressOnDec,
  nextProgressOnInc,
  nextProgressOnSetStatus,
} from '@/lib/utils';
import { useClickOutside } from '@/hooks/useClickOutside';
import { LinksEditor, cleanLinks } from './LinksEditor';
import { useConfirm } from './ConfirmDialog';
import { ServiceLogo } from './ServiceLogo';

interface Props {
  anilistId: number;
  onBack: () => void;
  /** Progress from the schedule / collection, when the show is tracked. */
  progress?: ScheduleProgress;
  /** True when the show is on any schedule season or in the collection. */
  tracked: boolean;
  onUpdateProgress: (next: ScheduleProgress) => void;
  isAddedTo: (anilistId: number, seasonName: string) => boolean;
  onAdd: (item: DiscoverItem, seasonName: string) => void;
  favorited: boolean;
  interested: boolean;
  onToggleFavorite: (item: DiscoverItem) => void;
  onToggleInterested: (item: DiscoverItem) => void;
}

// Detail responses are kept for the session so Back / re-opening is instant.
const cache = new Map<number, AnimeDetail>();

const SEASON_LABEL: Record<string, string> = {
  WINTER: 'Winter',
  SPRING: 'Spring',
  SUMMER: 'Summer',
  FALL: 'Fall',
};

const SOURCE_LABEL: Record<string, string> = {
  ORIGINAL: 'Original',
  MANGA: 'Manga',
  LIGHT_NOVEL: 'Light novel',
  VISUAL_NOVEL: 'Visual novel',
  VIDEO_GAME: 'Video game',
  NOVEL: 'Novel',
  WEB_NOVEL: 'Web novel',
  OTHER: 'Other',
};

const RELATION_LABEL: Record<string, string> = {
  PREQUEL: 'Prequel',
  SEQUEL: 'Sequel',
  PARENT: 'Parent story',
  SIDE_STORY: 'Side story',
  SPIN_OFF: 'Spin-off',
  ALTERNATIVE: 'Alternative',
  SUMMARY: 'Summary',
  COMPILATION: 'Compilation',
  CHARACTER: 'Shares characters',
  CONTAINS: 'Contains',
  SOURCE: 'Source',
  OTHER: 'Other',
};

/** Tracker season the show belongs in ("Fall 2026"), the same naming the
 *  schedule uses. Falls back to the start month when AniList has no season. */
function trackerSeasonName(d: AnimeDetail): string | null {
  if (d.season && d.seasonYear) return `${SEASON_LABEL[d.season]} ${d.seasonYear}`;
  const y = d.startDate?.year;
  if (!y) return null;
  const m = d.startDate?.month ?? 1;
  const s = m <= 3 ? 'Winter' : m <= 6 ? 'Spring' : m <= 9 ? 'Summer' : 'Fall';
  return `${s} ${y}`;
}

function formatDate(d: { year: number | null; month: number | null; day: number | null } | null | undefined): string {
  if (!d?.year) return '—';
  if (!d.month) return String(d.year);
  return new Date(d.year, d.month - 1, d.day ?? 1).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    ...(d.day ? { day: 'numeric' } : {}),
  });
}


export function AnimeDetailPage(props: Props) {
  const { anilistId } = props;
  const [data, setData] = useState<AnimeDetail | null>(() => cache.get(anilistId) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const rememberAnilistLinks = useRememberAnilistLinks();

  useEffect(() => {
    window.scrollTo(0, 0);
    const hit = cache.get(anilistId);
    setData(hit ?? null);
    setError(null);
    if (hit) return;
    const controller = new AbortController();
    (async () => {
      try {
        const { getAnimeDetail } = await import('@/lib/anilist');
        const d = await getAnimeDetail(anilistId, controller.signal);
        if (controller.signal.aborted) return;
        cache.set(anilistId, d);
        setData(d);
        // Fresh AniList links also go to the shared cache for the cards.
        rememberAnilistLinks({ [anilistId]: toAnilistLinks(d.externalLinks) });
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load from AniList.');
      }
    })();
    return () => controller.abort();
  }, [anilistId, attempt]);

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <BackButton onBack={props.onBack} floating={false} />
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
          <AlertTriangle className="h-5 w-5 text-red-400" />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">Couldn't load this anime</h3>
            <p className="text-sm text-zinc-400">{error}</p>
          </div>
          <button type="button" className={BTN} onClick={() => setAttempt((a) => a + 1)}>
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!data) return <DetailSkeleton onBack={props.onBack} />;
  return <Detail {...props} anime={data} />;
}

function BackButton({ onBack, floating = true }: { onBack: () => void; floating?: boolean }) {
  return (
    <button
      type="button"
      onClick={onBack}
      // No box behind it: over the banner a dark outline keeps it readable.
      className={
        floating
          ? 'absolute left-3 top-3 z-10 inline-flex h-8 items-center gap-1 px-1 text-sm font-medium text-white drop-shadow-[0_0_3px_rgba(0,0,0,0.85)] transition-colors hover:text-indigo-300'
          : 'inline-flex h-8 items-center gap-1 text-sm font-medium text-zinc-300 transition-colors hover:text-indigo-300'
      }
    >
      <ChevronLeft className="h-4 w-4" />
      Back
    </button>
  );
}

/** Wide banner when AniList has one, otherwise the poster blurred. */
function Backdrop({ anime, onBack }: { anime: AnimeDetail; onBack: () => void }) {
  const src = anime.bannerImage ?? anime.coverImage.extraLarge ?? anime.coverImage.large;
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div className="relative h-44 overflow-hidden rounded-xl bg-gradient-to-br from-indigo-500/30 via-zinc-800 to-rose-500/20 sm:h-64 lg:h-72">
      {src && failed !== src && (
        <img
          src={src}
          alt=""
          onError={() => setFailed(src)}
          className={`absolute inset-0 h-full w-full object-cover ${anime.bannerImage ? '' : 'scale-125 blur-2xl'}`}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/30 to-black/20" />
      <BackButton onBack={onBack} />
    </div>
  );
}

function Detail({
  anime,
  onBack,
  progress,
  tracked,
  onUpdateProgress,
  isAddedTo,
  onAdd,
  favorited,
  interested,
  onToggleFavorite,
  onToggleInterested,
}: Props & { anime: AnimeDetail }) {
  const item = toDiscoverItem(anime);
  const seasonName = trackerSeasonName(anime);
  const english = anime.title.english && anime.title.english !== item.title ? anime.title.english : null;
  const altTitles = [english, anime.title.native].filter(Boolean).join(' · ');
  const popularRank = anime.rankings?.find((r) => r.type === 'POPULAR' && r.allTime)?.rank;
  const studio = anime.studios?.nodes.map((n) => n.name).join(', ');

  const facts: [string, string][] = [
    ['Format', anime.format ? (FORMAT_LABEL[anime.format] ?? anime.format) : '—'],
    ['Episodes', anime.episodes != null ? String(anime.episodes) : anime.status === 'RELEASING' ? 'Airing' : '?'],
  ];
  if (anime.duration) facts.push(['Episode length', `${anime.duration} min`]);
  facts.push(['Status', anime.status ? (AIRING_STATUS_LABEL[anime.status] ?? anime.status) : '—']);
  if (anime.season && anime.seasonYear) facts.push(['Season', `${SEASON_LABEL[anime.season]} ${anime.seasonYear}`]);
  if (studio) facts.push(['Studio', studio]);
  if (anime.source) facts.push(['Source', SOURCE_LABEL[anime.source] ?? anime.source]);
  facts.push(['Started', formatDate(anime.startDate)]);
  facts.push(['Ended', anime.status === 'FINISHED' ? formatDate(anime.endDate) : '—']);
  if (anime.nextAiringEpisode) {
    facts.push(['Next episode', formatNextAiring(anime.nextAiringEpisode.episode, anime.nextAiringEpisode.airingAt)]);
  }

  const controls = (
    <>
      <TrackingControls
        total={anime.episodes ?? progress?.totalEpisodes}
        progress={progress}
        tracked={tracked}
        onUpdate={onUpdateProgress}
        seasonName={seasonName}
        added={seasonName ? isAddedTo(anime.id, seasonName) : false}
        onAdd={seasonName ? () => onAdd(item, seasonName) : undefined}
        favorited={favorited}
        interested={interested}
        onToggleFavorite={() => onToggleFavorite(item)}
        onToggleInterested={() => onToggleInterested(item)}
      />
      <WhereToWatch anime={anime} title={item.title} />
    </>
  );

  return (
    <article className="max-w-7xl mx-auto px-4 py-4 sm:py-8">
      <Backdrop anime={anime} onBack={onBack} />

      <div className="relative grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-8 md:px-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="-mt-28 flex flex-col gap-4 sm:-mt-36">
          <div className="aspect-[2/3] w-40 self-center overflow-hidden rounded-xl bg-zinc-800 shadow-xl ring-4 ring-zinc-950 sm:w-48 md:w-full">
            {anime.coverImage.extraLarge || anime.coverImage.large ? (
              <img
                src={anime.coverImage.extraLarge ?? anime.coverImage.large}
                alt={`${item.title} poster`}
                className="h-full w-full object-cover"
              />
            ) : (
              <Tv className="m-auto mt-20 h-8 w-8 text-zinc-600" />
            )}
          </div>
          <div className="hidden flex-col gap-4 md:flex">{controls}</div>
        </aside>

        <div className="flex min-w-0 flex-col gap-6 md:pt-5">
          <header className="text-center md:text-left">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">{item.title}</h1>
            {altTitles && <p className="mt-1 text-zinc-400">{altTitles}</p>}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 md:justify-start">
              {popularRank != null && (
                <span className="rounded-full bg-zinc-800 px-3 py-1 text-sm font-medium text-zinc-300">
                  #{popularRank} most popular
                </span>
              )}
              {anime.status && (
                <span
                  className={`rounded-full px-3 py-1 text-sm font-medium ${
                    anime.status === 'RELEASING' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800 text-zinc-300'
                  }`}
                >
                  {AIRING_STATUS_LABEL[anime.status] ?? anime.status}
                </span>
              )}
              {anime.averageScore != null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-3 py-1 text-sm font-medium text-amber-300">
                  <Star className="h-3.5 w-3.5 fill-current" />
                  {anime.averageScore}%
                </span>
              )}
              {(anime.genres ?? []).map((g) => (
                <span key={g} className="rounded-full border border-zinc-800 px-3 py-1 text-sm text-zinc-400">
                  {g}
                </span>
              ))}
            </div>
          </header>

          <div className="flex flex-col gap-4 md:hidden">{controls}</div>

          <dl className={`${SURFACE} grid grid-cols-2 gap-x-6 gap-y-5 p-5 sm:grid-cols-3 lg:grid-cols-4`}>
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className={EYEBROW}>{label}</dt>
                <dd className="mt-1 text-sm font-semibold">{value}</dd>
              </div>
            ))}
          </dl>

          <RelatedSection edges={anime.relations?.edges ?? []} />

          <section>
            <h2 className="mb-2 text-lg font-semibold">Synopsis</h2>
            <p className="whitespace-pre-line leading-relaxed text-zinc-300">
              {anime.description ? stripHtml(anime.description) : 'No synopsis available.'}
            </p>
          </section>

          {anime.trailer?.site === 'youtube' && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">Trailer</h2>
              <iframe
                className="aspect-video w-full rounded-xl border border-zinc-800 bg-black"
                src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(anime.trailer.id)}`}
                title={`${item.title} trailer`}
                allow="encrypted-media; picture-in-picture"
                allowFullScreen
                loading="lazy"
              />
            </section>
          )}
        </div>
      </div>
    </article>
  );
}

/** Status select, episode stepper, and the schedule / favorite / interested
 *  buttons. Progress lives on schedule + collection entries, so it can only
 *  be edited once the show is on one of them. */
function TrackingControls({
  total,
  progress,
  tracked,
  onUpdate,
  seasonName,
  added,
  onAdd,
  favorited,
  interested,
  onToggleFavorite,
  onToggleInterested,
}: {
  total: number | undefined;
  progress?: ScheduleProgress;
  tracked: boolean;
  onUpdate: (next: ScheduleProgress) => void;
  seasonName: string | null;
  added: boolean;
  onAdd?: () => void;
  favorited: boolean;
  interested: boolean;
  onToggleFavorite: () => void;
  onToggleInterested: () => void;
}) {
  const watched = progress?.episodesWatched ?? 0;
  const status = progress?.watchStatus;
  const atEnd = total != null && watched >= total;
  const percent = total ? Math.round((watched / total) * 100) : null;

  const setStatus = (s: WatchStatus | undefined) =>
    onUpdate({ ...nextProgressOnSetStatus(s, watched, total), totalEpisodes: total });
  const setWatched = (n: number) => {
    const clamped = Math.max(0, total != null ? Math.min(n, total) : n);
    onUpdate({ watchStatus: status, episodesWatched: clamped, totalEpisodes: total });
  };

  return (
    <section className={`${SURFACE} flex flex-col gap-4 p-4`} aria-label="My tracking">
      <label className="flex flex-col gap-1.5">
        <span className={EYEBROW}>My status</span>
        <select
          className={`${FIELD} w-full disabled:opacity-50`}
          value={status ?? ''}
          disabled={!tracked}
          onChange={(e) => setStatus((e.target.value || undefined) as WatchStatus | undefined)}
        >
          <option value="">— Not set —</option>
          {WATCH_STATUSES.map((s) => (
            <option key={s} value={s}>
              {WATCH_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <span className={EYEBROW}>Episodes watched</span>
          {tracked && percent !== null && <span className="text-xs tabular-nums text-zinc-400">{percent}%</span>}
        </div>
        <div className="flex h-8 w-full overflow-hidden rounded-lg border border-zinc-800">
          <button
            type="button"
            className="grid w-8 place-items-center bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40"
            disabled={!tracked || watched <= 0}
            onClick={() => onUpdate({ ...nextProgressOnDec(watched, total, status), totalEpisodes: total })}
            aria-label="One episode less"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <input
            type="number"
            min={0}
            max={total}
            className="min-w-0 flex-1 bg-zinc-950 text-center text-sm tabular-nums outline-none disabled:opacity-50"
            value={watched}
            disabled={!tracked}
            onChange={(e) => setWatched(Number(e.target.value) || 0)}
            aria-label="Episodes watched"
          />
          <span className="flex items-center border-l border-zinc-800 bg-zinc-900 px-3 text-sm tabular-nums text-zinc-400">
            / {total ?? '?'}
          </span>
          <button
            type="button"
            className="grid w-8 place-items-center bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40"
            disabled={!tracked || atEnd}
            onClick={() => onUpdate({ ...nextProgressOnInc(watched, total, status), totalEpisodes: total })}
            aria-label="One episode more"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {tracked && percent !== null && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800" aria-hidden>
            <div className="h-full bg-indigo-500" style={{ width: `${percent}%` }} />
          </div>
        )}
        {!tracked && (
          <span className="text-xs text-zinc-500">Add it to a schedule or your collection to track progress.</span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {onAdd && seasonName && (
          <button
            type="button"
            className={`${BTN} w-full ${added ? 'bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/15' : ''}`}
            disabled={added}
            onClick={onAdd}
          >
            {added ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {added ? `In ${seasonName} schedule` : `Add to ${seasonName}`}
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`${BTN} ${favorited ? 'bg-rose-500 text-white hover:bg-rose-600' : ''}`}
            aria-pressed={favorited}
            onClick={onToggleFavorite}
          >
            <Heart className={`h-3.5 w-3.5 ${favorited ? 'fill-current' : ''}`} />
            Favorite
          </button>
          <button
            type="button"
            className={`${BTN} ${interested ? 'bg-sky-500 text-white hover:bg-sky-600' : ''}`}
            aria-pressed={interested}
            onClick={onToggleInterested}
          >
            <Bookmark className={`h-3.5 w-3.5 ${interested ? 'fill-current' : ''}`} />
            Interested
          </button>
        </div>
      </div>
    </section>
  );
}

/** Which of your links is open in the editor: its position, or 'new' for one
 *  being added. */
interface LinkEdit {
  at: number | 'new';
  draft: StreamLink;
}

/** Your links for the show (editable, shared with its cards) followed by
 *  AniList's streaming links for services you haven't added (read-only). */
function WhereToWatch({ anime, title }: { anime: AnimeDetail; title: string }) {
  const own = useOwnLinks(anime.id);
  // Your links come first, in your order, so links[i] is own[i] for i < own.length.
  const links = mergeLinks(own, toAnilistLinks(anime.externalLinks));
  const setLinks = useSetLinks();
  const confirm = useConfirm();
  const [edit, setEdit] = useState<LinkEdit | null>(null);

  async function remove(i: number) {
    const ok = await confirm({
      title: 'Remove link',
      message: `Remove your ${own[i].site} link (${own[i].url})?`,
      kind: 'danger',
      confirmText: 'Remove',
    });
    if (ok) setLinks(anime.id, own.filter((_, j) => j !== i));
  }

  function editor(e: LinkEdit) {
    const url = normalizeStreamUrl(e.draft.url);
    const duplicate = url !== null && own.some((l, j) => j !== e.at && l.url === url);
    return (
      <form
        className="flex flex-col gap-2"
        // The URL box accepts "netflix.com/…" without https://; cleanLinks adds it.
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!url || duplicate) return;
          const next = e.at === 'new' ? [...own, e.draft] : own.map((l, j) => (j === e.at ? e.draft : l));
          setLinks(anime.id, cleanLinks(next));
          setEdit(null);
        }}
        onKeyDown={(ev) => ev.key === 'Escape' && setEdit(null)}
      >
        <LinksEditor
          links={[e.draft]}
          onChange={([draft]) => setEdit({ at: e.at, draft })}
          max={1}
          stacked
          removable={false}
          autoFocus
        />
        {duplicate && <p className="text-xs text-amber-300">You already have this link.</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={() => setEdit(null)}>
            Cancel
          </button>
          <button type="submit" className={BTN_PRIMARY} disabled={!url || duplicate}>
            {e.at === 'new' ? 'Add' : 'Save'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <section className={`${SURFACE} p-4`} aria-labelledby={`stream-${anime.id}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id={`stream-${anime.id}`} className={EYEBROW}>
          Where to watch
        </h2>
        {!edit && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-indigo-300"
            onClick={() => setEdit({ at: 'new', draft: { site: '', url: '' } })}
            title="Add your own link"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        )}
      </div>
      {edit?.at === 'new' && <div className="mb-3">{editor(edit)}</div>}
      {links.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {links.map((l, i) => {
            const mine = !l.fromAnilist;
            if (mine && edit?.at === i) return <li key={l.url}>{editor(edit)}</li>;
            return (
              <li
                key={l.url}
                // Your links carry the accent edge; AniList's don't.
                className={`flex h-11 items-center rounded-lg border border-zinc-800 bg-zinc-950/60 hover:border-indigo-500/50 ${
                  mine ? 'border-l-2 border-l-indigo-500' : ''
                }`}
              >
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-full min-w-0 flex-1 items-center gap-2.5 px-2 text-sm font-medium"
                  title={l.url}
                  aria-label={`Watch ${title} on ${l.site}`}
                >
                  <ServiceLogo link={l} className="h-8 w-8" />
                  <span className="truncate">{l.site}</span>
                  {l.fromAnilist && (
                    <span
                      className="shrink-0 rounded-full bg-zinc-800 px-1.5 py-px text-[0.625rem] font-semibold uppercase tracking-wide text-zinc-400"
                      title="Listed by AniList"
                    >
                      AniList
                    </span>
                  )}
                  <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 opacity-70" />
                </a>
                {mine && (
                  <OwnLinkMenu
                    site={l.site}
                    onEdit={() => setEdit({ at: i, draft: own[i] })}
                    onRemove={() => void remove(i)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        edit === null && (
          <p className="text-sm text-zinc-400">
            No streaming links yet — AniList lists none. Add the page where you watch it.
          </p>
        )
      )}
      <a
        href={`https://anilist.co/anime/${anime.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-indigo-300"
      >
        <ExternalLink className="h-3 w-3" />
        View on AniList
      </a>
    </section>
  );
}

/** ⋯ on one of your links: Edit / Remove. Narrow so the name keeps its room. */
function OwnLinkMenu({ site, onEdit, onRemove }: { site: string; onEdit: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);

  return (
    <div ref={ref} className="relative shrink-0 pr-1">
      <button
        type="button"
        className="inline-flex h-8 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Edit or remove your ${site} link`}
        title="Edit or remove"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className={`${MENU} absolute right-0 top-full mt-1 w-32 p-1 text-sm`}>
          <button
            type="button"
            className={MENU_ITEM}
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            type="button"
            className={`${MENU_ITEM} text-red-300`}
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

const RELATED_GRID = 'grid gap-2 sm:grid-cols-2 xl:grid-cols-3';
/** "Also in this series" items shown before "Show all". */
const OTHER_PREVIEW = 6;

/** Prequels and sequels, then other related shows, in a section that opens
 *  and closes. The summary says what is inside so it's useful while closed. */
function RelatedSection({ edges }: { edges: AnimeRelation[] }) {
  const anime = edges.filter((e) => e.node.type === 'ANIME');
  const storyLine = anime.filter((e) => e.relationType === 'PREQUEL' || e.relationType === 'SEQUEL');
  const other = anime.filter((e) => e.relationType !== 'PREQUEL' && e.relationType !== 'SEQUEL');
  const [showAll, setShowAll] = useState(false);
  const visibleOther = showAll ? other : other.slice(0, OTHER_PREVIEW);

  const story = [...new Set(storyLine.map((e) => RELATION_LABEL[e.relationType]))];
  const parts = [story.length > 0 ? story.join(' · ') : 'No prequel or sequel'];
  if (other.length > 0) parts.push(`${other.length} more in this series`);

  return (
    <details className={`group/related ${SURFACE} overflow-hidden`}>
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 select-none hover:bg-zinc-800/40 [&::-webkit-details-marker]:hidden">
        <h2 className="text-lg font-semibold">Prequel &amp; sequel</h2>
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">{parts.join(' + ')}</span>
        <ChevronDown className="h-5 w-5 shrink-0 text-zinc-500 transition-transform group-open/related:rotate-180" />
      </summary>
      <div className="flex flex-col gap-4 border-t border-zinc-800 p-4">
        {storyLine.length > 0 ? (
          <ul className={RELATED_GRID}>
            {storyLine.map((e) => (
              <li key={e.node.id}>
                <RelatedCard edge={e} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-400">This show has no prequel or sequel.</p>
        )}
        {other.length > 0 && (
          <div>
            <h3 className={`${EYEBROW} mb-2`}>Also in this series</h3>
            <ul className={RELATED_GRID}>
              {visibleOther.map((e) => (
                <li key={e.node.id}>
                  <RelatedCard edge={e} />
                </li>
              ))}
            </ul>
            {other.length > OTHER_PREVIEW && (
              <button
                type="button"
                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-zinc-300 hover:bg-zinc-800"
                onClick={() => setShowAll((v) => !v)}
                aria-expanded={showAll}
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAll ? 'rotate-180' : ''}`} />
                {showAll ? 'Show less' : `Show all ${other.length}`}
              </button>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

function RelatedCard({ edge: { relationType, node } }: { edge: AnimeRelation }) {
  const openDetail = useOpenDetail();
  const storyLine = relationType === 'PREQUEL' || relationType === 'SEQUEL';
  const title = node.title.romaji || node.title.english || `#${node.id}`;
  return (
    <button
      type="button"
      onClick={() => openDetail(node.id)}
      className={`${SURFACE} group flex w-full items-center gap-3 p-2 text-left transition-colors hover:border-indigo-500/50`}
    >
      <div className="h-16 w-11 shrink-0 overflow-hidden rounded-md bg-zinc-800">
        {node.coverImage.medium && <img src={node.coverImage.medium} alt="" loading="lazy" className="h-full w-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <span
          className={`inline-block rounded-full px-1.5 py-px text-[0.625rem] font-semibold uppercase tracking-wide ${
            storyLine ? 'bg-indigo-500/15 text-indigo-300' : 'bg-zinc-800 text-zinc-400'
          }`}
        >
          {RELATION_LABEL[relationType] ?? relationType}
        </span>
        <p className="mt-0.5 truncate text-sm font-medium group-hover:text-indigo-300" title={title}>
          {title}
        </p>
        <p className="truncate text-xs text-zinc-400">
          {node.format ? (FORMAT_LABEL[node.format] ?? node.format) : '—'}
          {node.startDate?.year && ` · ${node.startDate.year}`}
          {node.status && ` · ${AIRING_STATUS_LABEL[node.status] ?? node.status}`}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600 group-hover:text-indigo-300" />
    </button>
  );
}

function DetailSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="max-w-7xl mx-auto px-4 py-4 sm:py-8" aria-busy="true">
      <div className="relative h-44 animate-pulse rounded-xl bg-zinc-900 sm:h-64 lg:h-72">
        <BackButton onBack={onBack} />
      </div>
      <div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-8 md:px-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="-mt-28 aspect-[2/3] w-40 self-start justify-self-center animate-pulse rounded-xl bg-zinc-800 ring-4 ring-zinc-950 sm:-mt-36 sm:w-48 md:w-full" />
        <div className="flex flex-col gap-3 md:pt-5">
          <div className="h-9 w-2/3 animate-pulse rounded bg-zinc-800" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-zinc-800" />
          <div className="mt-4 h-28 animate-pulse rounded-xl bg-zinc-900" />
        </div>
      </div>
    </div>
  );
}
