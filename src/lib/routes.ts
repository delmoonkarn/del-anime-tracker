// The app's page addresses, so pages can be opened in new tabs, bookmarked
// and reloaded. Both servers answer any address that isn't a file or /api
// with the app itself (wrangler.toml [assets], server/index.ts), and the app
// reads the address to pick the page.
//
//   /                          the current season's schedule
//   /schedule/winter-2026      another season's schedule
//   /watchlist                 /explore                 /collection
//   /collection/interested     /h                       /h/favorites
//   /settings/account          /settings/backup
//   /anime/12345               a show's page (AniList id)

import type { AppView } from './types';

const VIEW_PATHS: Record<Exclude<AppView, 'schedule'>, string> = {
  watchlist: '/watchlist',
  'discover-season': '/explore',
  'discover-h': '/h',
  'h-favorites': '/h/favorites',
  'collection-favorites': '/collection',
  'collection-interested': '/collection/interested',
  'settings-account': '/settings/account',
  'settings-backup': '/settings/backup',
};

/** "Winter 2026" → "winter-2026". */
export function seasonSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A page's address. `season` is the schedule's season slug, or null for the current season. */
export function pathFor(view: AppView, season: string | null = null): string {
  if (view === 'schedule') return season ? `/schedule/${season}` : '/';
  return VIEW_PATHS[view];
}

export function detailPath(anilistId: number): string {
  return `/anime/${anilistId}`;
}

export interface Route {
  view: AppView;
  /** AniList id of a show's page opened on top of `view`. */
  detail: number | null;
  /** Schedule season slug; null for the current season. */
  season: string | null;
}

/** The page an address points at. Anything unknown is the schedule. */
export function parsePath(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  const show = /^\/anime\/(\d+)$/.exec(path);
  if (show) return { view: 'schedule', detail: Number(show[1]), season: null };
  const season = /^\/schedule\/([a-z0-9-]+)$/.exec(path);
  if (season) return { view: 'schedule', detail: null, season: season[1] };
  const view = (Object.keys(VIEW_PATHS) as (keyof typeof VIEW_PATHS)[]).find((v) => VIEW_PATHS[v] === path);
  return { view: view ?? 'schedule', detail: null, season: null };
}
