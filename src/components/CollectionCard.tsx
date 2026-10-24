import { useCallback, useRef, useState } from 'react';
import { Bookmark, Heart, MoreVertical, Trash2, Tv } from 'lucide-react';
import type { CollectionEntry, ScheduleProgress } from '@/lib/types';
import { ShowLink, useWatchLinks } from '@/lib/nav';
import { BTN_ICON, FORMAT_LABEL, MENU, MENU_ITEM, POSTER_ICON, SURFACE } from '@/lib/ui';
import { nextProgressOnDec, nextProgressOnInc, nextProgressOnSetStatus } from '@/lib/utils';
import { useClickOutside } from '@/hooks/useClickOutside';
import { EpisodeStepper } from './EpisodeStepper';
import { StatusPill } from './StatusPill';
import { UserScorePill } from './UserScorePill';
import { ServiceLinks } from './ServiceLogo';
import { ROW_POSTER, ShowRow } from './ShowRow';

interface Props {
  /** A Collection show or an H favorite. */
  entry: Pick<CollectionEntry, 'anilistId' | 'title' | 'imageUrl' | 'format' | 'episodes' | 'startDate'>;
  /** `row`: the compact phone row. */
  layout?: 'card' | 'row';
  favorited: boolean;
  interested?: boolean;
  onToggleFavorite: () => void;
  /** Without it (H favorites, which have no Interested list) the menu only offers Remove. */
  onToggleInterested?: () => void;
  /** Removes the entry from the section being viewed (asks first). */
  onRemove: () => void;
  progress: ScheduleProgress;
  onUpdateProgress?: (next: ScheduleProgress) => void;
  userScore?: number;
  onSetUserScore?: (score: number | null) => void;
  /** Opens this page in a new tab instead of the show's detail page. */
  openUrl?: string;
}

/** Collection grid card, laid out like the Explore card: poster with heart
 *  and channel icons, title + format line, then your status / score and
 *  the episode stepper. On phones, a compact row with the same controls. */
