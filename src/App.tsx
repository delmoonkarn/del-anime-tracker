import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { SeasonSelector } from '@/components/SeasonSelector';
import { ScheduleGrid } from '@/components/ScheduleGrid';
import { AddAnimeModal } from '@/components/AddAnimeModal';
import { EmptyState } from '@/components/EmptyState';
import { ManageSeasonsModal } from '@/components/ManageSeasonsModal';
import { DiscoverPage } from '@/components/DiscoverPage';
import { HDiscoverPage } from '@/components/HDiscoverPage';
import { HFavoritesPage } from '@/components/HFavoritesPage';
import { CollectionPage } from '@/components/CollectionPage';
import { WatchlistPage, type WatchItem } from '@/components/WatchlistPage';
import { AnimeDetailPage } from '@/components/AnimeDetailPage';
import { NavProvider, entryLink } from '@/lib/nav';
import { brandFor, buildBrandIndex, toAnilistLinks } from '@/lib/streamLinks';
import { useConfirm } from '@/components/ConfirmDialog';
import type {
  AnilistLinksCache,
  AnilistMedia,
  AnimeEntry,
  AppState,
  LinkSourcesCache,
  AppView,
  CollectionEntry,
  CollectionSection,
  DiscoverCache,
  DiscoverCacheEntry,
  DiscoverItem,
  DiscoverVariant,
  HFavoriteEntry,
  ScheduleProgress,
  Season,
  StreamLink,
  StreamLinksMap,
} from '@/lib/types';
import type { ImportProgress } from '@/lib/import';
import {
  loadCollection,
  loadDiscoverCache,
  loadHFavorites,
  loadAnilistLinks,
  loadLinkSources,
  loadState,
  loadStreamLinks,
  saveCollection,
  saveDiscoverCache,
  saveHFavorites,
  saveAnilistLinks,
  saveLinkSources,
  saveState,
  saveStreamLinks,
} from '@/lib/storage';
import {
  deriveDayFromStartDate,
  deriveDayTimeFromAiringAt,
  getCurrentAnimeSeasonRef,
  newId,
  tagsMatch,
} from '@/lib/utils';
import { DIALOG, DIALOG_BACKDROP } from '@/lib/ui';

/** One browser-history entry: which page, which detail (if any), and the
 *  scroll position it was left at. `idx` counts entries within this app. */
