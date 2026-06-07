import type { AnimeEntry, AnimeSeason, AnimeSeasonRef, DayOfWeek, WatchStatus } from './types';

export const WATCH_STATUSES: WatchStatus[] = [
  'WATCHING',
  'COMPLETED',
  'DROPPED',
  'ON_HOLD',
  'PLAN',
];

export const WATCH_STATUS_LABELS: Record<WatchStatus, string> = {
  WATCHING: 'Watching',
  COMPLETED: 'Completed',
  DROPPED: 'Dropped',
  ON_HOLD: 'On Hold',
  PLAN: 'Plan to Watch',
};

/** Short labels for tight UI spots like filter pills on small viewports. */
export const WATCH_STATUS_SHORT: Record<WatchStatus, string> = {
  WATCHING: 'Watching',
  COMPLETED: 'Completed',
  DROPPED: 'Dropped',
  ON_HOLD: 'Hold',
  PLAN: 'Plan',
};

/** Auto-flip rule on a + click: PLAN/undefined → WATCHING when the very first
 *  episode is logged; WATCHING → COMPLETED when watched reaches total. Shared
 *  by the schedule and collection cards so progress changes behave the same
 *  no matter which view you trigger them from. */
export function nextProgressOnInc(
  watched: number,
  total: number | undefined,
  status: WatchStatus | undefined,
): { episodesWatched: number; watchStatus: WatchStatus | undefined } {
  const next = watched + 1;
  let nextStatus = status;
  if (watched === 0 && (status === undefined || status === 'PLAN')) {
    nextStatus = 'WATCHING';
  }
  if (total != null && next === total) {
    nextStatus = 'COMPLETED';
  }
  return { episodesWatched: next, watchStatus: nextStatus };
}

/** Auto-flip rule on a − click: COMPLETED → WATCHING when watched drops back
 *  below total. Floors at 0. */
export function nextProgressOnDec(
  watched: number,
  total: number | undefined,
  status: WatchStatus | undefined,
): { episodesWatched: number; watchStatus: WatchStatus | undefined } {
  if (watched === 0) return { episodesWatched: 0, watchStatus: status };
  const next = watched - 1;
  let nextStatus = status;
  if (status === 'COMPLETED' && (total == null || next < total)) {
    nextStatus = 'WATCHING';
  }
  return { episodesWatched: next, watchStatus: nextStatus };
}

/** Auto-fill rule when the user picks a status manually: if they mark a show
 *  COMPLETED, snap episodesWatched up to the total (when known) so the
 *  counter matches the new state without an extra click. Going the other
 *  direction (e.g. COMPLETED → WATCHING) doesn't touch episodes — that's
 *  what the − button is for, and users sometimes want to rewatch from N. */
export function nextProgressOnSetStatus(
  nextStatus: WatchStatus | undefined,
  watched: number,
  total: number | undefined,
): { episodesWatched: number; watchStatus: WatchStatus | undefined } {
  if (nextStatus === 'COMPLETED' && total != null && watched < total) {
    return { episodesWatched: total, watchStatus: nextStatus };
  }
  return { episodesWatched: watched, watchStatus: nextStatus };
}

/** Tailwind classes (text + bg + border) tuned to the cyberpunk palette.
 *  ON_HOLD and PLAN share neutral/warm pairs that read intuitively: paused
 *  shows look muted (gray), plan-to-watch reads as warm anticipation (amber). */
export const WATCH_STATUS_CLASS: Record<WatchStatus, string> = {
  WATCHING: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40',
  COMPLETED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  DROPPED: 'bg-red-500/15 text-red-300 border-red-500/40',
  ON_HOLD: 'bg-zinc-700/40 text-zinc-300 border-zinc-600',
  PLAN: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
};

export const DAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

export const PLATFORM_PRESETS = [
  'Netflix',
  'Bilibili',
  'Muse Asia',
  'Crunchyroll',
  'iQIYI',
  'AIS PLAY',
  'Disney+',
  'Prime Video',
  'YouTube',
];

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function getTodayDay(): DayOfWeek {
  const idx = new Date().getDay();
  return DAYS_SUN_FIRST[idx];
}

