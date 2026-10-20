// The small SQL interface the storage layer (server/db.ts) is written
// against, so the same code runs on local SQLite (server/sqlite.ts) and on
// Cloudflare D1. Shaped after D1 since it's the stricter of the two: async
// everywhere, and writes only go through batch(), which runs as one
// transaction on both.

export type SqlValue = string | number | null;

export interface SqlStatement {
  sql: string;
  params: SqlValue[];
}

export interface SqlDb {
  all<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;
  /** Runs the statements in order as one transaction. Resolves to the number of rows changed. */
  batch(statements: SqlStatement[]): Promise<number>;
}

export function sql(text: string, ...params: SqlValue[]): SqlStatement {
  return { sql: text, params };
}

// ---- Bulk writes that skip unchanged rows ---------------------------------
//
// Rows go in as a single JSON parameter (an array of arrays, one value per
// column in `cols` order) and are unpacked in SQL with json_each. That keeps a
// whole table to a statement or two, whatever its size: D1 caps bound
// parameters per statement and statements per request.

export interface TableSpec {
  table: string;
  cols: readonly string[];
  key: readonly string[];
  /** Written when the row is first inserted, then left alone (created_at). */
  insertOnly?: readonly string[];
  /** Rewritten whenever the row changes, but never a reason to rewrite it on its own (updated_at). */
  touch?: readonly string[];
}

// Rows per statement, so one parameter stays well under D1's 2 MB value cap.
const CHUNK = 200;

function item(i: number): string {
  return `json_extract(value, '$[${i}]')`;
}

/**
 * Inserts new rows and updates rows whose values differ. Rows that already
 * match are skipped by the DO UPDATE ... WHERE, so they cost no write.
 */
export function upsertRows(spec: TableSpec, rows: SqlValue[][]): SqlStatement[] {
  const { table, cols, key, insertOnly = [], touch = [] } = spec;
  const compared = cols.filter((c) => !key.includes(c) && !insertOnly.includes(c) && !touch.includes(c));
  const onConflict = compared.length
    ? `DO UPDATE SET ${[...compared, ...touch].map((c) => `${c} = excluded.${c}`).join(', ')}
       WHERE ${compared.map((c) => `${table}.${c} IS NOT excluded.${c}`).join(' OR ')}`
    : 'DO NOTHING';
  // "WHERE true" is required: without it SQLite can't tell the upsert's
  // ON CONFLICT apart from a join constraint on the SELECT.
  const text = `INSERT INTO ${table} (${cols.join(', ')})
    SELECT ${cols.map((_, i) => item(i)).join(', ')} FROM json_each(?) WHERE true
    ON CONFLICT (${key.join(', ')}) ${onConflict}`;
  const out: SqlStatement[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    out.push(sql(text, JSON.stringify(rows.slice(i, i + CHUNK))));
  }
  return out;
}

/** Deletes every row whose key isn't among `rows` (same row shape as upsertRows). */
export function deleteRowsNotIn(spec: TableSpec, rows: SqlValue[][]): SqlStatement {
  const { table, cols, key } = spec;
  const at = key.map((k) => cols.indexOf(k));
  return sql(
    `DELETE FROM ${table} WHERE (${key.join(', ')}) NOT IN
       (SELECT ${key.map((_, i) => item(i)).join(', ')} FROM json_each(?))`,
    JSON.stringify(rows.map((r) => at.map((i) => r[i]))),
  );
}
