// Backups: your tracker data as a plain SQL file that loads straight back
// into the local SQLite file or D1, from Settings (restoreBackup below) or
// scripts/restore.ts. Runs on both starters through SqlDb.
//
// What's in it: seasons, shows, progress, collection, links, H favorites and
// tracker preferences. Left out: the AniList caches (refetched on their
// own), the sign-in tables (how you log in isn't tracker data) and
// app_settings (it holds the Resend key).
//
// Plain .sql, not gzipped: the monthly email runs on Workers' free plan,
// which gives it 10 ms of CPU, and gzip alone takes ~14 ms on a typical
// tracker. Building the SQL and encoding it for email is a few ms.
//
// The file starts by emptying each table it covers, so loading it replaces
// that data. Every INSERT names its columns. D1 rejects any single statement
// over 100 KB, so long text values are inserted empty and then appended in
// UPDATEs that each fit.

import { sendEmail, type EmailConfig } from './email';
import { sql, type SqlDb, type SqlStatement } from './sql';

export interface BackupTable {
  table: string;
  /** Primary key, for the UPDATEs that append long values. */
  key: string[];
  /** Rows to leave out (and leave alone on restore). */
  where?: string;
}

/** Your data, parents before children (the season foreign key). */
export const DATA_TABLES: BackupTable[] = [
  { table: 'seasons', key: ['id'] },
  { table: 'anime_entries', key: ['id'] },
  { table: 'collection', key: ['anilist_id', 'section'] },
  { table: 'anime_progress', key: ['anilist_id'] },
  { table: 'stream_links', key: ['anilist_id', 'position'] },
  // Not the backup's own status row (restoring an old backup shouldn't rewind
  // "last emailed"), nor AniList's tag and streaming-service lists, which the
  // app fetches again when they're missing.
  { table: 'kv_store', key: ['key'], where: "key NOT IN ('backup-last', 'tags', 'link-sources')" },
  { table: 'h_favorites', key: ['anilist_id'] },
];

/** Derived data; scripts/export-sql.ts copies these too when seeding D1. */
export const CACHE_TABLES: BackupTable[] = [
  { table: 'anilist_link_cache', key: ['anilist_id'] },
  { table: 'discover_cache', key: ['id'] },
];

/** Every backup's first line starts with this; it's how a restore recognises one. */
const HEADER = '-- Anime Tracker backup';

// Text longer than this (UTF-16 units, so at most 24 KB of UTF-8) is
// appended after the INSERT. A row of values under it stays far below
// 100 KB, and checking .length costs nothing, unlike counting bytes.
const LONG = 8_000;
const PIECE = 80_000; // bytes of quoted text per UPDATE

function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // A surrogate pair is 4 bytes, 2 per half.
    n += c < 0x80 ? 1 : c < 0x800 || (c >= 0xd800 && c <= 0xdfff) ? 2 : 3;
  }
  return n;
}

function isLong(v: unknown): v is string {
  return typeof v === 'string' && v.length > LONG;
}

function literal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  const s = String(v);
  return s.includes("'") ? `'${s.replaceAll("'", "''")}'` : `'${s}'`;
}

/** Splits on whole characters, sized by their quoted UTF-8 length. */
function pieces(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let size = 0;
  for (const ch of text) {
    const n = ch === "'" ? 2 : utf8Length(ch);
    if (size + n > PIECE) {
      out.push(cur);
      cur = '';
      size = 0;
    }
    cur += ch;
    size += n;
  }
  if (cur) out.push(cur);
  return out;
}

