// Writes the data in a local SQLite database as a SQL file D1 can load:
//
//   node scripts/export-sql.mjs <out.sql> [path/to/anime-tracker.db]
//   wrangler d1 execute anime-tracker --local --file <out.sql>
//
// Data only — D1 gets its tables from migrations/. The file starts by
// emptying every table, so loading it replaces what the target had. Every
// INSERT names its columns, so the column order of an older, upgraded local
// database doesn't matter. Rows go out in rowid order, which keeps the order
// of rows saved before the position column existed.
//
// D1 rejects any single SQL statement over 100 KB, and one cached Explore
// search can be bigger than that on its own. Long text values are inserted
// empty, then appended in UPDATEs that each stay under the limit.

import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Parents before children, for the season foreign key.
const TABLES = [
  'seasons',
  'anime_entries',
  'collection',
  'anime_progress',
  'stream_links',
  'anilist_link_cache',
  'discover_cache',
  'kv_store',
  'h_favorites',
];

const [out, src = 'data/anime-tracker.db'] = process.argv.slice(2);
if (!out) {
  console.error('usage: node scripts/export-sql.mjs <out.sql> [path/to/anime-tracker.db]');
  process.exit(1);
}

const LONG = 4_000; // bytes; text longer than this is appended after the INSERT
const PIECE = 80_000; // bytes of quoted text per UPDATE

function literal(v) {
  if (v === null) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`;
  return `'${String(v).replaceAll("'", "''")}'`;
}

// Splits on whole characters, sized by their quoted UTF-8 length.
function pieces(text) {
  const out = [];
  let cur = '';
  let size = 0;
  for (const ch of text) {
    const n = ch === "'" ? 2 : Buffer.byteLength(ch);
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

const db = new Database(src, { readonly: true, fileMustExist: true });
const lines = [...TABLES].reverse().map((t) => `DELETE FROM ${t};`);
let rows = 0;
for (const t of TABLES) {
  const key = db
    .prepare(`PRAGMA table_info(${t})`)
    .all()
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
  for (const r of db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()) {
    const cols = Object.keys(r);
    const long = cols.filter((c) => typeof r[c] === 'string' && Buffer.byteLength(r[c]) > LONG);
    const values = cols.map((c) => (long.includes(c) ? "''" : literal(r[c])));
    lines.push(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${values.join(', ')});`);
    const where = key.map((k) => `${k} = ${literal(r[k])}`).join(' AND ');
    for (const c of long) {
      for (const p of pieces(r[c])) lines.push(`UPDATE ${t} SET ${c} = ${c} || ${literal(p)} WHERE ${where};`);
    }
    rows++;
  }
}
db.close();

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join('\n') + '\n');
console.log(`[export-sql] ${rows} rows from ${src} -> ${out}`);
