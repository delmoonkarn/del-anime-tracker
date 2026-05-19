import type ExcelJSNamespace from 'exceljs';
import type {
  AnimeEntry,
  CollectionEntry,
  CollectionSection,
  DayOfWeek,
  Season,
} from './types';
import { WATCH_STATUS_LABELS, seasonRank } from './utils';

const FONT_NAME = 'Arial';
const HEADER_FILL = 'FFB7B7B7';
const ROW_FILL = 'FFFFF2CC';
const LINK_COLOR = 'FF0000FF';

// Day-of-week row colors — Thai tradition (Sun-red, Mon-yellow, Tue-pink,
// Wed-green, Thu-orange, Fri-blue, Sat-purple) in matching pastel tones.
// Excel ARGB = FF + RGB hex.
const DAY_FILLS: Record<DayOfWeek, string> = {
  Sun: 'FFFFB3B3', // Pastel Red
  Mon: 'FFFFFAB3', // Pastel Yellow
  Tue: 'FFFFB3DA', // Pastel Pink
  Wed: 'FFB3FFC8', // Pastel Green
  Thu: 'FFFFD6B3', // Pastel Orange
  Fri: 'FFB3E5FF', // Pastel Blue
  Sat: 'FFDAB3FF', // Pastel Purple
};

function rowFillFor(day: DayOfWeek | null): string {
  return day ? DAY_FILLS[day] : ROW_FILL;
}

// A: image, B: title, C: day, D: time, E: link, F: status-note,
// G: watch-status, H: watched, I: total-eps
const COLUMN_WIDTHS = [9.63, 34.38, 10.5, 8.88, 14.75, 12.63, 13, 9, 9];
const HEADER_ROW_HEIGHT = 15.75;
const DATA_ROW_HEIGHT = 75;

const DAY_ORDER: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

function timeFraction(time: string): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return (hh * 60 + mm) / 1440;
}

function sortForExport(animes: AnimeEntry[]): AnimeEntry[] {
  return [...animes].sort((a, b) => {
    const da = a.day ? DAY_ORDER[a.day] : 99;
    const db = b.day ? DAY_ORDER[b.day] : 99;
    if (da !== db) return da - db;
    return (a.time || '￿').localeCompare(b.time || '￿');
  });
}

function escapeForFormula(s: string): string {
  return s.replace(/"/g, '""');
}

function safeSheetName(name: string): string {
  // Excel sheet names cannot contain: \ / ? * [ ] : and must be <= 31 chars
  return name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';
}

function safeFileName(name: string): string {
  return name.replace(/[^a-z0-9_\- ]+/gi, '_').trim() || 'anime-tracker';
}

function applyColumnWidths(ws: ExcelJSNamespace.Worksheet): void {
  ws.columns = COLUMN_WIDTHS.map((w) => ({ width: w }));
}

function writeHeader(ws: ExcelJSNamespace.Worksheet): void {
  ws.getRow(1).height = HEADER_ROW_HEIGHT;
  // F (status note) intentionally left blank in the header — matches the
  // original workbook format. G/H/I are new and labeled.
  const headers: (string | null)[] = [
    null,
    'Title',
    'Day',
    'Time',
    'Link',
    null,
    'Watch status',
    'Watched',
    'Total eps',
  ];
  const thin = { style: 'thin' as const };
  const border = { top: thin, bottom: thin, left: thin, right: thin };

  headers.forEach((label, i) => {
    const cell = ws.getRow(1).getCell(i + 1);
    if (label !== null) cell.value = label;
    cell.font = { name: FONT_NAME, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } } as ExcelJSNamespace.FillPattern;
    cell.alignment = {
      vertical: 'middle',
      horizontal: i >= 2 && i <= 4 ? 'center' : i >= 6 ? 'center' : undefined,
    };
    if ((i >= 1 && i <= 4) || (i >= 6 && i <= 8)) cell.border = border;
  });
}

