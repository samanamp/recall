// In-memory D1 stand-in backed by node:sqlite (the same engine D1 runs), with
// the real migrations applied. Counts executed queries the way the D1 budget
// does: each first/all/run/raw is one, a whole batch() is one.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

type Value = string | number | bigint | null | Uint8Array;

export interface FakeD1 {
  db: D1Database;
  sqlite: DatabaseSync;
  queries: () => number;
  resetCount: () => void;
}

export function createFakeD1(): FakeD1 {
  const sqlite = new DatabaseSync(":memory:");
  const dir = join(__dirname, "..", "migrations");
  for (const file of readdirSync(dir).sort()) {
    sqlite.exec(readFileSync(join(dir, file), "utf8"));
  }
  let count = 0;

  const returnsRows = (sql: string) => /^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);

  function execute(sql: string, values: Value[]) {
    const stmt = sqlite.prepare(sql);
    if (returnsRows(sql)) {
      const results = stmt.all(...values).map((r) => ({ ...r }));
      return { results, success: true, meta: { changes: 0 } };
    }
    const info = stmt.run(...values);
    return {
      results: [],
      success: true,
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
    };
  }

  function statement(sql: string, values: Value[] = []): any {
    return {
      sql,
      values,
      bind: (...v: unknown[]) => statement(sql, v as Value[]),
      first: async (col?: string) => {
        count++;
        const row = execute(sql, values).results[0] as Record<string, unknown> | undefined;
        if (!row) return null;
        return col ? row[col] : row;
      },
      all: async () => {
        count++;
        return execute(sql, values);
      },
      run: async () => {
        count++;
        return execute(sql, values);
      },
      raw: async () => {
        count++;
        return execute(sql, values).results.map((r) => Object.values(r));
      },
    };
  }

  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: { sql: string; values: Value[] }[]) => {
      count++;
      // D1 batches are one transaction: all or nothing.
      sqlite.exec("BEGIN");
      try {
        const out = stmts.map((s) => execute(s.sql, s.values));
        sqlite.exec("COMMIT");
        return out;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };

  return {
    db: db as unknown as D1Database,
    sqlite,
    queries: () => count,
    resetCount: () => {
      count = 0;
    },
  };
}

export const fakeCtx = {
  waitUntil: (_p: Promise<unknown>) => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;
