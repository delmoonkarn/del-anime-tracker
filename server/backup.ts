// Backups: your tracker data as a plain SQL file that loads straight back
// into the local SQLite file or D1 (scripts/restore.ts). Runs on both
// starters through SqlDb.
//
// What's in it: seasons, shows, progress, collection, links, H favorites and
// settings. Left out: the Explore and AniList-links caches (refetched on
// their own) and the sign-in tables (how you log in isn't tracker data).
//
// Plain .sql, not gzipped: the monthly email runs on Workers' free plan,
// which gives it 10 ms of CPU, and gzip alone takes ~14 ms on a typical
// tracker. Building the SQL and encoding it for email is a few ms.
//
// The file starts by emptying each table it covers, so loading it replaces
// that data. Every INSERT names its columns. D1 rejects any single statement
// over 100 KB, so long text values are inserted empty and then appended in
// UPDATEs that each fit.

import { sql, type SqlDb } from './sql';

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
  // Not the backup's own status row: restoring an old backup shouldn't
  // rewind "last emailed".
  { table: 'kv_store', key: ['key'], where: "key != 'backup-last'" },
  { table: 'h_favorites', key: ['anilist_id'] },
];

/** Derived data; scripts/export-sql.ts copies these too when seeding D1. */
export const CACHE_TABLES: BackupTable[] = [
  { table: 'anilist_link_cache', key: ['anilist_id'] },
  { table: 'discover_cache', key: ['id'] },
];

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
    `-- Anime Tracker backup, ${now.toISOString()}`,
    `-- Tables: ${tables.map((t) => t.table).join(', ')}`,
    '-- Restore: npm run restore -- <this file>   (see README)',
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

// ---- Email (Resend) --------------------------------------------------------

export interface EmailConfig {
  /** Resend API key. */
  apiKey: string;
  to: string;
  /** Defaults to Resend's test sender, which can only mail your own Resend address. */
  from?: string;
}

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
  // the Backup menu shows that instead of a stale success.
  await recordResult(db, { at: now.getTime(), ok: false, reason, error: "Didn't finish" });
  let result: BackupResult;
  try {
    const { sql: text, rows } = await buildBackupSql(db, DATA_TABLES, now);
    const bytes = new TextEncoder().encode(text);
    const date = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: cfg.from || 'Anime Tracker <onboarding@resend.dev>',
        to: [cfg.to],
        subject: `Anime Tracker backup, ${date}`,
        text: [
          `Your ${reason === 'monthly' ? 'monthly ' : ''}Anime Tracker backup is attached (${rows} rows).`,
          '',
          'To restore it, from the project folder:',
          `  npm run restore -- ${backupFilename(now)}                 (the local app)`,
          `  npm run restore -- ${backupFilename(now)} --d1 remote     (the cloud version)`,
        ].join('\n'),
        attachments: [{ filename: backupFilename(now), content: toBase64(bytes) }],
      }),
    });
    if (!res.ok) throw new Error(`Resend: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    result = { at: now.getTime(), ok: true, reason, rows, bytes: bytes.length };
  } catch (err) {
    console.error('[backup] email failed', err);
    result = { at: now.getTime(), ok: false, reason, error: err instanceof Error ? err.message : String(err) };
  }
  await recordResult(db, result);
  return result;
}