const DAYS_SUN_FIRST: DayOfWeek[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Anime season convention (industry standard):
 *   Winter: Jan-Mar, Spring: Apr-Jun, Summer: Jul-Sep, Fall: Oct-Dec
 * Year stays as the calendar year — "Winter 2026" means Jan-Mar 2026.
 */
export function getCurrentSeasonName(date: Date = new Date()): string {
  const m = date.getMonth();
  const y = date.getFullYear();
  if (m <= 2) return `Winter ${y}`;
  if (m <= 5) return `Spring ${y}`;
  if (m <= 8) return `Summer ${y}`;
  return `Fall ${y}`;
}

/**
 * Returns how many episodes have aired so far, derived from cached AniList
 * airing data on the entry. Returns null when we have no idea (no cache and
 * no totalEpisodes). The schedule view refreshes stale caches in the
 * background — once `nextAiringAt` slips into the past, that cache only gives
 * a lower bound for "episodes aired" until the next refresh lands.
 */
export function computeAiredEpisodes(
  entry: AnimeEntry,
  now: number = Date.now(),
): number | null {
  const { nextAiringEpisode, nextAiringAt, totalEpisodes } = entry;
  if (nextAiringEpisode != null && nextAiringAt != null) {
    const nowSec = now / 1000;
    // Pre-airing: ep N hasn't dropped yet → only N-1 is out.
    // Post-airing: ep N is out (and possibly more, pending refresh).
    const aired = nowSec < nextAiringAt ? nextAiringEpisode - 1 : nextAiringEpisode;
    const capped = totalEpisodes != null ? Math.min(aired, totalEpisodes) : aired;
    return Math.max(0, capped);
  }
  // No airing cache: if the show has a total, assume it's all out (FINISHED).
  // This is wrong for upcoming/airing shows that haven't been refreshed yet —
  // those entries won't have totalEpisodes either, so we'll return null anyway.
  return totalEpisodes ?? null;
}

/** "in 3h 12m" / "in 2d 5h" / "in 45m" — short relative-time for next airing. */
export function formatCountdown(targetUnixSec: number, now: number = Date.now()): string {
  const diff = targetUnixSec * 1000 - now;
  if (diff <= 0) return 'aired';
  const totalMin = Math.floor(diff / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${mins}m`;
  return `in ${mins}m`;
}

/**
 * Converts AniList's `nextAiringEpisode.airingAt` (unix seconds, UTC) into a
 * tracker-friendly `{ day, time }` in the user's local timezone. Used to
 * auto-fill the day/time fields when adding an anime to a season — Japanese
 * broadcast at 23:00 JST shows up as ~21:00 local for a Bangkok user, etc.
 *
 * Returns null when AniList didn't provide airing data (FINISHED / CANCELLED).
 */
export function deriveDayTimeFromAiringAt(
  unixSec: number | null | undefined,
): { day: DayOfWeek; time: string } | null {
  if (unixSec == null) return null;
  const d = new Date(unixSec * 1000);
  const day = DAYS_SUN_FIRST[d.getDay()];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return { day, time: `${hh}:${mm}` };
}

/**
 * Fallback for the day-of-week when AniList didn't return airing data — uses
 * the show's `startDate` (episode 1 air date). Returns null when startDate is
 * incomplete. Note: only gives us the day; air time can't be derived from a
 * calendar date alone.
 */
export function deriveDayFromStartDate(
  sd: { year: number | null; month: number | null; day: number | null } | null | undefined,
): DayOfWeek | null {
  if (!sd || sd.year == null || sd.month == null || sd.day == null) return null;
  const d = new Date(sd.year, sd.month - 1, sd.day);
  if (Number.isNaN(d.getTime())) return null;
  return DAYS_SUN_FIRST[d.getDay()];
}

/** "21:00" → 1260. Returns null if not parseable. */
export function timeToMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** True when both arrays contain the same strings regardless of order. */
export function tagsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((t, i) => t === sb[i]);
}

const SEASON_INDEX: Record<string, number> = {
  winter: 0,
  spring: 1,
  summer: 2,
  fall: 3,
};

/**
 * Maps an anime-season name like "Spring 2026" to a single sortable integer
 * (year * 4 + season-of-year). Returns null for names that don't match the
 * `Winter|Spring|Summer|Fall YYYY` pattern (custom-named seasons).
 *
 * Use with a descending sort to get newest-first ordering:
 *   Spring 2026 (8105) > Winter 2026 (8104) > Fall 2025 (8103)
 */
export function seasonRank(name: string): number | null {
  const m = /^(Winter|Spring|Summer|Fall)\s+(\d{4})/i.exec(name.trim());
  if (!m) return null;
  return Number(m[2]) * 4 + SEASON_INDEX[m[1].toLowerCase()];
}

const SEASON_CODES: AnimeSeason[] = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
const SEASON_DISPLAY = ['Winter', 'Spring', 'Summer', 'Fall'];

export function getCurrentAnimeSeasonRef(date: Date = new Date()): AnimeSeasonRef {
  const m = date.getMonth();
  const y = date.getFullYear();
  const idx = m <= 2 ? 0 : m <= 5 ? 1 : m <= 8 ? 2 : 3;
  return { season: SEASON_CODES[idx], year: y, name: `${SEASON_DISPLAY[idx]} ${y}` };
}
