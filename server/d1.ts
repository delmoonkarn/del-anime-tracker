// Cloudflare D1 implementation of the SqlDb interface (server/sql.ts).

import type { SqlDb, SqlStatement, SqlValue } from './sql';

// The slice of D1's binding API used here, typed locally: Workers' global
// types (@cloudflare/workers-types) clash with the DOM lib the frontend
// shares this tsconfig with.
export interface D1PreparedStatement {
  bind(...values: SqlValue[]): D1PreparedStatement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<{ meta: { changes?: number } }[]>;
}

export function d1Db(d1: D1Database): SqlDb {
  const prepare = (s: SqlStatement) => d1.prepare(s.sql).bind(...s.params);
  return {
    async all<T>(sql: string, ...params: SqlValue[]) {
      return (await prepare({ sql, params }).all<T>()).results;
    },
    async first<T>(sql: string, ...params: SqlValue[]) {
      return prepare({ sql, params }).first<T>();
    },
    // D1 runs a batch as a single transaction, rolled back if any statement fails.
    async batch(statements: SqlStatement[]) {
      if (!statements.length) return 0;
      const results = await d1.batch(statements.map(prepare));
      return results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
    },
  };
}
