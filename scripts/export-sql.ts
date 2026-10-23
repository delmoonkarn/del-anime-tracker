// Writes a local SQLite database as a SQL file D1 can load: your data plus
// the AniList caches, in the same format as backups (server/backup.ts).
//
//   npx tsx scripts/export-sql.ts <out.sql> [path/to/anime-tracker.db]
//   npx wrangler d1 execute anime-tracker --local --file <out.sql>
//
// Loading it replaces the target's tracker data; sign-in tables are left as
// they are. The source database is only read.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildBackupSql, CACHE_TABLES, DATA_TABLES } from '../server/backup';
import { openSqlite } from '../server/sqlite';

const [out, src = 'data/anime-tracker.db'] = process.argv.slice(2);
if (!out) {
  console.error('usage: npx tsx scripts/export-sql.ts <out.sql> [path/to/anime-tracker.db]');
  process.exit(1);
}

const local = openSqlite(src, { readonly: true });
const { sql, rows } = await buildBackupSql(local.db, [...DATA_TABLES, ...CACHE_TABLES]);
local.close();

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, sql);
console.log(`[export-sql] ${rows} rows from ${src} -> ${out}`);
