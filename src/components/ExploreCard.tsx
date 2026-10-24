import { useCallback, useRef, useState } from 'react';
import { Bookmark, Check, ChevronDown, Heart, Plus, Star, Tv } from 'lucide-react';
import type { DiscoverItem } from '@/lib/types';
import { ShowLink, useWatchLinks } from '@/lib/nav';
import { AIRING_STATUS_LABEL, FORMAT_LABEL, MENU, POSTER_ICON, SURFACE } from '@/lib/ui';
import { useClickOutside } from '@/hooks/useClickOutside';
import { ServiceLinks } from './ServiceLogo';

interface Props {
  item: DiscoverItem;
  favorited: boolean;
  onToggleFavorite: () => void;
  /** The Explore page's "Add to list" menu: schedule, Interested, favorites.
   *  Without it (the H page) the button just adds or removes the favorite. */
  list?: {
    /** Tracker season this show would be added to ("Fall 2026"). */
    seasonName: string;
    added: boolean;
    onAdd: () => void;
    interested: boolean;
    onToggleInterested: () => void;
  };
  /** Opens this page in a new tab instead of the show's detail page. */
  openUrl?: string;
}

/** Explore grid card: poster (opens the detail page) with a favorite heart
 *  and channel icons, title + format line, and an "Add to list" menu. */
export function ExploreCard({ item, favorited, onToggleFavorite, list, openUrl }: Props) {
  const links = useWatchLinks(item.anilistId);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useClickOutside(menuRef, menuOpen, closeMenu);

  const meta = [
    item.format ? (FORMAT_LABEL[item.format] ?? item.format) : null,
    item.episodes != null ? `${item.episodes} eps` : null,
  ].filter(Boolean);
  const status = item.status ? (AIRING_STATUS_LABEL[item.status] ?? item.status) : null;
  const added = list?.added ?? false;
  const interested = list?.interested ?? false;

  return (
    <article
      className={`group ${SURFACE} flex flex-col overflow-hidden transition-shadow hover:shadow-lg hover:shadow-black/30 ${
        added ? 'border-indigo-500/60 ring-1 ring-indigo-500/40' : 'hover:border-zinc-700'
      }`}
    >
      <div className="relative">
        <ShowLink
          anilistId={item.anilistId}
          url={openUrl}
          className="block w-full aspect-[2/3] overflow-hidden bg-zinc-800"
          label={`Open ${item.title}`}
          tabIndex={-1}
        >
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={`${item.title} poster`}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <Tv className="m-auto h-8 w-8 text-zinc-600" />
          )}
        </ShowLink>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-end gap-1.5 p-2">
          {interested && (
            <button
              type="button"
              className={`${POSTER_ICON} pointer-events-auto text-sky-400 transition-colors hover:text-sky-200`}
              aria-label="Remove from Interested"
              title="Remove from Interested"
              onClick={list?.onToggleInterested}
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
        <ServiceLinks links={links} title={item.title} className="absolute bottom-2 left-2" />
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="text-sm font-semibold leading-snug">
          <ShowLink
            anilistId={item.anilistId}
            url={openUrl}
            className="line-clamp-2 text-left hover:text-indigo-300"
            title={item.title}
          >
            {item.title}
          </ShowLink>
        </h3>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-400">
          {meta.map((m, i) => (
            <span key={i} className="contents">
              {i > 0 && <span aria-hidden>·</span>}
              <span>{m}</span>
            </span>
          ))}
          {status && (
            <>
              {meta.length > 0 && <span aria-hidden>·</span>}
              <span className={item.status === 'RELEASING' ? 'font-medium text-emerald-400' : ''}>{status}</span>
            </>
          )}
          {item.averageScore != null && (
            <span className="ml-auto inline-flex items-center gap-0.5 text-amber-300">
              <Star className="h-3 w-3 fill-current" />
              {item.averageScore}%
            </span>
          )}
        </p>

        {!list ? (
          <div className="mt-auto pt-2">
            <button
              type="button"
              onClick={onToggleFavorite}
              className={`flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
                favorited
                  ? 'border-rose-500/30 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                  : 'border-zinc-700 text-zinc-200 hover:border-rose-500 hover:bg-rose-500 hover:text-white'
              }`}
            >
              <Heart className={`h-3.5 w-3.5 ${favorited ? 'fill-current' : ''}`} />
              {favorited ? 'In favorites' : 'Add to favorites'}
            </button>
          </div>
        ) : (
          // Opens upward so the next row of cards can't cover it.
          <div ref={menuRef} className="relative mt-auto pt-2">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className={`flex h-8 w-full items-center justify-between rounded-lg border px-3 text-sm font-medium transition-colors ${
                added
                  ? 'border-indigo-500/30 bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25'
                  : 'border-zinc-700 text-zinc-200 hover:border-indigo-500 hover:bg-indigo-500 hover:text-white'
              }`}
              aria-expanded={menuOpen}
              aria-label={`List options for ${item.title}`}
            >
              <span className="inline-flex items-center gap-1.5">
                {added ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                {added ? 'In schedule' : 'Add to list'}
              </span>
              <ChevronDown className={`h-3.5 w-3.5 opacity-60 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </button>
            {menuOpen && (
              <div className={`${MENU} absolute inset-x-0 bottom-full mb-1 p-1 text-sm`}>
                <button
                  type="button"
                  disabled={added}
                  onClick={() => {
                    list.onAdd();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-zinc-700 disabled:cursor-default disabled:text-indigo-300 disabled:hover:bg-transparent"
                >
                  {added ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  <span className="truncate">
                    {added ? `In ${list.seasonName}` : `Add to ${list.seasonName}`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    list.onToggleInterested();
                    setMenuOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-zinc-700 ${interested ? 'text-sky-300' : ''}`}
                >
                  <Bookmark className={`h-3.5 w-3.5 ${interested ? 'fill-current' : ''}`} />
                  {interested ? 'Interested' : 'Mark interested'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onToggleFavorite();
                    setMenuOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-zinc-700 ${favorited ? 'text-rose-300' : ''}`}
                >
                  <Heart className={`h-3.5 w-3.5 ${favorited ? 'fill-current' : ''}`} />
                  {favorited ? 'In favorites' : 'Add to favorites'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
