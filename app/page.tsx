'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { useConfirm } from '@/components/ConfirmDialog';
import type {
  AnimeEntry,
  AnimeSeason,
  AppState,
  AppView,
  CollectionEntry,
  CollectionSection,
  DiscoverCache,
  DiscoverCacheEntry,
  DiscoverItem,
  DiscoverVariant,
  HFavoriteEntry,
  Season,
} from '@/lib/types';
import type { ImportProgress } from '@/lib/import';
import {
  loadCollection,
  loadDiscoverCache,
  loadHFavorites,
  loadState,
  saveCollection,
  saveDiscoverCache,
  saveHFavorites,
  saveState,
} from '@/lib/storage';
import {
  deriveDayFromStartDate,
  deriveDayTimeFromAiringAt,
  getCurrentAnimeSeasonRef,
  newId,
  tagsMatch,
} from '@/lib/utils';

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

export default function HomePage() {
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
  const [importingCollection, setImportingCollection] = useState(false);
  const confirm = useConfirm();
  // Becomes true once initial load from localStorage has completed. The save
  // effects below gate on this so they don't overwrite stored data with the
  // useState defaults during the brief window before the load commits.
  const [hydrated, setHydrated] = useState(false);

  const discoverDefaultRef = useMemo(() => getCurrentAnimeSeasonRef(), []);

  useEffect(() => {
    (async () => {
      const [loaded, loadedCollection, loadedDiscover, loadedHFavs] =
        await Promise.all([
          loadState(),
          loadCollection(),
          loadDiscoverCache(),
          loadHFavorites(),
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
      setHydrated(true);

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
    })();
    // discoverDefaultRef is memoized once; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Refreshes cached AniList airing data — but only for entries in the
   *  current calendar season. Past seasons are finished (no future airings
   *  to track) and future seasons haven't started, so spending API calls on
   *  them is wasted. The card-side AiringIndicator is gated to the current
   *  season too, so any data we'd fetch outside of it wouldn't be displayed.
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
                    // Backfill totalEpisodes too if it was missing on the entry.
                    totalEpisodes: a.totalEpisodes ?? m.episodes ?? undefined,
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
            a.nextAiringAt == null),
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

  const handleSelectSeason = (id: string) => {
    setState((prev) => (prev ? { ...prev, activeSeasonId: id } : prev));
    setView('schedule');
  };

  /** Jumps to the schedule view, switching to the calendar's current season
   *  (e.g. "Spring 2026") if one exists in the tracker. */
  const handleJumpHome = () => {
    setView('schedule');
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
        day: derivedDay ?? null,
        time: derivedTime ?? '',
        platform: '',
        platformUrl: '',
        status: '',
        // Capture the AniList episode count so the schedule card's progress
        // widget has a denominator. watchStatus/episodesWatched stay undefined
        // until the user actually engages (auto-flips on the first +).
        totalEpisodes: item.episodes,
        // Airing data for the "ep N aired / X behind" indicator.
        nextAiringEpisode: item.nextAiringEpisode,
        nextAiringAt: item.nextAiringAt,
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
      return {
        ...prev,
        seasons: prev.seasons.map((s) => {
          if (s.id !== activeSeason.id) return s;
          const exists = s.animes.some((a) => a.id === entry.id);
          return {
            ...s,
            animes: exists
              ? s.animes.map((a) => (a.id === entry.id ? entry : a))
              : [...s.animes, entry],
          };
        }),
      };
    });
  };

  /** Inline-edit path from the schedule card (progress +/-, status pill).
   *  Same shape as handleSaveAnime's update branch, but doesn't append on a
   *  miss — if the entry isn't already in the active season, this is a no-op. */
  const handleUpdateAnime = (entry: AnimeEntry) => {
    setState((prev) => {
      if (!prev || !activeSeason) return prev;
      return {
        ...prev,
        seasons: prev.seasons.map((s) =>
          s.id !== activeSeason.id
            ? s
            : { ...s, animes: s.animes.map((a) => (a.id === entry.id ? entry : a)) },
        ),
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
      await exportWorkbook(state.seasons);
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

  return (
    <div className="min-h-screen">
      <SeasonSelector
        seasons={state.seasons}
        activeSeasonId={activeSeason?.id ?? null}
        onSelect={handleSelectSeason}
        onCreate={handleCreateSeason}
        onManage={() => setManageOpen(true)}
        onJumpHome={handleJumpHome}
        onDiscover={(variant) => {
          setView(
            variant === 'season'
              ? 'discover-season'
              : variant === 'h'
                ? 'discover-h'
                : 'collection-favorites',
          );
        }}
        activeDiscoverVariant={activeDiscoverVariant}
        isScheduleActive={view === 'schedule'}
      />

      {view === 'discover-season' ? (
        <DiscoverPage
          defaultRef={discoverDefaultRef}
          isAddedTo={isInNamedSeason}
          onAdd={addItemToNamedSeason}
          isFavorited={isFavorited}
          isInterested={isInterested}
          onToggleFavorite={toggleFavoriteFromDiscover}
          onToggleInterested={toggleInterestedFromDiscover}
          cacheEntries={discoverCache.entries}
          onCacheUpdate={(entry: DiscoverCacheEntry) =>
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
            })
          }
        />
      ) : view === 'discover-h' ? (
        <HDiscoverPage
          isFavoritedH={isHFavorited}
          onAddHFavorite={addHFavorite}
          onRemoveHFavorite={removeHFavorite}
          hFavoritesCount={hFavorites.length}
          onOpenFavorites={() => setView('h-favorites')}
        />
      ) : view === 'h-favorites' ? (
        <HFavoritesPage
          items={hFavorites}
          onRemove={removeHFavorite}
          onBack={() => setView('discover-h')}
        />
      ) : view === 'collection-favorites' || view === 'collection-interested' ? (
        <CollectionPage
          section={view === 'collection-favorites' ? 'favorites' : 'interested'}
          collection={collection}
          onAdd={addToCollection}
          onRemove={removeFromCollection}
          onSwitchSection={(s) =>
            setView(s === 'favorites' ? 'collection-favorites' : 'collection-interested')
          }
          onImport={handleCollectionImport}
          importing={importingCollection}
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
          onToggleFavorite={toggleFavoriteFromSchedule}
          onToggleInterested={toggleInterestedFromSchedule}
          isFavorited={isFavorited}
          isInterested={isInterested}
          importing={importing}
          exporting={exporting}
        />
      )}

      <AddAnimeModal
        open={modalOpen}
        initial={editing}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
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
