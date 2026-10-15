import { createContext, useContext } from 'react';
import type { AnimeEntry, StreamLink } from './types';

interface NavContextValue {
  /** Opens the detail page for an AniList id. */
  openDetail: (anilistId: number) => void;
  /** Your streaming links, by AniList id (stream_links table). */
  linksByShow: Map<number, StreamLink[]>;
  /** Replaces a show's streaming links. */
  setLinks: (anilistId: number, links: StreamLink[]) => void;
}

const NavContext = createContext<NavContextValue>({
  openDetail: () => {},
  linksByShow: new Map(),
  setLinks: () => {},
});

export const NavProvider = NavContext.Provider;

export function useOpenDetail() {
  return useContext(NavContext).openDetail;
}

const NO_LINKS: StreamLink[] = [];

/** "Where to watch" for a show: the links you've saved for it. */
export function useWatchLinks(anilistId: number): StreamLink[] {
  return useContext(NavContext).linksByShow.get(anilistId) ?? NO_LINKS;
}

/** `useWatchLinks` for many shows at once (filters, counts). */
export function useLinksResolver(): (anilistId: number) => StreamLink[] {
  const { linksByShow } = useContext(NavContext);
  return (anilistId) => linksByShow.get(anilistId) ?? NO_LINKS;
}

export function useSetLinks() {
  return useContext(NavContext).setLinks;
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