interface NavEntry {
  view: AppView;
  detail: number | null;
  idx: number;
  scroll?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** AniList's streaming links are re-checked once a week. */
const LINKS_TTL_MS = 7 * DAY_MS;
/** AniList's list of streaming services (brand icons) is re-checked monthly. */
const SOURCES_TTL_MS = 30 * DAY_MS;

function guessCurrentSeason(): string {
  const now = new Date();
  const m = now.getMonth();
  const y = now.getFullYear();
  let season = 'Winter';
  if (m >= 2 && m <= 4) season = 'Spring';
  else if (m >= 5 && m <= 7) season = 'Summer';
  else if (m >= 8 && m <= 10) season = 'Fall';
  return `${season} ${y}`;
}

function defaultState(): AppState {
  const seasonId = newId();
  return {
    seasons: [{ id: seasonId, name: guessCurrentSeason(), createdAt: Date.now(), animes: [] }],
    activeSeasonId: seasonId,
  };
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AnimeEntry | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [view, setView] = useState<AppView>('schedule');
  const [collection, setCollection] = useState<CollectionEntry[]>([]);
  const [hFavorites, setHFavorites] = useState<HFavoriteEntry[]>([]);
  const [discoverCache, setDiscoverCache] = useState<DiscoverCache>({ entries: [] });
  /** Your streaming links per show (stream_links table), keyed by AniList id. */
  const [streamLinks, setStreamLinks] = useState<StreamLinksMap>({});
  /** AniList's streaming links per show (anilist_link_cache table). */
  const [anilistLinks, setAnilistLinks] = useState<AnilistLinksCache>({});
  /** AniList's streaming-service catalogue (brand icons for your links). */
  const [linkSources, setLinkSources] = useState<LinkSourcesCache | null>(null);
  const [importingCollection, setImportingCollection] = useState(false);
  /** AniList id of the open detail page. The page underneath stays mounted
   *  (hidden) so Explore filters and scroll survive a trip to a detail. */
  const [detailId, setDetailId] = useState<number | null>(null);
  /** Position of the current entry in this app's own history (0 = the
   *  entry the app booted on), so Back never walks out of the app. */
  const navIdx = useRef(0);
  const confirm = useConfirm();
  // Becomes true once initial load from localStorage has completed. The save
  // effects below gate on this so they don't overwrite stored data with the
  // useState defaults during the brief window before the load commits.
  const [hydrated, setHydrated] = useState(false);

  const discoverDefaultRef = useMemo(() => getCurrentAnimeSeasonRef(), []);

  /** Stores AniList links fetched anywhere (Explore, Watchlist, Detail, the
   *  background refreshers) in the shared cache. Unchanged links fetched
   *  less than a day ago are skipped so the cache isn't rewritten for nothing. */
  const rememberAnilistLinks = (byShow: Record<number, StreamLink[]>) => {
    if (Object.keys(byShow).length === 0) return;
    setAnilistLinks((prev) => {
      const now = Date.now();
      let next: AnilistLinksCache | null = null;
      for (const [key, links] of Object.entries(byShow)) {
        const id = Number(key);
        if (!(id > 0)) continue;
        const cur = prev[id];
        if (cur && now - cur.at < DAY_MS && JSON.stringify(cur.links) === JSON.stringify(links)) continue;
        next ??= { ...prev };
        next[id] = { at: now, links };
      }
      return next ?? prev;
    });
  };
  const rememberFromMedia = (media: AnilistMedia[]) =>
    rememberAnilistLinks(Object.fromEntries(media.map((m) => [m.id, toAnilistLinks(m.externalLinks)])));
  const rememberFromItems = (items: DiscoverItem[]) =>
    rememberAnilistLinks(
      Object.fromEntries(items.filter((i) => i.streamLinks).map((i) => [i.anilistId, i.streamLinks!])),
    );

  /** Fetches AniList links for every show on a schedule or in the collection
   *  that has none cached, or whose cache is over a week old. Waits a few
   *  seconds so the airing refresh / backfill go first (AniList rate limit). */
  const refreshAnilistLinks = async (ids: number[], cache: AnilistLinksCache) => {
    const now = Date.now();
    const stale = [...new Set(ids)].filter((id) => id > 0 && !(cache[id] && now - cache[id].at < LINKS_TTL_MS));
    if (stale.length === 0) return;
    await new Promise((r) => setTimeout(r, 4000));
    const BATCH = 50;
    const DELAY_MS = 1200;
    try {
      const { getAnimesByIds } = await import('@/lib/anilist');
      for (let i = 0; i < stale.length; i += BATCH) {
        const chunk = stale.slice(i, i + BATCH);
        try {
          const media = await getAnimesByIds(chunk);
          rememberFromMedia(media);
          // Shows AniList returned nothing for still get an (empty) entry, so
          // they aren't asked for again until the cache goes stale.
          const got = new Set(media.map((m) => m.id));
          rememberAnilistLinks(Object.fromEntries(chunk.filter((id) => !got.has(id)).map((id) => [id, []])));
        } catch (err) {
          console.warn(`[links] batch starting at ${i} failed:`, err);
        }
        if (i + BATCH < stale.length) await new Promise((r) => setTimeout(r, DELAY_MS));
      }
      console.info(`[links] refreshed AniList links for ${stale.length} show(s)`);
    } catch (err) {
      console.warn('[links] refresh failed:', err);
    }
  };

  useEffect(() => {
    (async () => {
      const [loaded, loadedCollection, loadedDiscover, loadedHFavs, loadedLinks, loadedAnilistLinks, loadedSources] =
        await Promise.all([
          loadState(),
          loadCollection(),
          loadDiscoverCache(),
          loadHFavorites(),
          loadStreamLinks(),
          loadAnilistLinks(),
          loadLinkSources(),
        ]);
      // Always boot into the current calendar season's schedule. If a season
      // with that name exists in storage, switch the active season to it; if
      // not, leave whatever was last active alone (user has nothing matching).
      let initial = loaded ?? defaultState();
      const currentName = discoverDefaultRef.name.toLowerCase();
      const currentMatch = initial.seasons.find(
        (s) => s.name.trim().toLowerCase() === currentName,
      );
      if (currentMatch && currentMatch.id !== initial.activeSeasonId) {
        initial = { ...initial, activeSeasonId: currentMatch.id };
      }
      setState(initial);
      setCollection(loadedCollection);
      setDiscoverCache(loadedDiscover);
      setHFavorites(loadedHFavs);
      setStreamLinks(loadedLinks);
      setAnilistLinks(loadedAnilistLinks);
      setLinkSources(loadedSources);
      setHydrated(true);
      // AniList's streaming-service catalogue: one request, re-checked monthly.
      if (!loadedSources || Date.now() - loadedSources.at > SOURCES_TTL_MS) {
        void (async () => {
          try {
            const { getStreamingSources } = await import('@/lib/anilist');
            const sources = await getStreamingSources();
            if (sources.length > 0) {
              const cache = { at: Date.now(), sources };
              setLinkSources(cache);
              saveLinkSources(cache);
            }
          } catch (err) {
            console.warn('[links] streaming-service catalogue fetch failed:', err);
          }
        })();
      }
      // Explore results saved earlier already carry AniList's links.
      for (const e of loadedDiscover.entries) rememberFromItems(e.items);

      // One-time tag enrichment: older collection entries only had top-5 tags.
      // Pull the full tag list from AniList in batches for anything missing
      // the tagsFull flag (and with a valid anilistId we can look up).
      const needsEnrich = loadedCollection.filter(
        (c) => c.anilistId > 0 && !c.tagsFull,
      );
      if (needsEnrich.length > 0) {
        void enrichCollectionTags(needsEnrich);
      }

      // Background airing refresh: only for the current calendar season's
      // schedule — past seasons are finished (nothing to refresh) and future
      // seasons haven't started, so the API calls would be wasted.
      void refreshAiringSchedules(initial);
      // One-shot metadata backfill: catches entries (across ALL seasons)
      // imported before the day/time/totalEpisodes auto-derive shipped.
      // Self-throttles via the "needs filling" check, so it's a no-op
      // once everything's clean.
      void backfillScheduleMetadata(initial);
      // AniList streaming links for everything you track (weekly).
      void refreshAnilistLinks(
        [
          ...initial.seasons.flatMap((s) => s.animes.map((a) => a.anilistId)),
          ...loadedCollection.map((c) => c.anilistId),
        ],
        loadedAnilistLinks,
      );
    })();
    // discoverDefaultRef is memoized once; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Refreshes cached AniList airing data — but only for entries in the
   *  current calendar season. Past seasons are finished (no future airings
   *  to track) and future seasons haven't started, so spending API calls on
   *  them is wasted. The schedule card's aired / next-episode info is gated
   *  to the current season too, so data fetched outside it wouldn't show.
   *
   *  Within the current season we skip COMPLETED/DROPPED entries and any
   *  whose cache is still fresh (nextAiringAt in the future). Batched in
   *  groups of 50 with a short delay to respect AniList's 90 req/min limit. */
  const refreshAiringSchedules = async (snapshot: AppState) => {
    const currentName = discoverDefaultRef.name.toLowerCase();
    const currentSeason = snapshot.seasons.find(
      (s) => s.name.trim().toLowerCase() === currentName,
    );
    if (!currentSeason) return;
    const nowSec = Date.now() / 1000;
    const candidates = currentSeason.animes.filter(
      (a) =>
        a.anilistId > 0 &&
        a.watchStatus !== 'COMPLETED' &&
        a.watchStatus !== 'DROPPED' &&
        (a.nextAiringAt == null || a.nextAiringAt < nowSec),
    );
    if (candidates.length === 0) return;
    const ids = Array.from(new Set(candidates.map((c) => c.anilistId)));
    const BATCH = 50;
    const DELAY_MS = 800;
    try {
      const { getAnimesByIds } = await import('@/lib/anilist');
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        try {
          const media = await getAnimesByIds(chunk);
          rememberFromMedia(media);
          const byId = new Map(media.map((m) => [m.id, m]));
          setState((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              seasons: prev.seasons.map((s) => ({
                ...s,
                animes: s.animes.map((a) => {
                  const m = byId.get(a.anilistId);
                  if (!m) return a;
                  // AniList returns null for finished/cancelled shows. That's
                  // a meaningful signal (no future airing) — store undefined
                  // for both so the UI knows to fall back to totalEpisodes.
                  const nextEp = m.nextAiringEpisode?.episode;
                  const nextAt = m.nextAiringEpisode?.airingAt;
                  return {
                    ...a,
                    nextAiringEpisode: nextEp ?? undefined,
                    nextAiringAt: nextAt ?? undefined,
                    // Backfill totalEpisodes + format too if missing.
                    totalEpisodes: a.totalEpisodes ?? m.episodes ?? undefined,
                    format: a.format ?? m.format ?? undefined,
                  };
                }),
              })),
            };
          });
        } catch (err) {
          console.warn(`[airing] batch starting at ${i} failed:`, err);
        }
        if (i + BATCH < ids.length) {
          await new Promise((r) => setTimeout(r, DELAY_MS));
        }
      }
      console.info(`[airing] refreshed ${ids.length} schedule entries`);
    } catch (err) {
      console.warn('[airing] refresh failed:', err);
    }
  };

  /** Fills in missing `day` / `time` / `totalEpisodes` on any schedule entry
   *  that has an AniList ID — runs across every season, unlike the airing
   *  refresh which is scoped to the current calendar season. Naturally
   *  idempotent: once an entry's fields are populated the next call won't
   *  pick it up. Doesn't touch `nextAiringEpisode` / `nextAiringAt` (those
   *  are owned by `refreshAiringSchedules`). */
  const backfillScheduleMetadata = async (snapshot: AppState) => {
    const candidates = snapshot.seasons.flatMap((s) =>
      s.animes.filter(
        (a) =>
          a.anilistId > 0 &&
          (a.day == null ||
            !a.time ||
            a.totalEpisodes == null ||
            a.nextAiringAt == null ||
            a.format == null),
      ),
    );
    if (candidates.length === 0) return;
    const ids = Array.from(new Set(candidates.map((c) => c.anilistId)));
    const BATCH = 50;
    const DELAY_MS = 800;
    try {
      const [{ getAnimesByIds }, utils] = await Promise.all([
        import('@/lib/anilist'),
        import('@/lib/utils'),
      ]);
      const { deriveDayTimeFromAiringAt, deriveDayFromStartDate } = utils;
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        try {
          const media = await getAnimesByIds(chunk);
          rememberFromMedia(media);
          const byId = new Map(media.map((m) => [m.id, m]));
          setState((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              seasons: prev.seasons.map((s) => ({
                ...s,
                animes: s.animes.map((a) => {
                  const m = byId.get(a.anilistId);
                  if (!m) return a;
                  const fromAiring = deriveDayTimeFromAiringAt(
                    m.nextAiringEpisode?.airingAt ?? null,
                  );
                  const dayHint =
                    fromAiring?.day ?? deriveDayFromStartDate(m.startDate);
                  // Each field is only filled when currently missing — never
                  // clobber user-edited values.
                  return {
                    ...a,
                    day: a.day ?? dayHint ?? null,
                    time: a.time || fromAiring?.time || '',
                    totalEpisodes: a.totalEpisodes ?? m.episodes ?? undefined,
                    nextAiringEpisode:
                      a.nextAiringEpisode ??
                      m.nextAiringEpisode?.episode ??
                      undefined,
                    nextAiringAt:
                      a.nextAiringAt ??
                      m.nextAiringEpisode?.airingAt ??
                      undefined,
                    format: a.format ?? m.format ?? undefined,
                  };
                }),
              })),
            };
          });
        } catch (err) {
          console.warn(`[backfill] batch starting at ${i} failed:`, err);
        }
        if (i + BATCH < ids.length) {
          await new Promise((r) => setTimeout(r, DELAY_MS));
        }
      }
      console.info(`[backfill] filled metadata for up to ${ids.length} entries`);
    } catch (err) {
      console.warn('[backfill] failed:', err);
    }
  };

  /** Batches collection entries through AniList's id-lookup endpoint and
   *  rewrites their `tags` with the full list. Idempotent — every successful
   *  enrichment also flips `tagsFull: true` so the entry is skipped next time. */
  const enrichCollectionTags = async (entries: CollectionEntry[]) => {
    const BATCH = 30;
    const DELAY_MS = 800;
    try {
      const [{ getAnimesByIds }, { toDiscoverItem }] = await Promise.all([
        import('@/lib/anilist'),
        import('@/lib/discover'),
      ]);
      for (let i = 0; i < entries.length; i += BATCH) {
        const chunk = entries.slice(i, i + BATCH);
        const ids = chunk.map((e) => e.anilistId);
        try {
          const media = await getAnimesByIds(ids);
          rememberFromMedia(media);
          const byId = new Map(media.map((m) => [m.id, m]));
          setCollection((prev) =>
            prev.map((c) => {
              const m = byId.get(c.anilistId);
              if (!m) return c;
              const fresh = toDiscoverItem(m);
              return { ...c, tags: fresh.tags, tagsFull: true };
            }),
          );
        } catch (err) {
          console.warn(
            `[enrich] batch starting at ${i} failed:`,
            err,
          );
        }
        if (i + BATCH < entries.length) {
          await new Promise((r) => setTimeout(r, DELAY_MS));
        }
      }
      console.info(
        `[enrich] tag-enriched ${entries.length} collection entr${entries.length === 1 ? 'y' : 'ies'}`,
      );
    } catch (err) {
      console.warn('[enrich] tag enrichment failed:', err);
    }
  };

  // Browser history: every page switch and every detail page is one entry
  // holding { view, detail, scroll }, so Back / Forward (and the detail
  // page's own Back) always land on the page you were really on, at the
  // scroll position you left it.
  useEffect(() => {
    window.history.replaceState({ view: 'schedule', detail: null, idx: 0 } satisfies NavEntry, '');
    const onPop = (e: PopStateEvent) => {
      const entry = e.state as NavEntry | null;
      if (!entry || typeof entry.idx !== 'number') return;
      navIdx.current = entry.idx;
      setView(entry.view);
      setDetailId(entry.detail);
      requestAnimationFrame(() => window.scrollTo(0, entry.scroll ?? 0));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (nextView: AppView, nextDetail: number | null) => {
    // Remember where we were on the entry we're leaving.
    const current = window.history.state as NavEntry | null;
    if (current && typeof current.idx === 'number') {
      window.history.replaceState({ ...current, scroll: window.scrollY }, '');
    }
    navIdx.current += 1;
    window.history.pushState({ view: nextView, detail: nextDetail, idx: navIdx.current } satisfies NavEntry, '');
    setView(nextView);
    setDetailId(nextDetail);
    window.scrollTo(0, 0);
  };

  const openDetail = (anilistId: number) => {
    if (anilistId <= 0 || anilistId === detailId) return;
    navigate(view, anilistId);
  };

  /** Detail page's Back: one step back in history, or (when the detail is
   *  the first thing in this app's history, e.g. after a reload) just close it. */
  const closeDetail = () => {
    if (navIdx.current > 0) {
      window.history.back();
    } else {
      window.history.replaceState({ view, detail: null, idx: 0 } satisfies NavEntry, '');
      setDetailId(null);
    }
  };

  useEffect(() => {
    if (!hydrated || !state) return;
    saveState(state);
  }, [state, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveCollection(collection);
  }, [collection, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveDiscoverCache(discoverCache);
  }, [discoverCache, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveHFavorites(hFavorites);
  }, [hFavorites, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveStreamLinks(streamLinks);
  }, [streamLinks, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveAnilistLinks(anilistLinks);
  }, [anilistLinks, hydrated]);

  const activeSeason: Season | null = useMemo(() => {
    if (!state) return null;
    return state.seasons.find((s) => s.id === state.activeSeasonId) ?? state.seasons[0] ?? null;
  }, [state]);

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-500 text-sm">
        Loading…
      </div>
    );
  }

  const handleCreateSeason = (name: string) => {
    setState((prev) => {
      if (!prev) return prev;
      const id = newId();
      const next: Season = { id, name, createdAt: Date.now(), animes: [] };
      return { seasons: [...prev.seasons, next], activeSeasonId: id };
    });
  };

  const handleDeleteSeasons = (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setState((prev) => {
      if (!prev) return prev;
      const remaining = prev.seasons.filter((s) => !idSet.has(s.id));
      return {
        seasons: remaining,
        activeSeasonId:
          prev.activeSeasonId && idSet.has(prev.activeSeasonId)
            ? (remaining[0]?.id ?? null)
            : prev.activeSeasonId,
      };
    });
  };

  /** Switches page (header, page tabs), closing any open detail page. */
  const goTo = (next: AppView) => {
    if (next === view && detailId === null) return;
    navigate(next, null);
  };

  const handleSelectSeason = (id: string) => {
    setState((prev) => (prev ? { ...prev, activeSeasonId: id } : prev));
    goTo('schedule');
  };

  /** Jumps to the schedule view, switching to the calendar's current season
   *  (e.g. "Spring 2026") if one exists in the tracker. */
  const handleJumpHome = () => {
    goTo('schedule');
    setState((prev) => {
      if (!prev) return prev;
      const target = prev.seasons.find(
        (s) => s.name.trim().toLowerCase() === discoverDefaultRef.name.toLowerCase(),
      );
      if (target && target.id !== prev.activeSeasonId) {
        return { ...prev, activeSeasonId: target.id };
      }
      return prev;
    });
  };

  /** Adds an item to the named tracker season; creates the season if missing. */
  const addItemToNamedSeason = (item: DiscoverItem, seasonName: string) => {
    setState((prev) => {
      if (!prev) return prev;
      const existing = prev.seasons.find((s) => s.name === seasonName);
      let seasons = prev.seasons;
      let targetId: string;
      if (!existing) {
        const created: Season = {
          id: newId(),
          name: seasonName,
          createdAt: Date.now(),
          animes: [],
        };
        seasons = [...prev.seasons, created];
        targetId = created.id;
      } else {
        targetId = existing.id;
        if (existing.animes.some((a) => a.anilistId === item.anilistId)) return prev;
      }
      // Sibling lookup: most-recently-added entry with the same AniList ID
      // across all seasons. Used to prefill airing-slot fields so adding a
      // new cour of a split-cour show doesn't make you retype day/time/
      // platform/note. Sibling wins over AniList-derived defaults because
      // the user's manual choices on a prior cour are more authoritative
      // than what AniList currently reports.
      const sibling =
        item.anilistId > 0
          ? prev.seasons
              .flatMap((s) => s.animes)
              .filter((a) => a.anilistId === item.anilistId)
              .sort((a, b) => b.addedAt - a.addedAt)[0]
          : undefined;
      // Prefer airing-based derivation (gives both day + time). Fall back to
      // startDate for finished shows so we still slot the card into the right
      // weekday column even if AniList no longer reports a future airing.
      const fromAiring = deriveDayTimeFromAiringAt(item.nextAiringAt);
      const derivedDay = fromAiring?.day ?? deriveDayFromStartDate(item.startDate);
      const derivedTime = fromAiring?.time;
      const entry: AnimeEntry = {
        id: newId(),
        anilistId: item.anilistId,
        title: item.title,
        titleEnglish: item.titleEnglish,
        imageUrl: item.imageUrl,
        day: sibling?.day ?? derivedDay ?? null,
        time: sibling?.time || derivedTime || '',
        platform: sibling?.platform ?? '',
        platformUrl: sibling?.platformUrl ?? '',
        status: sibling?.status ?? '',
        // Continuing title (e.g. a split-cour show getting its next season
        // added): inherit the watch progress already tracked on the
        // sibling instead of starting back at 0/untracked. New, unrelated
        // titles have no sibling so this stays undefined as before.
        watchStatus: sibling?.watchStatus,
        episodesWatched: sibling?.episodesWatched,
        // Capture the AniList episode count so the schedule card's progress
        // widget has a denominator.
        totalEpisodes: sibling?.totalEpisodes ?? item.episodes,
        // Airing data for the "ep N aired / X behind" indicator.
        nextAiringEpisode: item.nextAiringEpisode,
        nextAiringAt: item.nextAiringAt,
        // Format drives the schedule's Movies-vs-rest grouping.
        format: item.format,
        addedAt: Date.now(),
      };
      return {
        ...prev,
        seasons: seasons.map((s) =>
          s.id === targetId ? { ...s, animes: [...s.animes, entry] } : s,
        ),
        activeSeasonId: prev.activeSeasonId ?? targetId,
      };
    });
  };

  const isInNamedSeason = (anilistId: number, seasonName: string): boolean => {
    if (!state) return false;
    const target = state.seasons.find((s) => s.name === seasonName);
    return target ? target.animes.some((a) => a.anilistId === anilistId) : false;
  };

  const activeDiscoverVariant: DiscoverVariant | null =
    view === 'discover-season'
      ? 'season'
      : view === 'discover-h' || view === 'h-favorites'
        ? 'h'
        : view === 'collection-favorites' || view === 'collection-interested'
          ? 'collection'
          : null;

  // ---- H favorites (separate DB table) -------------------------------
  const hFavIds = new Set(hFavorites.map((h) => h.anilistId));
  const isHFavorited = (anilistId: number) =>
    anilistId > 0 && hFavIds.has(anilistId);

  const addHFavorite = (item: DiscoverItem) => {
    setHFavorites((prev) => {
      if (prev.some((h) => h.anilistId === item.anilistId)) return prev;
      return [...prev, { ...item, addedAt: Date.now() }];
    });
  };

  const removeHFavorite = (anilistId: number) => {
    setHFavorites((prev) => prev.filter((h) => h.anilistId !== anilistId));
  };

  // ---- Collection (favorites + interested) ----
  // Don't useMemo: this block sits after `if (!state) return` so adding hooks
  // here would violate the rule-of-hooks. Tiny computations, fine to inline.
  const favoritedIds = new Set(
    collection.filter((c) => c.section === 'favorites').map((c) => c.anilistId),
  );
  const interestedIds = new Set(
    collection.filter((c) => c.section === 'interested').map((c) => c.anilistId),
  );

  const isFavorited = (anilistId: number) =>
    anilistId > 0 && favoritedIds.has(anilistId);
  const isInterested = (anilistId: number) =>
    anilistId > 0 && interestedIds.has(anilistId);

  // Progress bridge. Build a flat map of anilistId →
  // {watchStatus, episodesWatched, totalEpisodes} so the Collection page can
  // surface — and edit — progress for everything. Two sources, in priority:
  //   1. Schedule AnimeEntry rows (the canonical source when present)
  //   2. CollectionEntry's own stored progress (for items NOT on any schedule)
  // The handler below writes to both sources so they stay in sync no matter
  // which side an edit comes from.
  const scheduleProgress = new Map<number, ScheduleProgress>();
  for (const s of state.seasons) {
    for (const a of s.animes) {
      if (a.anilistId <= 0 || scheduleProgress.has(a.anilistId)) continue;
      scheduleProgress.set(a.anilistId, {
        watchStatus: a.watchStatus,
        episodesWatched: a.episodesWatched,
        totalEpisodes: a.totalEpisodes,
      });
    }
  }
  // Collection-only fill-in. `episodes` on CollectionEntry is AniList's
  // episode count — use it as the total since CollectionEntry doesn't
  // carry a separate totalEpisodes field.
  for (const c of collection) {
    if (c.anilistId <= 0 || scheduleProgress.has(c.anilistId)) continue;
    scheduleProgress.set(c.anilistId, {
      watchStatus: c.watchStatus,
      episodesWatched: c.episodesWatched,
      totalEpisodes: c.episodes,
    });
  }

  /** Set (or clear) your personal 1–5 score for a collection item. Applied
   *  to every collection row sharing the anilistId — so a show that's in
   *  both Favorites and Interested keeps a single, consistent rating. */
  const handleSetUserScore = (anilistId: number, score: number | null) => {
    if (anilistId <= 0) return;
    setCollection((prev) =>
      prev.map((c) =>
        c.anilistId === anilistId
          ? { ...c, userScore: score == null ? undefined : score }
          : c,
      ),
    );
  };

  /** Broadcast a progress update to EVERY entry sharing this anilistId — both
   *  schedule rows (across all seasons) and collection rows (favorites +
   *  interested). Lets the Collection +/- and status pill drive the same
   *  state the Schedule reads from, and vice-versa. */
  const handleUpdateProgressByAnilistId = (
    anilistId: number,
    next: ScheduleProgress,
  ) => {
    if (anilistId <= 0) return;
    setState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        seasons: prev.seasons.map((s) => ({
          ...s,
          animes: s.animes.map((a) =>
            a.anilistId === anilistId
              ? {
                  ...a,
                  watchStatus: next.watchStatus,
                  episodesWatched: next.episodesWatched,
                  totalEpisodes: next.totalEpisodes ?? a.totalEpisodes,
                }
              : a,
          ),
        })),
      };
    });
    setCollection((prev) =>
      prev.map((c) =>
        c.anilistId === anilistId
          ? {
              ...c,
              watchStatus: next.watchStatus,
              episodesWatched: next.episodesWatched,
              // `episodes` (the AniList total) stays as-is — totalEpisodes
              // from the update is for the schedule's mutable cache only.
            }
          : c,
      ),
    );
  };

  // Streaming links per show: the saved list, plus any single platform URL
  // still sitting on a schedule row (xlsx / JSON imports bring those in) that
  // isn't in the list yet. Editing a show's links saves the merged list and
  // clears those row fields, so a removed link stays removed.
  const linksByShow = new Map<number, StreamLink[]>();
  for (const [id, links] of Object.entries(streamLinks)) {
    if (links.length > 0) linksByShow.set(Number(id), links);
  }
  const anilistLinksByShow = new Map<number, StreamLink[]>();
  for (const [id, v] of Object.entries(anilistLinks)) {
    if (v.links.length > 0) anilistLinksByShow.set(Number(id), v.links);
  }
  const brandIndex = buildBrandIndex(linkSources?.sources ?? [], [...anilistLinksByShow.values()].flat());
  for (const a of state.seasons.flatMap((s) => s.animes)) {
    const url = a.platformUrl?.trim();
    if (a.anilistId <= 0 || !url) continue;
    const list = linksByShow.get(a.anilistId) ?? [];
    if (!list.some((l) => l.url.trim() === url)) {
      linksByShow.set(a.anilistId, [...list, { ...entryLink(a)[0], url }]);
    }
  }

  const setLinks = (anilistId: number, links: StreamLink[]) => {
    if (anilistId <= 0) return;
    setStreamLinks((prev) => {
      const next = { ...prev };
      if (links.length > 0) next[anilistId] = links;
      else delete next[anilistId];
      return next;
    });
    setState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        seasons: prev.seasons.map((s) => ({
          ...s,
          animes: s.animes.map((a) =>
            a.anilistId === anilistId && (a.platform || a.platformUrl)
              ? { ...a, platform: '', platformUrl: '' }
              : a,
          ),
        })),
      };
    });
  };

  /** Saved links for the given shows, for a JSON backup. */
  const linksFor = (ids: number[]): StreamLinksMap => {
    const out: StreamLinksMap = {};
    for (const id of new Set(ids)) {
      const links = linksByShow.get(id);
      if (id > 0 && links && links.length > 0) out[id] = links;
    }
    return out;
  };

  /** A JSON restore replaces the links of every show in the backup (the
   *  backup wins, like the restored entries themselves). */
  const restoreBackupLinks = (map: StreamLinksMap) => {
    if (Object.keys(map).length === 0) return;
    setStreamLinks((prev) => ({ ...prev, ...map }));
  };

  /** xlsx / JSON exports still carry one link per row: fill a bound row's
   *  platform columns from the show's first saved link. */
  const seasonsForExport = (): Season[] =>
    state.seasons.map((s) => ({
      ...s,
      animes: s.animes.map((a) => {
        const first = a.anilistId > 0 ? linksByShow.get(a.anilistId)?.[0] : undefined;
        return first && !a.platformUrl ? { ...a, platform: first.site, platformUrl: first.url } : a;
      }),
    }));

  // Watchlist: everything whose (synced) status is Watching, from any
  // schedule season or the collection, one row per AniList id.
  const watchItems: WatchItem[] = [];
  const watchSeen = new Set<number>();
  const allScheduleEntries = state.seasons
    .flatMap((s) => s.animes)
    .sort((a, b) => b.addedAt - a.addedAt);
  for (const a of allScheduleEntries) {
    if (a.anilistId <= 0 || watchSeen.has(a.anilistId)) continue;
    if (scheduleProgress.get(a.anilistId)?.watchStatus !== 'WATCHING') continue;
    watchSeen.add(a.anilistId);
    watchItems.push({
      anilistId: a.anilistId,
      title: a.title,
      titleEnglish: a.titleEnglish,
      imageUrl: a.imageUrl,
      totalEpisodes: a.totalEpisodes,
      nextAiringEpisode: a.nextAiringEpisode,
      nextAiringAt: a.nextAiringAt,
    });
  }
  for (const c of collection) {
    if (c.anilistId <= 0 || watchSeen.has(c.anilistId)) continue;
    if (scheduleProgress.get(c.anilistId)?.watchStatus !== 'WATCHING') continue;
    watchSeen.add(c.anilistId);
    watchItems.push({
      anilistId: c.anilistId,
      title: c.title,
      titleEnglish: c.titleEnglish,
      imageUrl: c.imageUrl,
      totalEpisodes: c.episodes,
      nextAiringEpisode: c.nextAiringEpisode,
      nextAiringAt: c.nextAiringAt,
    });
  }

  const addToCollection = (item: DiscoverItem, section: CollectionSection) => {
    setCollection((prev) => {
      const others = prev.filter(
        (c) => !(c.anilistId === item.anilistId && c.section === section),
      );
      // If item is already in the other section, move it (a show can be in
      // both sections — they're independent lists — so we don't remove from
      // the other). Just add to this section.
      return [
        ...others,
        // tagsFull=true when the item already came in with its tag list (from
        // a discover card or the add-modal search). Bare-entry adds from a
        // schedule card heart toggle will be enriched below and re-flagged.
        { ...item, section, addedAt: Date.now(), tagsFull: item.tags.length > 0 },
      ];
    });
    // Async enrichment for entries added without full data (e.g. from schedule
    // card toggle, which only has the bare entry). Skips if we already have
    // a startDate to avoid an unnecessary roundtrip.
    if (!item.startDate || !item.tags.length) {
      (async () => {
        try {
          const { getAnimeById } = await import('@/lib/anilist');
          const { toDiscoverItem } = await import('@/lib/discover');
          const m = await getAnimeById(item.anilistId);
          if (!m) return;
          const enriched = toDiscoverItem(m);
          setCollection((prev) =>
            prev.map((c) =>
              c.anilistId === item.anilistId && c.section === section
                ? { ...c, ...enriched, section, addedAt: c.addedAt, tagsFull: true }
                : c,
            ),
          );
        } catch (err) {
          console.warn('Failed to enrich collection entry', err);
        }
      })();
    }
  };

  const removeFromCollection = (anilistId: number, section: CollectionSection) => {
    setCollection((prev) =>
      prev.filter((c) => !(c.anilistId === anilistId && c.section === section)),
    );
  };

  const toggleFavoriteFromSchedule = (entry: AnimeEntry) => {
    if (entry.anilistId <= 0) return;
    if (favoritedIds.has(entry.anilistId)) {
      removeFromCollection(entry.anilistId, 'favorites');
    } else {
      addToCollection(
        {
          anilistId: entry.anilistId,
          title: entry.title,
          titleEnglish: entry.titleEnglish,
          imageUrl: entry.imageUrl,
          tags: [],
        },
        'favorites',
      );
    }
  };

  const toggleInterestedFromSchedule = (entry: AnimeEntry) => {
    if (entry.anilistId <= 0) return;
    if (interestedIds.has(entry.anilistId)) {
      removeFromCollection(entry.anilistId, 'interested');
    } else {
      addToCollection(
        {
          anilistId: entry.anilistId,
          title: entry.title,
          titleEnglish: entry.titleEnglish,
          imageUrl: entry.imageUrl,
          tags: [],
        },
        'interested',
      );
    }
  };

  const toggleFavoriteFromDiscover = (item: DiscoverItem) => {
    if (favoritedIds.has(item.anilistId)) {
      removeFromCollection(item.anilistId, 'favorites');
    } else {
      addToCollection(item, 'favorites');
    }
  };

  const toggleInterestedFromDiscover = (item: DiscoverItem) => {
    if (interestedIds.has(item.anilistId)) {
      removeFromCollection(item.anilistId, 'interested');
    } else {
      addToCollection(item, 'interested');
    }
  };

  const handleSaveAnime = (entry: AnimeEntry) => {
    setState((prev) => {
      if (!prev || !activeSeason) return prev;
      // An edit updates the entry in whichever season holds it (the
      // Watchlist can edit shows from any season); a new entry goes into the
      // active season.
      const exists = prev.seasons.some((s) => s.animes.some((a) => a.id === entry.id));
      return {
        ...prev,
        seasons: prev.seasons.map((s) => {
          if (exists) {
            return s.animes.some((a) => a.id === entry.id)
              ? { ...s, animes: s.animes.map((a) => (a.id === entry.id ? entry : a)) }
              : s;
          }
          return s.id === activeSeason.id ? { ...s, animes: [...s.animes, entry] } : s;
        }),
      };
    });
  };

  /** Most recently added schedule entry for a show, if it's on any season. */
  const latestScheduleEntry = (anilistId: number): AnimeEntry | undefined =>
    state.seasons
      .flatMap((s) => s.animes)
      .filter((a) => a.anilistId === anilistId)
      .sort((a, b) => b.addedAt - a.addedAt)[0];

  /** Inline-edit path from the schedule card (progress +/-, status pill).
   *  Same shape as handleSaveAnime's update branch, but doesn't append on a
   *  miss — if the entry isn't already in the active season, this is a no-op.
   *
   *  When the updated entry has anilist_id > 0, the watch fields
   *  (watchStatus / episodesWatched / totalEpisodes / nextAiringEpisode /
   *  nextAiringAt) are broadcast to every other entry across every season
   *  sharing that anilist_id. This keeps React state consistent with the
   *  anime_progress table in the DB — a split-cour show appearing in both
   *  Fall 2025 and Winter 2026 should reflect the same watched count
   *  immediately, not only after a page refresh. */
  const handleUpdateAnime = (entry: AnimeEntry) => {
    setState((prev) => {
      if (!prev || !activeSeason) return prev;
      const broadcastTo = entry.anilistId > 0 ? entry.anilistId : null;
      return {
        ...prev,
        seasons: prev.seasons.map((s) => ({
          ...s,
          animes: s.animes.map((a) => {
            // The edited entry itself: full replace.
            if (a.id === entry.id) return entry;
            // Siblings (same AniList ID, different schedule rows): keep
            // their per-entry fields (day, time, platform, note) but
            // adopt the updated watch progress.
            if (broadcastTo != null && a.anilistId === broadcastTo) {
              return {
                ...a,
                watchStatus: entry.watchStatus,
                episodesWatched: entry.episodesWatched,
                totalEpisodes: entry.totalEpisodes,
                nextAiringEpisode: entry.nextAiringEpisode,
                nextAiringAt: entry.nextAiringAt,
              };
            }
            return a;
          }),
        })),
      };
    });
  };

  const handleDeleteAnime = (id: string) => {
    setState((prev) => {
      if (!prev || !activeSeason) return prev;
      return {
        ...prev,
        seasons: prev.seasons.map((s) =>
          s.id === activeSeason.id ? { ...s, animes: s.animes.filter((a) => a.id !== id) } : s,
        ),
      };
    });
  };

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const handleExport = async () => {
    if (!state || state.seasons.length === 0 || exporting) return;
    setExporting(true);
    try {
      const { exportWorkbook } = await import('@/lib/export');
      await exportWorkbook(seasonsForExport());
    } catch (err) {
      console.error('Export failed', err);
      await confirm({
        title: 'Export failed',
        message: 'Something went wrong while exporting. See the browser console for details.',
        alert: true,
        kind: 'danger',
      });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (file: File) => {
    if (importing) return;
    setImporting(true);
    setImportProgress({ phase: 'parsing', matched: 0, total: 0 });
    try {
      const { importWorkbook } = await import('@/lib/import');
      const { seasons: imported, summary } = await importWorkbook(file, (p) =>
        setImportProgress(p),
      );
      if (imported.length === 0) {
        await confirm({
          title: 'Nothing to import',
          message: 'No anime found in that file.',
          alert: true,
          kind: 'warning',
        });
        return;
      }

      let mergedAdds = 0;
      let mergedSkipped = 0;
      setState((prev) => {
        if (!prev) return prev;
        let mergedSeasons = [...prev.seasons];
        for (const importSeason of imported) {
          const existingIdx = mergedSeasons.findIndex(
            (s) => s.name.toLowerCase() === importSeason.name.toLowerCase(),
          );
          if (existingIdx === -1) {
            // Brand new season → add it as-is.
            mergedSeasons.push(importSeason);
            mergedAdds += importSeason.animes.length;
          } else {
            // Merge into existing season. Dedupe by anilistId (>0) first, then
            // by case-insensitive title fallback for unbound entries.
            const target = mergedSeasons[existingIdx];
            const existingKeys = new Set(
              target.animes.map((a) =>
                a.anilistId > 0 ? `id:${a.anilistId}` : `t:${a.title.trim().toLowerCase()}`,
              ),
            );
            const toAdd = importSeason.animes.filter((a) => {
              const k =
                a.anilistId > 0
                  ? `id:${a.anilistId}`
                  : `t:${a.title.trim().toLowerCase()}`;
              if (existingKeys.has(k)) {
                mergedSkipped++;
                return false;
              }
              existingKeys.add(k);
              mergedAdds++;
              return true;
            });
            mergedSeasons = mergedSeasons.map((s, i) =>
              i === existingIdx ? { ...s, animes: [...s.animes, ...toAdd] } : s,
            );
          }
        }
        return {
          seasons: mergedSeasons,
          activeSeasonId: prev.activeSeasonId ?? mergedSeasons[0]?.id ?? null,
        };
      });

      const unmatched = summary.animesImported - summary.animesMatchedOnAniList;
      await confirm({
        title: 'Import complete',
        message:
          `Imported ${summary.seasonsImported} season(s), ${summary.animesImported} anime.\n` +
          `Added ${mergedAdds}` +
          (mergedSkipped > 0 ? `, skipped ${mergedSkipped} duplicate(s)` : '') +
          `.\n${summary.animesMatchedOnAniList} matched on AniList` +
          (unmatched > 0 ? ` · ${unmatched} kept original title (no match)` : '') +
          '.',
        alert: true,
      });
    } catch (err) {
      console.error('Import failed', err);
      await confirm({
        title: 'Import failed',
        message:
          'The file may not match the expected format. See the browser console for details.',
        alert: true,
        kind: 'danger',
      });
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  /** Restore from a `.json` schedule backup. Differs from xlsx import:
   *  matches by anilistId (or trimmed lowercase title) → REPLACES the
   *  existing entry instead of skipping it. Brand-new seasons / entries are
   *  appended. Nothing is deleted. */
  const handleScheduleJsonImport = async (file: File) => {
    if (importing) return;
    setImporting(true);
    try {
      const { importScheduleJson, readBackupLinks, JsonImportError } = await import('@/lib/import');
      let imported: Season[];
      try {
        imported = await importScheduleJson(file);
        restoreBackupLinks(await readBackupLinks(file));
      } catch (err) {
        if (err instanceof JsonImportError) {
          await confirm({
            title: 'Import failed',
            message: err.message,
            alert: true,
            kind: 'danger',
          });
          return;
        }
        throw err;
      }
      if (imported.length === 0) {
        await confirm({
          title: 'Nothing to import',
          message: 'The backup contained no seasons.',
          alert: true,
          kind: 'warning',
        });
        return;
      }
      let added = 0;
      let updated = 0;
      setState((prev) => {
        if (!prev) return prev;
        let mergedSeasons = [...prev.seasons];
        for (const importSeason of imported) {
          const existingIdx = mergedSeasons.findIndex(
            (s) => s.name.toLowerCase() === importSeason.name.toLowerCase(),
          );
          if (existingIdx === -1) {
            mergedSeasons.push(importSeason);
            added += importSeason.animes.length;
            continue;
          }
          const target = mergedSeasons[existingIdx];
          const keyOf = (a: AnimeEntry) =>
            a.anilistId > 0
              ? `id:${a.anilistId}`
              : `t:${a.title.trim().toLowerCase()}`;
          const byKey = new Map<string, AnimeEntry>();
          for (const a of target.animes) byKey.set(keyOf(a), a);
          for (const a of importSeason.animes) {
            const k = keyOf(a);
            if (byKey.has(k)) {
              // Replace — keep the existing id so other references stay
              // stable, but adopt every other field from the backup.
              const old = byKey.get(k)!;
              byKey.set(k, { ...a, id: old.id });
              updated++;
            } else {
              byKey.set(k, a);
              added++;
            }
          }
          mergedSeasons = mergedSeasons.map((s, i) =>
            i === existingIdx ? { ...s, animes: Array.from(byKey.values()) } : s,
          );
        }
        return {
          seasons: mergedSeasons,
          activeSeasonId: prev.activeSeasonId ?? mergedSeasons[0]?.id ?? null,
        };
      });
      await confirm({
        title: 'Schedule restored',
        message: `Added ${added} entr${added === 1 ? 'y' : 'ies'}${
          updated > 0 ? ` · updated ${updated}` : ''
        }.`,
        alert: true,
      });
    } catch (err) {
      console.error('Schedule JSON import failed', err);
      await confirm({
        title: 'Import failed',
        message: 'See the browser console for details.',
        alert: true,
        kind: 'danger',
      });
    } finally {
      setImporting(false);
    }
  };

  const handleScheduleJsonExport = async () => {
    if (!state) return;
    const { exportScheduleJson } = await import('@/lib/export');
    exportScheduleJson(seasonsForExport(), linksFor(state.seasons.flatMap((s) => s.animes.map((a) => a.anilistId))));
  };

  // Collection import — merges into the existing collection by (anilistId, section)
  const handleCollectionImport = async (file: File) => {
    if (importingCollection) return;
    setImportingCollection(true);
    try {
      const { importCollection } = await import('@/lib/import');
      const imported = await importCollection(file);
      if (imported.length === 0) {
        await confirm({
          title: 'Nothing to import',
          message:
            "Couldn't find any rows under sheets named 'Favorites' or 'Interested'.",
          alert: true,
          kind: 'warning',
        });
        return;
      }
      let added = 0;
      let skipped = 0;
      setCollection((prev) => {
        const seen = new Set(prev.map((c) => `${c.anilistId}:${c.section}`));
        const merged = [...prev];
        for (const e of imported) {
          const key = `${e.anilistId}:${e.section}`;
          if (seen.has(key)) {
            skipped++;
            continue;
          }
          seen.add(key);
          merged.push(e);
          added++;
        }
        return merged;
      });
      await confirm({
        title: 'Collection import complete',
        message: `Added ${added} entr${added === 1 ? 'y' : 'ies'}${skipped > 0 ? ` · skipped ${skipped} duplicate(s)` : ''}.`,
        alert: true,
      });
    } catch (err) {
      console.error('Collection import failed', err);
      await confirm({
        title: 'Collection import failed',
        message:
          'The file may not match the expected format. See the browser console for details.',
        alert: true,
        kind: 'danger',
      });
    } finally {
      setImportingCollection(false);
    }
  };

  /** Restore from a `.json` collection backup. Merge by (anilistId, section);
   *  matched entries are REPLACED (so a backup beats whatever's in memory),
   *  new entries are appended. Nothing is deleted. */
  const handleCollectionJsonImport = async (file: File) => {
    if (importingCollection) return;
    setImportingCollection(true);
    try {
      const { importCollectionJson, readBackupLinks, JsonImportError } = await import(
        '@/lib/import'
      );
      let imported: CollectionEntry[];
      try {
        imported = await importCollectionJson(file);
        restoreBackupLinks(await readBackupLinks(file));
      } catch (err) {
        if (err instanceof JsonImportError) {
          await confirm({
            title: 'Import failed',
            message: err.message,
            alert: true,
            kind: 'danger',
          });
          return;
        }
        throw err;
      }
      if (imported.length === 0) {
        await confirm({
          title: 'Nothing to import',
          message: 'The backup contained no collection entries.',
          alert: true,
          kind: 'warning',
        });
        return;
      }
      let added = 0;
      let updated = 0;
      setCollection((prev) => {
        const byKey = new Map<string, CollectionEntry>();
        for (const c of prev) byKey.set(`${c.anilistId}:${c.section}`, c);
        for (const e of imported) {
          const k = `${e.anilistId}:${e.section}`;
          if (byKey.has(k)) {
            byKey.set(k, e);
            updated++;
          } else {
            byKey.set(k, e);
            added++;
          }
        }
        return Array.from(byKey.values());
      });
      await confirm({
        title: 'Collection restored',
        message: `Added ${added} entr${added === 1 ? 'y' : 'ies'}${
          updated > 0 ? ` · updated ${updated}` : ''
        }.`,
        alert: true,
      });
    } catch (err) {
      console.error('Collection JSON import failed', err);
      await confirm({
        title: 'Import failed',
        message: 'See the browser console for details.',
        alert: true,
        kind: 'danger',
      });
    } finally {
      setImportingCollection(false);
    }
  };

  const handleCollectionJsonExport = async () => {
    const { exportCollectionJson } = await import('@/lib/export');
    exportCollectionJson(collection, linksFor(collection.map((c) => c.anilistId)));
  };

  return (
    <NavProvider
      value={{
        openDetail,
        ownLinksByShow: linksByShow,
        anilistLinksByShow,
        setLinks,
        rememberAnilistLinks,
        brandFor: (link) => brandFor(brandIndex, link),
      }}
    >
    <div className="min-h-screen">
      <SeasonSelector
        seasons={state.seasons}
        activeSeasonId={activeSeason?.id ?? null}
        onSelect={handleSelectSeason}
        onCreate={handleCreateSeason}
        onManage={() => setManageOpen(true)}
        onJumpHome={handleJumpHome}
        onDiscover={(variant) => {
          goTo(
            variant === 'season'
              ? 'discover-season'
              : variant === 'h'
                ? 'discover-h'
                : 'collection-favorites',
          );
        }}
        activeDiscoverVariant={detailId !== null ? null : activeDiscoverVariant}
        isScheduleActive={detailId === null && view === 'schedule'}
        onWatchlist={() => goTo('watchlist')}
        isWatchlistActive={detailId === null && view === 'watchlist'}
      />

      {detailId !== null && (
        <AnimeDetailPage
          key={detailId}
          anilistId={detailId}
          onBack={closeDetail}
          progress={scheduleProgress.get(detailId)}
          tracked={
            state.seasons.some((s) => s.animes.some((a) => a.anilistId === detailId)) ||
            collection.some((c) => c.anilistId === detailId)
          }
          onUpdateProgress={(next) => handleUpdateProgressByAnilistId(detailId, next)}
          isAddedTo={isInNamedSeason}
          onAdd={addItemToNamedSeason}
          favorited={isFavorited(detailId)}
          interested={isInterested(detailId)}
          onToggleFavorite={toggleFavoriteFromDiscover}
          onToggleInterested={toggleInterestedFromDiscover}
        />
      )}

      <div className={detailId !== null ? 'hidden' : undefined}>
      {view === 'watchlist' ? (
        <WatchlistPage
          items={watchItems}
          progressOf={(id) => scheduleProgress.get(id)}
          onUpdateProgress={handleUpdateProgressByAnilistId}
          isFavorited={isFavorited}
          onToggleFavorite={toggleFavoriteFromDiscover}
          onExplore={() => goTo('discover-season')}
          canEdit={(id) => latestScheduleEntry(id) !== undefined}
          onEdit={(id) => {
            const entry = latestScheduleEntry(id);
            if (!entry) return;
            setEditing(entry);
            setModalOpen(true);
          }}
        />
      ) : view === 'discover-season' ? (
        <DiscoverPage
          defaultRef={discoverDefaultRef}
          isAddedTo={isInNamedSeason}
          onAdd={addItemToNamedSeason}
          isFavorited={isFavorited}
          isInterested={isInterested}
          onToggleFavorite={toggleFavoriteFromDiscover}
          onToggleInterested={toggleInterestedFromDiscover}
          cacheEntries={discoverCache.entries}
          onCacheUpdate={(entry: DiscoverCacheEntry) => {
            rememberFromItems(entry.items);
            setDiscoverCache((prev) => {
              // Drop any prior entry for the same season/year/tags, prepend
              // the new one, cap the array at 4 (LRU eviction).
              const others = prev.entries.filter(
                (e) =>
                  !(
                    e.season === entry.season &&
                    e.year === entry.year &&
                    tagsMatch(e.tags, entry.tags)
                  ),
              );
              return { entries: [entry, ...others].slice(0, 4) };
            });
          }}
        />
      ) : view === 'discover-h' ? (
        <HDiscoverPage
          isFavoritedH={isHFavorited}
          onAddHFavorite={addHFavorite}
          onRemoveHFavorite={removeHFavorite}
          hFavoritesCount={hFavorites.length}
          onOpenFavorites={() => goTo('h-favorites')}
        />
      ) : view === 'h-favorites' ? (
        <HFavoritesPage
          items={hFavorites}
          onRemove={removeHFavorite}
          onBack={() => goTo('discover-h')}
        />
      ) : view === 'collection-favorites' || view === 'collection-interested' ? (
        <CollectionPage
          section={view === 'collection-favorites' ? 'favorites' : 'interested'}
          collection={collection}
          onAdd={addToCollection}
          onRemove={removeFromCollection}
          onSwitchSection={(s) =>
            goTo(s === 'favorites' ? 'collection-favorites' : 'collection-interested')
          }
          onImport={handleCollectionImport}
          onImportJson={handleCollectionJsonImport}
          onExportJson={handleCollectionJsonExport}
          importing={importingCollection}
          progressByAnilistId={scheduleProgress}
          onUpdateProgress={handleUpdateProgressByAnilistId}
          onSetUserScore={handleSetUserScore}
        />
      ) : !activeSeason ? (
        <EmptyState
          title="No seasons yet"
          description="Create your first season from the top bar to get started."
        />
      ) : (
        <ScheduleGrid
          animes={activeSeason.animes}
          seasonName={activeSeason.name}
          // Airing indicator + AniList refresh are gated on this — only the
          // calendar's current season has data worth tracking week-to-week.
          isCurrentSeason={
            activeSeason.name.trim().toLowerCase() ===
            discoverDefaultRef.name.toLowerCase()
          }
          onEdit={(entry) => {
            setEditing(entry);
            setModalOpen(true);
          }}
          onDelete={handleDeleteAnime}
          onUpdate={handleUpdateAnime}
          onAddAnime={openAdd}
          onImport={handleImport}
          onExport={handleExport}
          onImportJson={handleScheduleJsonImport}
          onExportJson={handleScheduleJsonExport}
          onToggleFavorite={toggleFavoriteFromSchedule}
          onToggleInterested={toggleInterestedFromSchedule}
          isFavorited={isFavorited}
          isInterested={isInterested}
          importing={importing}
          exporting={exporting}
        />
      )}
      </div>

      <AddAnimeModal
        open={modalOpen}
        initial={editing}
        // Lookup used by the modal to prefill day/time/platform/platformUrl/
        // status when the user picks a search result whose AniList ID
        // already exists in another season — so adding a new cour doesn't
        // mean retyping the broadcast slot. Returns the most-recently-added
        // sibling so the latest user edits propagate.
        findSiblingForAnilist={(anilistId) => {
          if (!state || anilistId <= 0) return null;
          const matches = state.seasons
            .flatMap((s) => s.animes)
            .filter((a) => a.anilistId === anilistId);
          if (matches.length === 0) return null;
          return matches.sort((a, b) => b.addedAt - a.addedAt)[0];
        }}
        getLinks={(anilistId) => linksByShow.get(anilistId) ?? []}
        onSaveLinks={setLinks}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={handleSaveAnime}
      />

      <ManageSeasonsModal
        open={manageOpen}
        seasons={state.seasons}
        onClose={() => setManageOpen(false)}
        onDeleteMany={handleDeleteSeasons}
      />

      {importProgress && <ImportOverlay progress={importProgress} />}
    </div>
    </NavProvider>
  );
}

function ImportOverlay({ progress }: { progress: ImportProgress }) {
  const pct =
    progress.total > 0 ? Math.round((progress.matched / progress.total) * 100) : 0;
  const label =
    progress.phase === 'parsing'
      ? 'Reading workbook…'
      : progress.phase === 'matching'
        ? `Looking up on AniList… ${progress.matched} / ${progress.total}`
        : 'Finishing up…';

  return (
    <div className={`${DIALOG_BACKDROP} z-50`}>
      <div className={`${DIALOG} p-6 w-full max-w-sm`}>
        <div className="flex items-center gap-3 mb-4">
          <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
          <h2 className="text-sm font-semibold">Importing workbook</h2>
        </div>
        <p className="text-sm text-zinc-300 mb-3">{label}</p>
        <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full bg-indigo-500 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          AniList lookups are rate-limited (10 titles per request, ~1s between
          batches).
        </p>
      </div>
    </div>
  );
}
