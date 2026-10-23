// Node-only side of storage: opens the local SQLite file with
// better-sqlite3, builds or upgrades its tables from migrations/ (the same
// files D1 uses), and adapts the connection to the SqlDb interface the
// storage layer (server/db.ts) is written against.
import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SqlDb, SqlStatement } from './sql';

export interface LocalDb {
  db: SqlDb;
  /** Runs a whole SQL script (a backup file) as one transaction. */
  exec(script: string): void;
  /** Saves a consistent copy of the database (including anything still in the WAL) to `path`. */
  copyTo(path: string): Promise<void>;
  close(): void;
}

/** `readonly` opens an existing file as it is: no upgrades, no writes (scripts/export-sql.ts). */
export function openSqlite(dbPath: string, { readonly = false } = {}): LocalDb {
  let db: Database.Database;
  if (readonly) {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } else {
    mkdirSync(dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
  }

  // The storage layer issues the same few dozen statements over and over,
  // so prepare each one once.
  const prepared = new Map<string, Database.Statement>();
  const prepare = (text: string): Database.Statement => {
    let stmt = prepared.get(text);
    if (!stmt) {
      // A restore runs hundreds of one-off statements; don't keep them all.
      if (prepared.size >= 500) prepared.clear();
      stmt = db.prepare(text);
      prepared.set(text, stmt);
    }
    return stmt;
  };
  const runBatch = db.transaction((statements: SqlStatement[]) => {
    let changes = 0;
    for (const s of statements) changes += prepare(s.sql).run(...s.params).changes;
    return changes;
  });

  return {
    db: {
      async all<T>(text: string, ...params: (string | number | null)[]) {
        return prepare(text).all(...params) as T[];
      },
      async first<T>(text: string, ...params: (string | number | null)[]) {
        return (prepare(text).get(...params) as T | undefined) ?? null;
      },
      async batch(statements: SqlStatement[]) {
        return statements.length ? runBatch(statements) : 0;
      },
    },
    exec(script: string) {
      db.transaction(() => db.exec(script))();
    },
    async copyTo(path: string) {
      await db.backup(path);
    },
    close() {
      db.close();
    },
  };
}

// ---- Schema ---------------------------------------------------------------
//
// migrations/*.sql in name order, each recorded in d1_migrations once it has
// run: the same files and table `wrangler d1 migrations apply` uses for D1.

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

// Databases from before the local app used migrations/ already have what
// these create.
const BUILT_BEFORE_MIGRATIONS = ['0001_initial.sql', '0002_auth.sql', '0003_drop_auth_identity.sql', '0004_settings.sql'];

function migrate(db: Database.Database): void {
  const hasTable = (name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  const older = !hasTable('d1_migrations') && hasTable('seasons');
  db.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`);
  const record = db.prepare('INSERT INTO d1_migrations (name) VALUES (?)');
  if (older) for (const name of BUILT_BEFORE_MIGRATIONS) record.run(name);
  const applied = new Set((db.prepare('SELECT name FROM d1_migrations').all() as { name: string }[]).map((r) => r.name));
  for (const name of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(name)) continue;
    db.transaction(() => {
      db.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
      record.run(name);
    })();
    console.info(`[db] applied ${name}`);
  }
}
