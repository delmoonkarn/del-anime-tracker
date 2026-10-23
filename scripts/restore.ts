// Loads a backup (from the Backup menu or the monthly email) back in.
//
//   npm run restore -- <backup.sql>               the local app (data/anime-tracker.db)
//   npm run restore -- <backup.sql> --d1 local    the local D1 that `npm run cf:dev` uses
//   npm run restore -- <backup.sql> --d1 remote   the live D1 on Cloudflare
//
// Replaces the tracker data the backup holds; sign-in is left alone. Close
// the app in your browser first: an open tab still holds the old data and
// would save it back over the restore. For the local app, the current
// database is copied to data/anime-tracker.before-restore-<time>.db first.
// Gzipped backups (.sql.gz) work too.

import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DATA_TABLES } from '../server/backup';
import { openSqlite } from '../server/sqlite';

let file: string | undefined;
let d1: string | null = null;
let target = join('data', 'anime-tracker.db');
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--d1') d1 = args[++i];
  else if (args[i] === '--db') target = args[++i];
  else file = args[i];
}

if (!file || (d1 !== null && d1 !== 'local' && d1 !== 'remote')) {
  console.error('usage: npm run restore -- <backup.sql> [--d1 local|remote] [--db path/to/anime-tracker.db]');
  process.exit(1);
}

let bytes = readFileSync(file);
if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
const sql = bytes.toString('utf8');
if (!sql.startsWith('-- Anime Tracker backup')) {
  console.error(`[restore] ${file} doesn't look like an Anime Tracker backup. Nothing was changed.`);
  process.exit(1);
}
console.log(`[restore] ${sql.split('\n', 1)[0].slice(3)}`);

if (d1) {
  // Through wrangler, which asks before touching the live database.
  const tmp = join('.wrangler', 'restore.sql');
  mkdirSync(dirname(tmp), { recursive: true });
  writeFileSync(tmp, sql);
  const run = spawnSync('npx', ['wrangler', 'd1', 'execute', 'anime-tracker', `--${d1}`, '--file', tmp], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exit(run.status ?? 1);
}

if (existsSync(target)) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const copy = join(dirname(target), `anime-tracker.before-restore-${stamp}.db`);
  // The backup API copies a consistent snapshot, including anything still in the WAL file.
  const current = new Database(target, { readonly: true, fileMustExist: true });
  await current.backup(copy);
  current.close();
  console.log(`[restore] current database copied to ${copy}`);
}

const local = openSqlite(target);
local.exec(sql);
const counts = await Promise.all(
  DATA_TABLES.map(async ({ table }) => `${table} ${(await local.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n}`),
);
local.close();
console.log(`[restore] restored into ${target}: ${counts.join(', ')}`);