export function CollectionCard({
  entry,
  layout = 'card',
  favorited,
  interested = false,
  onToggleFavorite,
  onToggleInterested,
  onRemove,
  progress,
  onUpdateProgress,
  userScore,
  onSetUserScore,
  openUrl,
}: Props) {
  const links = useWatchLinks(entry.anilistId);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useClickOutside(menuRef, menuOpen, closeMenu);

  const { watchStatus, totalEpisodes } = progress;
  const watched = progress.episodesWatched ?? 0;
  const update = (n: ReturnType<typeof nextProgressOnInc>) => onUpdateProgress?.({ ...n, totalEpisodes });

  const meta = [
    entry.format ? (FORMAT_LABEL[entry.format] ?? entry.format) : null,
    entry.episodes != null ? `${entry.episodes} eps` : null,
    entry.startDate?.year ? String(entry.startDate.year) : null,
  ].filter(Boolean);
  const metaLine = meta.map((m, i) => (
    <span key={i} className="contents">
      {i > 0 && <span aria-hidden>·</span>}
      <span>{m}</span>
    </span>
  ));

  const posterImg = entry.imageUrl ? (
    <img
      src={entry.imageUrl}
      alt={`${entry.title} poster`}
      loading="lazy"
      className={`h-full w-full object-cover ${layout === 'card' ? 'transition-transform duration-300 group-hover:scale-[1.03]' : ''}`}
    />
  ) : (
    <Tv className="m-auto h-8 w-8 text-zinc-600" />
  );
  const title = (className: string) => (
    <ShowLink anilistId={entry.anilistId} url={openUrl} className={`${className} text-left hover:text-indigo-300`} title={entry.title}>
      {entry.title}
    </ShowLink>
  );

  const chips = (
    <>
      {onUpdateProgress && (
        <StatusPill
          status={watchStatus}
          onChange={(s) => update(nextProgressOnSetStatus(s ?? undefined, watched, totalEpisodes))}
        />
      )}
      {onSetUserScore && <UserScorePill score={userScore} onChange={onSetUserScore} />}
    </>
  );

  const stepper = onUpdateProgress && (
    <EpisodeStepper
      watched={watched}
      total={totalEpisodes}
      onDec={() => update(nextProgressOnDec(watched, totalEpisodes, watchStatus))}
      onInc={() => update(nextProgressOnInc(watched, totalEpisodes, watchStatus))}
      size={layout}
      title={entry.title}
    />
  );

  const menu = (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        className={BTN_ICON}
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        aria-label={`More actions for ${entry.title}`}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {menuOpen && (
        // A card's menu opens upward so the next row of cards can't cover it.
        <div className={`${MENU} absolute right-0 w-40 p-1 text-sm ${layout === 'card' ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
          {onToggleInterested && (
            <>
              <button
                type="button"
                className={`${MENU_ITEM} ${favorited ? 'text-rose-300' : ''}`}
                onClick={() => {
                  setMenuOpen(false);
                  onToggleFavorite();
                }}
              >
                <Heart className={`h-3.5 w-3.5 ${favorited ? 'fill-current' : ''}`} />
                {favorited ? 'Unfavorite' : 'Favorite'}
              </button>
              <button
                type="button"
                className={`${MENU_ITEM} ${interested ? 'text-sky-300' : ''}`}
                onClick={() => {
                  setMenuOpen(false);
                  onToggleInterested();
                }}
              >
                <Bookmark className={`h-3.5 w-3.5 ${interested ? 'fill-current' : ''}`} />
                {interested ? 'Not interested' : 'Mark interested'}
              </button>
            </>
          )}
          <button
            type="button"
            className={`${MENU_ITEM} text-red-300`}
            onClick={() => {
              setMenuOpen(false);
              onRemove();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove from list
          </button>
        </div>
      )}
    </div>
  );

  if (layout === 'row') {
    // The Collection's lists are what the marks say; H favorites need none.
    const marks = onToggleInterested && (interested || favorited) && (
      <span className="flex shrink-0 gap-1">
        {interested && <Bookmark className="h-3.5 w-3.5 fill-current text-sky-400" aria-label="Interested" />}
        {favorited && <Heart className="h-3.5 w-3.5 fill-current text-rose-400" aria-label="Favorite" />}
      </span>
    );
    return (
      <ShowRow
        poster={
          <ShowLink anilistId={entry.anilistId} url={openUrl} className={ROW_POSTER} label={`Open ${entry.title}`}>
            {posterImg}
          </ShowLink>
        }
        title={
          <>
            {title('truncate')}
            {marks}
          </>
        }
        info={
          <>
            {metaLine}
            <ServiceLinks links={links} title={entry.title} size="h-5 w-5" max={2} className="ml-auto shrink-0 flex-nowrap" />
          </>
        }
        chips={chips}
        progress={stepper}
        menu={menu}
      />
    );
  }

  return (
    <article
      className={`group ${SURFACE} flex h-full flex-col transition-shadow hover:border-zinc-700 hover:shadow-lg hover:shadow-black/30`}
    >
      {/* Only the poster is clipped, so menus can spill past the card. */}
      <div className="relative overflow-hidden rounded-t-xl">
        <ShowLink
          anilistId={entry.anilistId}
          url={openUrl}
          className="block aspect-[2/3] w-full overflow-hidden bg-zinc-800"
          label={`Open ${entry.title}`}
          tabIndex={-1}
        >
          {posterImg}
        </ShowLink>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-end gap-1.5 p-2">
          {interested && (
            <button
              type="button"
              className={`${POSTER_ICON} pointer-events-auto text-sky-400 transition-colors hover:text-sky-200`}
              aria-label="Remove from Interested"
              title="Remove from Interested"
              onClick={onToggleInterested}
            >
              <Bookmark className="h-5 w-5 fill-current" />
            </button>
          )}
          {/* Only a favorite shows the heart; adding one is in the menu. */}
          {favorited && (
            <button
              type="button"
              className={`${POSTER_ICON} pointer-events-auto text-rose-500 transition-colors hover:text-rose-300`}
              aria-label="Remove from favorites"
              title="Remove from favorites"
              onClick={onToggleFavorite}
            >
              <Heart className="h-5 w-5 fill-current" />
            </button>
          )}
        </div>
        <ServiceLinks links={links} title={entry.title} className="absolute bottom-2 left-2" />
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="text-sm font-semibold leading-snug">{title('line-clamp-2')}</h3>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-400">{metaLine}</p>

        <div className="flex flex-wrap items-center gap-1">{chips}</div>

        <div className="mt-auto flex items-center gap-1.5 pt-2">
          {stepper ?? <span className="flex-1" />}
          {menu}
        </div>
      </div>
    </article>
  );
}
