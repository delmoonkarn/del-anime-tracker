import type ExcelJSNamespace from 'exceljs';
import type {
  AnimeEntry,
  CollectionEntry,
  CollectionSection,
  DayOfWeek,
  ReleaseDate,
  Season,
  WatchStatus,
} from './types';
import {
  WATCH_STATUSES,
  WATCH_STATUS_LABELS,
  deriveDayFromStartDate,
  deriveDayTimeFromAiringAt,
  newId,
} from './utils';

// Build a reverse-lookup once: accepts either the human label ("Watching")
// or the raw enum value ("WATCHING"), case-insensitive, since users may
// hand-edit the column.
const WATCH_STATUS_FROM_TEXT: Record<string, WatchStatus> = (() => {
  const m: Record<string, WatchStatus> = {};
  for (const s of WATCH_STATUSES) {
    m[s.toLowerCase()] = s;
    m[WATCH_STATUS_LABELS[s].toLowerCase()] = s;
  }
  return m;
})();

function parseWatchStatus(val: unknown): WatchStatus | undefined {
  if (val == null || val === '') return undefined;
  const k = String(val).trim().toLowerCase();
  return WATCH_STATUS_FROM_TEXT[k];
}

function parseNonNegInt(val: unknown): number | undefined {
  if (val == null || val === '') return undefined;
  const n = typeof val === 'number' ? val : Number(String(val).trim());
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

const DAY_FROM_INDEX: DayOfWeek[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const VALID_DAYS = new Set<DayOfWeek>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

function parseDay(val: unknown): DayOfWeek | null {
  if (val == null || val === '') return null;
  if (val instanceof Date) {
    return DAY_FROM_INDEX[val.getUTCDay()] ?? null;
  }
  const s = String(val).trim();
  if (s.length < 3) return null;
  const cap = (s[0].toUpperCase() + s.slice(1, 3).toLowerCase()) as DayOfWeek;
  return VALID_DAYS.has(cap) ? cap : null;
}

function parseTime(val: unknown): string {
  if (val == null || val === '') return '';
  if (val instanceof Date) {
    const hh = String(val.getUTCHours()).padStart(2, '0');
    const mm = String(val.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  if (typeof val === 'number') {
    const totalMin = Math.round(val * 1440);
    const hh = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
    const mm = String(totalMin % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const m = /^(\d{1,2}):(\d{2})/.exec(String(val).trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

function parsePlatform(cell: ExcelJSNamespace.Cell): { platform: string; platformUrl: string } {
  const v = cell.value as unknown;
  if (v && typeof v === 'object' && 'text' in (v as object) && 'hyperlink' in (v as object)) {
    const obj = v as { text?: unknown; hyperlink?: unknown };
    return {
      platform: obj.text == null ? '' : String(obj.text),
      platformUrl: obj.hyperlink == null ? '' : String(obj.hyperlink),
    };
  }
  return { platform: v == null ? '' : String(v), platformUrl: '' };
}

/** Extracts the URL from a Google-Sheets-style `IMAGE("url")` cell formula. */
function extractImageUrl(formula: string): string {
  const m = /IMAGE\(\s*"([^"]*)"\s*\)/i.exec(formula);
  return m ? m[1] : '';
}

/** Returns the formula text of a cell (without the leading '='), or ''. */
function getFormula(cell: ExcelJSNamespace.Cell): string {
  const v = cell.value as unknown;
  if (v && typeof v === 'object' && 'formula' in (v as object)) {
    return String((v as { formula: unknown }).formula ?? '');
  }
  if (typeof v === 'string' && v.startsWith('=')) return v.slice(1);
  return '';
}

function asString(val: unknown): string {
  if (val == null) return '';
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object' && 'richText' in (val as object)) {
    const rt = (val as { richText: { text: string }[] }).richText;
    return rt.map((r) => r.text).join('');
  }
  return String(val);
}

export interface ImportProgress {
  phase: 'parsing' | 'matching' | 'done';
  matched: number;
  total: number;
}

export interface ImportSummary {
  seasonsImported: number;
  animesImported: number;
  animesMatchedOnAniList: number;
  skippedSheets: string[];
}

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 800;

export async function importWorkbook(
  file: File,
  onProgress?: (p: ImportProgress) => void,
): Promise<{ seasons: Season[]; summary: ImportSummary }> {
  onProgress?.({ phase: 'parsing', matched: 0, total: 0 });

  const ExcelJS = (await import('exceljs')).default;
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const seasons: Season[] = [];
  const skippedSheets: string[] = [];

  wb.eachSheet((ws) => {
    if (ws.name.toLowerCase() === 'template') {
      skippedSheets.push(ws.name);
      return;
    }
    const animes: AnimeEntry[] = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      // Column A intentionally skipped — title (B) will drive the AniList lookup
      // and provide both the cover image and the canonical title.
      const title = asString(row.getCell(2).value).trim();
      if (!title) return;

      const day = parseDay(row.getCell(3).value);
      const time = parseTime(row.getCell(4).value);
      const { platform, platformUrl } = parsePlatform(row.getCell(5));
      const status = asString(row.getCell(6).value);
      // G/H/I are watch-tracker fields added in the schedule-card upgrade.
      // Old workbooks lack them entirely → these helpers return undefined.
      const watchStatus = parseWatchStatus(row.getCell(7).value);
      const episodesWatched = parseNonNegInt(row.getCell(8).value);
      const totalEpisodes = parseNonNegInt(row.getCell(9).value);

      animes.push({
        id: newId(),
        anilistId: 0,
        title,
        titleEnglish: undefined,
        imageUrl: '',
        day,
        time,
        platform,
        platformUrl,
        status,
        watchStatus,
        episodesWatched,
        totalEpisodes,
        addedAt: Date.now(),
      });
    });

    if (animes.length === 0) {
      skippedSheets.push(ws.name);
      return;
    }

    seasons.push({
      id: newId(),
      name: ws.name,
      createdAt: Date.now(),
      animes,
    });
  });

  // Flatten for batched AniList lookup
  const flat: AnimeEntry[] = seasons.flatMap((s) => s.animes);
  const total = flat.length;
  let matchedCount = 0;

  onProgress?.({ phase: 'matching', matched: 0, total });

  if (total > 0) {
    const { searchTopMatchBatch } = await import('./anilist');
    for (let i = 0; i < flat.length; i += BATCH_SIZE) {
      const chunk = flat.slice(i, i + BATCH_SIZE);
      try {
        const matches = await searchTopMatchBatch(chunk.map((e) => e.title));
        matches.forEach((m, j) => {
          if (!m) return;
          const e = chunk[j];
          const primary = m.title.romaji || m.title.native || m.title.english || e.title;
          const eng = m.title.english && m.title.english !== primary ? m.title.english : undefined;
          e.anilistId = m.id;
          e.title = primary;
          e.titleEnglish = eng;
          e.imageUrl = m.coverImage.large || m.coverImage.medium || '';
          // Fill missing watch-tracker fields from AniList. Anything the
          // workbook already supplied (column I, or a re-import after a
          // previous export) takes precedence — only undefined slots are
          // filled, so user-edited values are preserved.
          if (e.totalEpisodes == null && m.episodes != null) {
            e.totalEpisodes = m.episodes;
          }
          if (e.nextAiringEpisode == null && m.nextAiringEpisode?.episode != null) {
            e.nextAiringEpisode = m.nextAiringEpisode.episode;
          }
          if (e.nextAiringAt == null && m.nextAiringEpisode?.airingAt != null) {
            e.nextAiringAt = m.nextAiringEpisode.airingAt;
          }
          // Derive day/time when the workbook didn't supply them. Prefer the
          // airing timestamp (gives both day AND time in user-local TZ);
          // fall back to startDate for the day when only that's available.
          const fromAiring = deriveDayTimeFromAiringAt(m.nextAiringEpisode?.airingAt ?? null);
          if (e.day == null && fromAiring) e.day = fromAiring.day;
          if (e.day == null) {
            const sdDay = deriveDayFromStartDate(m.startDate);
            if (sdDay) e.day = sdDay;
          }
          if ((!e.time || e.time === '') && fromAiring) e.time = fromAiring.time;
          matchedCount++;
        });
      } catch (err) {
        // Don't abort the whole import for a single batch failure
        // (e.g. rate limit, transient 5xx). Surface a console warning.
        console.warn(`AniList lookup failed for batch starting at ${i}:`, err);
      }
      onProgress?.({
        phase: 'matching',
        matched: Math.min(i + chunk.length, total),
        total,
      });
      if (i + BATCH_SIZE < flat.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }
  }

  onProgress?.({ phase: 'done', matched: total, total });

  return {
    seasons,
    summary: {
      seasonsImported: seasons.length,
      animesImported: total,
      animesMatchedOnAniList: matchedCount,
      skippedSheets,
    },
  };
}

// ---- Collection import ----------------------------------------------------

/**
 * Imports the collection xlsx exported by `exportCollection`. Expects two
 * sheets: `Favorites` and `Interested`. Tolerant of extra columns / missing
 * sheets — returns whatever it can parse.
 */
export async function importCollection(file: File): Promise<CollectionEntry[]> {
  const ExcelJS = (await import('exceljs')).default;
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const out: CollectionEntry[] = [];
  const sheetMap: Record<string, CollectionSection> = {
    favorites: 'favorites',
    interested: 'interested',
  };

  wb.eachSheet((ws) => {
    const name = ws.name.toLowerCase();
    const section = sheetMap[name];
    if (!section) return;
    // Find column indexes from the header row.
    const header = ws.getRow(1);
    const colIdx: Record<string, number> = {};
    header.eachCell((cell, col) => {
      const v = String(cell.value ?? '').trim().toLowerCase();
      if (v) colIdx[v] = col;
    });
    const cImage = 1; // column A holds the =IMAGE("…") formula
    const cAnilist = colIdx['anilist id'] ?? 4;
    const cTitle = colIdx['title'] ?? 2;
    const cTitleEn = colIdx['english title'] ?? 3;
    const cReleased = colIdx['released'] ?? 5;
    const cAdded = colIdx['added'] ?? 6;
    const cTags = colIdx['top tags'] ?? 7;
    const cFormat = colIdx['format'] ?? 8;
    const cEps = colIdx['eps'] ?? 9;
    const cScore = colIdx['score'] ?? 10;

    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const anilistRaw = row.getCell(cAnilist).value;
      const anilistId =
        typeof anilistRaw === 'number'
          ? anilistRaw
          : Number(String(anilistRaw ?? '').trim()) || 0;
      const title = String(row.getCell(cTitle).value ?? '').trim();
      if (!title) return;
      const titleEnglish = String(row.getCell(cTitleEn).value ?? '').trim() || undefined;
      const releasedRaw = row.getCell(cReleased).value;
      let startDate: ReleaseDate | undefined;
      if (releasedRaw instanceof Date) {
        startDate = {
          year: releasedRaw.getUTCFullYear(),
          month: releasedRaw.getUTCMonth() + 1,
          day: releasedRaw.getUTCDate(),
        };
      } else if (typeof releasedRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(releasedRaw)) {
        const [y, m, d] = releasedRaw.split('-').map(Number);
        startDate = { year: y, month: m, day: d };
      }
      const addedRaw = row.getCell(cAdded).value;
      let addedAt = Date.now();
      if (addedRaw instanceof Date) addedAt = addedRaw.getTime();
      else if (typeof addedRaw === 'string') {
        const t = Date.parse(addedRaw);
        if (!Number.isNaN(t)) addedAt = t;
      }
      const tagsRaw = String(row.getCell(cTags).value ?? '');
      const tags = tagsRaw ? tagsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];

      // Pull the cover URL out of column A's =IMAGE("url") formula. extractImageUrl
      // and getFormula are the same helpers the schedule import uses.
      const imageUrl = extractImageUrl(getFormula(row.getCell(cImage)));
      const format = String(row.getCell(cFormat).value ?? '').trim() || undefined;
      const epsRaw = row.getCell(cEps).value;
      const episodes =
        typeof epsRaw === 'number' ? epsRaw : Number(String(epsRaw ?? '')) || undefined;
      const scoreRaw = row.getCell(cScore).value;
      const averageScore =
        typeof scoreRaw === 'number' ? scoreRaw : Number(String(scoreRaw ?? '')) || undefined;

      out.push({
        anilistId,
        section,
        title,
        titleEnglish,
        imageUrl,
        tags,
        format,
        episodes,
        averageScore,
        startDate,
        addedAt,
      });
    });
  });

  return out;
}