export async function buildBackupSql(
  db: SqlDb,
  tables: BackupTable[] = DATA_TABLES,
  now = new Date(),
): Promise<{ sql: string; rows: number }> {
  const where = (t: BackupTable) => (t.where ? ` WHERE ${t.where}` : '');
  const results = await Promise.all(
    tables.map((t) => db.all<Record<string, unknown>>(`SELECT * FROM ${t.table}${where(t)} ORDER BY rowid`)),
  );
  const lines = [
    `${HEADER}, ${now.toISOString()}`,
    `-- Tables: ${tables.map((t) => t.table).join(', ')}`,
    '-- Restore: Settings > Restore from backup, or npm run restore -- <this file>   (see README)',
    ...[...tables].reverse().map((t) => `DELETE FROM ${t.table}${where(t)};`),
  ];
  // One plain loop: the monthly email runs this in a cold Worker, before
  // the JIT has warmed up, so every closure per value shows up in CPU time.
  let rows = 0;
  for (let t = 0; t < tables.length; t++) {
    const { table, key } = tables[t];
    const list = results[t];
    if (!list.length) continue;
    const cols = Object.keys(list[0]);
    const head = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (`;
    for (const r of list) {
      let values = '';
      let long: string[] | null = null;
      for (let c = 0; c < cols.length; c++) {
        const v = r[cols[c]];
        if (c) values += ', ';
        if (isLong(v)) {
          (long ??= []).push(cols[c]);
          values += "''";
        } else {
          values += literal(v);
        }
      }
      lines.push(`${head}${values});`);
      if (long) {
        const match = key.map((k) => `${k} = ${literal(r[k])}`).join(' AND ');
        for (const c of long) {
          for (const p of pieces(r[c] as string)) lines.push(`UPDATE ${table} SET ${c} = ${c} || ${literal(p)} WHERE ${match};`);
        }
      }
      rows++;
    }
  }
  return { sql: lines.join('\n') + '\n', rows };
}

/** anime-tracker-2026-11-01.sql (UTC date). */
export function backupFilename(now = new Date()): string {
  return `anime-tracker-${now.toISOString().slice(0, 10)}.sql`;
}

// ---- Restore ---------------------------------------------------------------
//
// Settings > Restore from backup. The file is split into its statements and
// run as one batch, so it applies completely or not at all. Only what a
// backup is made of is accepted (DELETE, INSERT and UPDATE on the tables in
// DATA_TABLES), so a file can't reach the sign-in or settings tables.

/** A file that isn't a backup this app can load; nothing was changed. */
export class BackupFileError extends Error {}

export interface ParsedBackup {
  statements: string[];
  rows: number;
  /** When the backup was made (ISO time from its first line). */
  madeAt: string;
}

/**
 * The statements in a backup, without their ';'. Our files need only this
 * much parsing: a ';' can sit inside a quoted value (where '' is a quote),
 * and comments are whole lines between statements. indexOf keeps it cheap
 * on Workers, where a restore shares the 10 ms CPU budget.
 */
export function splitStatements(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 10 || c === 13 || c === 32 || c === 9) {
      i++;
      continue;
    }
    if (text.startsWith('--', i)) {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? text.length : nl + 1;
      continue;
    }
    const start = i;
    let semi = -1;
    for (;;) {
      if (semi < i) semi = text.indexOf(';', i);
      if (semi < 0) throw new BackupFileError('The file ends partway through. Is it the whole backup?');
      const quote = text.indexOf("'", i);
      if (quote < 0 || quote > semi) break;
      // A '' inside a value reads as the value ending and a new one starting.
      const close = text.indexOf("'", quote + 1);
      if (close < 0) throw new BackupFileError('The file ends partway through. Is it the whole backup?');
      i = close + 1;
    }
    out.push(text.slice(start, semi));
    i = semi + 1;
  }
  return out;
}

const DATA_TABLE_NAMES = new Set(DATA_TABLES.map((t) => t.table));
const STATEMENT = /^(?:DELETE FROM|INSERT INTO|UPDATE) (\w+)(?:[ (]|$)/;

/** Checks a backup file and splits it up. Throws BackupFileError if it can't be loaded. */
export function parseBackup(text: string): ParsedBackup {
  const madeAt = new RegExp(`^${HEADER}, (\\S+)`).exec(text)?.[1];
  if (!madeAt) throw new BackupFileError("That file isn't an Anime Tracker backup.");
  const statements = splitStatements(text);
  let rows = 0;
  for (const s of statements) {
    const table = STATEMENT.exec(s)?.[1];
    if (!table || !DATA_TABLE_NAMES.has(table)) {
      throw new BackupFileError(`The file has something in it that isn't tracker data: ${s.slice(0, 60)}`);
    }
    if (s.startsWith('INSERT')) rows++;
  }
  return { statements, rows, madeAt };
}

/**
 * Replaces the tracker data with the backup's, in one transaction. A backup
 * from an older version can hold columns that have since been dropped
 * (migrations/); their values are left out.
 */
export async function restoreBackup(db: SqlDb, backup: ParsedBackup): Promise<void> {
  const columns = await currentColumns(db);
  const statements: SqlStatement[] = [];
  for (const s of backup.statements) {
    const fitted = fitToColumns(s, columns);
    if (fitted) statements.push(sql(fitted));
  }
  await db.batch(statements);
}