function styleDataRow(
  ws: ExcelJSNamespace.Worksheet,
  r: number,
  day: DayOfWeek | null = null,
): void {
  const thin = { style: 'thin' as const };
  const rowFill: ExcelJSNamespace.FillPattern = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: rowFillFor(day) },
  };

  // A: image cell
  const a = ws.getCell(`A${r}`);
  a.fill = rowFill;
  a.font = { name: FONT_NAME, size: 10 };
  a.alignment = { vertical: 'middle' };

  // B: title
  const b = ws.getCell(`B${r}`);
  b.fill = rowFill;
  b.font = { name: FONT_NAME, size: 12, bold: true };
  b.alignment = { vertical: 'middle' };
  b.border = { bottom: thin };

  // C: day
  const c = ws.getCell(`C${r}`);
  c.fill = rowFill;
  c.font = { name: FONT_NAME, size: 10 };
  c.alignment = { vertical: 'middle', horizontal: 'center' };
  c.border = { top: thin, bottom: thin };

  // D: time
  const d = ws.getCell(`D${r}`);
  d.fill = rowFill;
  d.font = { name: FONT_NAME, size: 10 };
  d.alignment = { vertical: 'middle', horizontal: 'center' };
  d.border = { bottom: thin };
  d.numFmt = 'h:mm am/pm';

  // E: link
  const e = ws.getCell(`E${r}`);
  e.fill = rowFill;
  e.font = { name: FONT_NAME, size: 10, color: { argb: LINK_COLOR } };
  e.alignment = { vertical: 'middle', horizontal: 'center' };
  e.border = { bottom: thin };

  // F: status — intentionally no fill / no border
  const f = ws.getCell(`F${r}`);
  f.font = { name: FONT_NAME, size: 10 };
  f.alignment = { vertical: 'middle' };

  // G/H/I: watch tracker cells. Match day-fill so they read as part of the
  // row, with a thin bottom border to separate rows.
  for (const col of ['G', 'H', 'I'] as const) {
    const c = ws.getCell(`${col}${r}`);
    c.fill = rowFill;
    c.font = { name: FONT_NAME, size: 10 };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    c.border = { bottom: thin };
  }
}

function writeSeasonSheet(wb: ExcelJSNamespace.Workbook, season: Season): void {
  const ws = wb.addWorksheet(safeSheetName(season.name));
  applyColumnWidths(ws);
  writeHeader(ws);

  const sorted = sortForExport(season.animes);

  sorted.forEach((anime, idx) => {
    const r = idx + 2;
    ws.getRow(r).height = DATA_ROW_HEIGHT;
    styleDataRow(ws, r, anime.day);

    if (anime.imageUrl) {
      // Mark as array formula so Excel doesn't add implicit-intersection `@`
      // when it opens a single-cell dynamic-array function like IMAGE().
      ws.getCell(`A${r}`).value = {
        formula: `IMAGE("${escapeForFormula(anime.imageUrl)}")`,
        result: '',
        shareType: 'array',
        ref: `A${r}`,
      } as unknown as ExcelJSNamespace.CellFormulaValue;
    }

    ws.getCell(`B${r}`).value = anime.title;
    ws.getCell(`C${r}`).value = anime.day ?? '';

    const tf = timeFraction(anime.time);
    if (tf !== null) ws.getCell(`D${r}`).value = tf;

    if (anime.platformUrl) {
      ws.getCell(`E${r}`).value = {
        text: anime.platform || anime.platformUrl,
        hyperlink: anime.platformUrl,
      };
      ws.getCell(`E${r}`).font = {
        name: FONT_NAME,
        size: 10,
        color: { argb: LINK_COLOR },
        underline: true,
      };
    } else if (anime.platform) {
      ws.getCell(`E${r}`).value = anime.platform;
    }

    if (anime.status) ws.getCell(`F${r}`).value = anime.status;

    // G: watch status as a human label (e.g. "Watching"); H/I: numeric.
    // Cells left empty when the corresponding entry field is unset, so the
    // workbook stays clean for shows the user hasn't engaged with.
    if (anime.watchStatus) {
      ws.getCell(`G${r}`).value = WATCH_STATUS_LABELS[anime.watchStatus];
    }
    if (anime.episodesWatched != null) {
      ws.getCell(`H${r}`).value = anime.episodesWatched;
    }
    if (anime.totalEpisodes != null) {
      ws.getCell(`I${r}`).value = anime.totalEpisodes;
    }
  });
}

