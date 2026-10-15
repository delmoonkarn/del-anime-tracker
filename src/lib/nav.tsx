import { createContext, useContext } from 'react';
import type { AnimeEntry, StreamLink } from './types';
import { mergeLinks, type Brand } from './streamLinks';

interface NavContextValue {
  /** Opens the detail page for an AniList id. */
  openDetail: (anilistId: number) => void;
  /** Your own streaming links, by AniList id (stream_links table). */
  ownLinksByShow: Map<number, StreamLink[]>;
  /** AniList's streaming links, by AniList id (cached). */
  anilistLinksByShow: Map<number, StreamLink[]>;
  /** Replaces a show's own streaming links. */
  setLinks: (anilistId: number, links: StreamLink[]) => void;
  /** Hands AniList links fetched by a page (Explore, Watchlist, Detail) to
   *  the shared cache, so every card for those shows can use them. */
  rememberAnilistLinks: (byShow: Record<number, StreamLink[]>) => void;
  /** Brand icon + colour for a link (AniList's catalogue), if known. */
  brandFor: (link: StreamLink) => Brand | null;
}

const NavContext = createContext<NavContextValue>({
  openDetail: () => {},
  ownLinksByShow: new Map(),
  anilistLinksByShow: new Map(),
  setLinks: () => {},
  rememberAnilistLinks: () => {},
  brandFor: () => null,
});

export const NavProvider = NavContext.Provider;

export function useOpenDetail() {
  return useContext(NavContext).openDetail;
}

const NO_LINKS: StreamLink[] = [];

/** "Where to watch" for a show: your links first, then AniList's for
 *  services you haven't added yourself. */
export function useWatchLinks(anilistId: number): StreamLink[] {
  const { ownLinksByShow, anilistLinksByShow } = useContext(NavContext);
  const own = ownLinksByShow.get(anilistId);
  const anilist = anilistLinksByShow.get(anilistId);
  if (!anilist) return own ?? NO_LINKS;
  return mergeLinks(own, anilist);
}

/** `useWatchLinks` for many shows at once (filters, counts). */
export function useLinksResolver(): (anilistId: number) => StreamLink[] {
  const { ownLinksByShow, anilistLinksByShow } = useContext(NavContext);
  return (anilistId) => {
    const anilist = anilistLinksByShow.get(anilistId);
    const own = ownLinksByShow.get(anilistId);
    return anilist ? mergeLinks(own, anilist) : (own ?? NO_LINKS);
  };
}

/** Only the links you added yourself (what the editors edit). */
export function useOwnLinks(anilistId: number): StreamLink[] {
  return useContext(NavContext).ownLinksByShow.get(anilistId) ?? NO_LINKS;
}

export function useSetLinks() {
  return useContext(NavContext).setLinks;
}

export function useBrandFor() {
  return useContext(NavContext).brandFor;
}

export function useRememberAnilistLinks() {
  return useContext(NavContext).rememberAnilistLinks;
}

/** The streaming link typed in on a schedule entry, as a channel icon. */
export function entryLink(entry: AnimeEntry): StreamLink[] {
  if (!entry.platformUrl) return [];
  let site = entry.platform.trim();
  if (!site) {
    try {
      site = new URL(entry.platformUrl).hostname.replace(/^www\./, '');
    } catch {
      site = entry.platformUrl;
    }
  }
  return [{ site, url: entry.platformUrl }];
}