/** Each data table's columns as they are now, in one query (a join: D1 caps UNION ALL chains). */
async function currentColumns(db: SqlDb): Promise<Map<string, Set<string>>> {
  const rows = await db.all<{ t: string; name: string }>(
    'SELECT j.value AS t, p.name AS name FROM json_each(?) AS j, pragma_table_info(j.value) AS p',
    JSON.stringify(DATA_TABLES.map((t) => t.table)),
  );
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = out.get(r.t);
    if (!set) out.set(r.t, (set = new Set()));
    set.add(r.name);
  }
  return out;
}

const INSERT_HEAD = /^INSERT INTO (\w+) \(([^)]*)\) VALUES \(/;
const UPDATE_HEAD = /^UPDATE (\w+) SET (\w+) = /;

/** The statement without dropped columns, or null when it only fills one (a long value's pieces). */
function fitToColumns(statement: string, columns: Map<string, Set<string>>): string | null {
  const insert = INSERT_HEAD.exec(statement);
  if (insert) {
    const have = columns.get(insert[1]);
    const cols = insert[2].split(',').map((c) => c.trim());
    if (!have || cols.every((c) => have.has(c))) return statement;
    const values = splitValues(statement.slice(insert[0].length, -1));
    const keep = cols.map((c) => have.has(c));
    const pick = <T,>(list: T[]) => list.filter((_, i) => keep[i]).join(', ');
    return `INSERT INTO ${insert[1]} (${pick(cols)}) VALUES (${pick(values)})`;
  }
  const update = UPDATE_HEAD.exec(statement);
  if (update && !columns.get(update[1])?.has(update[2])) return null;
  return statement;
}

/** An INSERT's values, split at the commas outside quoted text. */
function splitValues(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  for (;;) {
    const comma = text.indexOf(',', i);
    const quote = text.indexOf("'", i);
    if (quote >= 0 && (comma < 0 || quote < comma)) {
      const close = text.indexOf("'", quote + 1);
      if (close < 0) throw new BackupFileError('The file ends partway through. Is it the whole backup?');
      i = close + 1;
      continue;
    }
    if (comma < 0) {
      out.push(text.slice(start).trim());
      return out;
    }
    out.push(text.slice(start, comma).trim());
    i = start = comma + 1;
  }
}

// ---- Email -----------------------------------------------------------------

export interface BackupResult {
  at: number;
  ok: boolean;
  reason: 'monthly' | 'manual';
  rows?: number;
  bytes?: number;
  error?: string;
}

const LAST_KEY = 'backup-last';

function toBase64(bytes: Uint8Array): string {
  // Built in on newer runtimes (current Workers), and far cheaper.
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (native) return native.call(bytes);
  // fromCharCode.apply in modest chunks: spreading 32k arguments is ~4x
  // slower before the JIT warms up.
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x2000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000) as unknown as number[]);
  }
  return btoa(s);
}

async function recordResult(db: SqlDb, result: BackupResult): Promise<void> {
  await db.batch([
    sql(
      `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      LAST_KEY,
      JSON.stringify(result),
      result.at,
    ),
  ]);
}

export async function lastBackup(db: SqlDb): Promise<BackupResult | null> {
  const row = await db.first<{ value: string | null }>('SELECT value FROM kv_store WHERE key = ?', LAST_KEY);
  try {
    return row?.value ? (JSON.parse(row.value) as BackupResult) : null;
  } catch {
    return null;
  }
}

/** Builds a backup and emails it. Records the outcome either way; resolves to it. */
export async function emailBackup(db: SqlDb, cfg: EmailConfig, reason: BackupResult['reason']): Promise<BackupResult> {
  const now = new Date();
  // Marked failed up front: if the Worker is stopped partway (CPU limit),
  // Settings shows that instead of a stale success.
  await recordResult(db, { at: now.getTime(), ok: false, reason, error: "Didn't finish" });
  let result: BackupResult;
  try {
    const { sql: text, rows } = await buildBackupSql(db, DATA_TABLES, now);
    const bytes = new TextEncoder().encode(text);
    const date = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    await sendEmail(cfg, {
      subject: `Anime Tracker backup, ${date}`,
      text: [
        `Your ${reason === 'monthly' ? 'monthly ' : ''}Anime Tracker backup is attached (${rows} rows).`,
        '',
        'To restore it, open the tracker and go to Settings > Restore from backup.',
      ].join('\n'),
      attachments: [{ filename: backupFilename(now), content: toBase64(bytes) }],
    });
    result = { at: now.getTime(), ok: true, reason, rows, bytes: bytes.length };
  } catch (err) {
    console.error('[backup] email failed', err);
    result = { at: now.getTime(), ok: false, reason, error: err instanceof Error ? err.message : String(err) };
  }
  await recordResult(db, result);
  return result;
}