export async function exportWorkbook(seasons: Season[]): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Anime Tracker';
  wb.created = new Date();

  // Newest anime season first (left). Seasons named like "Spring 2026" sort
  // chronologically by their actual period; custom-named ones fall through to
  // createdAt and land after the recognized ones.
  const ordered = [...seasons].sort((a, b) => {
    const ra = seasonRank(a.name);
    const rb = seasonRank(b.name);
    if (ra != null && rb != null) return rb - ra;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return b.createdAt - a.createdAt;
  });
  for (const s of ordered) writeSeasonSheet(wb as ExcelJSNamespace.Workbook, s);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `track_-_${safeFileName(new Date().toISOString().slice(0, 10))}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Collection export -----------------------------------------------------

function formatReleaseDate(d?: { year: number | null; month: number | null; day: number | null } | null): string {
  if (!d || d.year == null) return '';
  const mm = d.month ? String(d.month).padStart(2, '0') : '??';
  const dd = d.day ? String(d.day).padStart(2, '0') : '??';
  return `${d.year}-${mm}-${dd}`;
}

function writeCollectionSheet(
  wb: ExcelJSNamespace.Workbook,
  name: string,
  entries: CollectionEntry[],
): void {
  const ws = wb.addWorksheet(name);
  ws.columns = [
    { width: 9.63 }, // A: image
    { width: 34 }, // B: title (jp)
    { width: 34 }, // C: title (en)
    { width: 12 }, // D: AniList ID
    { width: 12 }, // E: released
    { width: 12 }, // F: added
    { width: 30 }, // G: tags
    { width: 8 }, // H: format
    { width: 8 }, // I: eps
    { width: 8 }, // J: score
  ];

  const headers = [
    null,
    'Title',
    'English title',
    'AniList ID',
    'Released',
    'Added',
    'Top tags',
    'Format',
    'Eps',
    'Score',
  ];
  const headerRow = ws.getRow(1);
  headerRow.height = 18;
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    if (h !== null) c.value = h;
    c.font = { name: FONT_NAME, size: 10, bold: true };
    c.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_FILL },
    } as ExcelJSNamespace.FillPattern;
    c.alignment = { vertical: 'middle', horizontal: i >= 3 ? 'center' : undefined };
    if (i >= 1) {
      c.border = {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' },
      };
    }
  });

  const fill: ExcelJSNamespace.FillPattern = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: ROW_FILL },
  };
  const sorted = [...entries].sort((a, b) => b.addedAt - a.addedAt);

  sorted.forEach((e, idx) => {
    const r = idx + 2;
    const row = ws.getRow(r);
    row.height = 80;
    if (e.imageUrl) {
      ws.getCell(`A${r}`).value = {
        formula: `IMAGE("${e.imageUrl.replace(/"/g, '""')}")`,
        result: '',
        shareType: 'array',
        ref: `A${r}`,
      } as unknown as ExcelJSNamespace.CellFormulaValue;
    }
    ws.getCell(`B${r}`).value = e.title;
    ws.getCell(`B${r}`).font = { name: FONT_NAME, size: 12, bold: true };
    ws.getCell(`C${r}`).value = e.titleEnglish ?? '';
    ws.getCell(`D${r}`).value = e.anilistId;
    ws.getCell(`E${r}`).value = formatReleaseDate(e.startDate);
    ws.getCell(`F${r}`).value = new Date(e.addedAt).toISOString().slice(0, 10);
    ws.getCell(`G${r}`).value = (e.tags ?? []).join(', ');
    ws.getCell(`H${r}`).value = e.format ?? '';
    ws.getCell(`I${r}`).value = e.episodes ?? '';
    ws.getCell(`J${r}`).value = e.averageScore ?? '';
    // Apply fill + base font to A–J
    for (let col = 1; col <= 10; col++) {
      const cell = ws.getRow(r).getCell(col);
      cell.fill = fill;
      if (!cell.font?.bold) cell.font = { name: FONT_NAME, size: 10 };
      cell.alignment = {
        vertical: 'middle',
        wrapText: col === 7,
        horizontal: col >= 4 ? 'center' : undefined,
      };
    }
  });
}

export async function exportCollection(items: CollectionEntry[]): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Anime Tracker';
  wb.created = new Date();

  const sections: CollectionSection[] = ['favorites', 'interested'];
  for (const sec of sections) {
    const entries = items.filter((i) => i.section === sec);
    writeCollectionSheet(
      wb as ExcelJSNamespace.Workbook,
      sec === 'favorites' ? 'Favorites' : 'Interested',
      entries,
    );
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `collection_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- JSON (raw DB) backups ----------------------------------------------
//
// Scope-bounded, lossless backups. Faster than the xlsx round-trip and
// preserves every AnimeEntry / CollectionEntry field as-is (the xlsx format
// only carries the visible columns). `kind` is a sanity marker so the
// importer can reject mismatched files (e.g. a collection backup dropped
// into the schedule menu).

const SCHEDULE_KIND = 'anime-tracker-schedule';
const COLLECTION_KIND = 'anime-tracker-collection';

function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportScheduleJson(seasons: Season[]): void {
  const payload = {
    kind: SCHEDULE_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    seasons,
  };
  downloadBlob(
    JSON.stringify(payload, null, 2),
    `schedule_${new Date().toISOString().slice(0, 10)}.json`,
    'application/json',
  );
}

export function exportCollectionJson(entries: CollectionEntry[]): void {
  const payload = {
    kind: COLLECTION_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
  };
  downloadBlob(
    JSON.stringify(payload, null, 2),
    `collection_${new Date().toISOString().slice(0, 10)}.json`,
    'application/json',
  );
}
