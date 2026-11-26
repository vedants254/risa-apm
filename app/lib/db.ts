/**
 * Tiny database adapter. Everything else talks to `getDb()` and never to a driver directly.
 *
 *   DB_DRIVER=sqlite   (default) node:sqlite DatabaseSync, file at SQLITE_PATH or data/growth.db
 *   DB_DRIVER=postgres DATABASE_URL, via the `postgres` npm package
 *
 * SQL is written with `?` placeholders; the Postgres path rewrites them to $1..$n.
 * Keep SQL portable (no SQLite- or Postgres-only functions) so both drivers run it.
 */
import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";

export type Row = Record<string, unknown>;
export type Param = string | number | null;

export interface Db {
  driver: "sqlite" | "postgres";
  all<T = Row>(sql: string, params?: Param[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: Param[]): Promise<T | undefined>;
  run(sql: string, params?: Param[]): Promise<{ changes: number }>;
  /** Run a multi-statement script (schema). */
  exec(script: string): Promise<void>;
  /** Bulk insert rows (objects keyed by column). */
  insertMany(table: string, columns: string[], rows: Param[][]): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  /** Execute a single SELECT on a read-only connection / transaction. */
  readOnlyAll<T = Row>(sql: string, params?: Param[]): Promise<T[]>;
  /** User tables in the database (dialect-specific catalog query kept here). */
  tableNames(): Promise<string[]>;
  /** Column names of a table or view, in order. */
  columnNames(table: string): Promise<string[]>;
  close(): Promise<void>;
}

export function dbDriver(): "sqlite" | "postgres" {
  const d = (process.env.DB_DRIVER || "sqlite").toLowerCase();
  if (d !== "sqlite" && d !== "postgres") {
    throw new Error(`Unsupported DB_DRIVER "${d}". Use "sqlite" or "postgres".`);
  }
  return d;
}

export function sqlitePath(): string {
  return process.env.SQLITE_PATH || path.join(process.cwd(), "data", "growth.db");
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Invalid identifier: ${name}`);
  return name;
}

// ---------------------------------------------------------------------------
// SQLite (node:sqlite)
// ---------------------------------------------------------------------------
type SqliteDatabase = DatabaseSync;

function createSqlite(): Db {
  const file = sqlitePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn: SqliteDatabase = new DatabaseSync(file);
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF;");
  let ro: SqliteDatabase | null = null;
  const readOnlyConn = () => {
    if (!ro) ro = new DatabaseSync(file, { readOnly: true });
    return ro;
  };

  const norm = (rows: unknown[]) => rows.map((r) => ({ ...(r as Row) }));

  const db: Db = {
    driver: "sqlite",
    async all<T>(sql: string, params: Param[] = []) {
      return norm(conn.prepare(sql).all(...params)) as T[];
    },
    async get<T>(sql: string, params: Param[] = []) {
      const r = conn.prepare(sql).get(...params);
      return (r ? { ...(r as Row) } : undefined) as T | undefined;
    },
    async run(sql: string, params: Param[] = []) {
      const r = conn.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async exec(script: string) {
      conn.exec(script);
    },
    async insertMany(table, columns, rows) {
      const sql = `INSERT INTO ${ident(table)} (${columns.map(ident).join(", ")}) VALUES (${columns
        .map(() => "?")
        .join(", ")})`;
      const stmt = conn.prepare(sql);
      for (const r of rows) stmt.run(...r);
    },
    async tx(fn) {
      conn.exec("BEGIN");
      try {
        const out = await fn(db);
        conn.exec("COMMIT");
        return out;
      } catch (e) {
        conn.exec("ROLLBACK");
        throw e;
      }
    },
    async readOnlyAll<T>(sql: string, params: Param[] = []) {
      return norm(readOnlyConn().prepare(sql).all(...params)) as T[];
    },
    async tableNames() {
      const rows = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
      return rows.map((r) => String((r as Row).name));
    },
    async columnNames(table) {
      return conn.prepare(`PRAGMA table_info(${ident(table)})`).all().map((r) => String((r as Row).name));
    },
    async close() {
      conn.close();
      if (ro) (ro as SqliteDatabase).close();
    },
  };
  return db;
}

// ---------------------------------------------------------------------------
// Postgres (`postgres` package). Implemented for deployment; not exercised locally.
// ---------------------------------------------------------------------------
function toPg(sql: string): string {
  let i = 0;
  // Replace ? placeholders outside single-quoted strings.
  let out = "";
  let inStr = false;
  for (const ch of sql) {
    if (ch === "'") inStr = !inStr;
    if (ch === "?" && !inStr) out += `$${++i}`;
    else out += ch;
  }
  return out;
}

// Postgres returns COUNT/SUM as bigint/numeric strings; coerce numeric-looking strings
// only for those aggregate types so TEXT columns are untouched.
function normPgRows(rows: Row[]): Row[] {
  return rows.map((r) => ({ ...r }));
}

type PgSql = {
  unsafe: (q: string, p?: unknown[]) => Promise<Row[] & { count?: number }> & { simple: () => Promise<unknown> };
  begin: <T>(fn: (tx: PgSql) => Promise<T>) => Promise<T>;
  end: () => Promise<void>;
};

function createPostgres(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DB_DRIVER=postgres requires DATABASE_URL.");
  const sql = postgres(url, {
    // Small pool, and no prepared statements: Supabase's transaction pooler (port 6543) runs
    // each statement on any backend, so named prepared statements would not be found.
    max: Number(process.env.PG_POOL_MAX || 3),
    prepare: false,
    // Hosted Postgres (Supabase) needs TLS; a local server usually has none. PG_SSL overrides.
    ssl: process.env.PG_SSL ? (process.env.PG_SSL === "disable" ? false : "require") : /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : "require",
    // Return int8 (COUNT/SUM, oid 20) and numeric (oid 1700) as JS numbers.
    // Values here (counts, whole INR) are far below 2^53.
    types: {
      bignum: {
        to: 20,
        from: [20, 1700],
        serialize: (x: number) => String(x),
        parse: (x: string) => Number(x),
      },
    },
    transform: { undefined: null },
  }) as unknown as PgSql;

  const wrap = (s: PgSql): Db => {
    const db: Db = {
      driver: "postgres",
      async all<T>(q: string, params: Param[] = []) {
        return normPgRows(await s.unsafe(toPg(q), params)) as T[];
      },
      async get<T>(q: string, params: Param[] = []) {
        const rows = await s.unsafe(toPg(q), params);
        return (rows[0] ? { ...rows[0] } : undefined) as T | undefined;
      },
      async run(q: string, params: Param[] = []) {
        const rows = await s.unsafe(toPg(q), params);
        return { changes: Number(rows.count ?? 0) };
      },
      async exec(script: string) {
        // The simple query protocol accepts several statements (schema files, migrations).
        await s.unsafe(script).simple();
      },
      async insertMany(table, columns, rows) {
        // Stay well under Postgres's 65,535 bind parameters per statement.
        const chunk = Math.max(1, Math.min(500, Math.floor(30000 / Math.max(1, columns.length))));
        for (let i = 0; i < rows.length; i += chunk) {
          const part = rows.slice(i, i + chunk);
          const params: Param[] = [];
          const values = part
            .map((r) => `(${r.map((v) => (params.push(v), `$${params.length}`)).join(", ")})`)
            .join(", ");
          await s.unsafe(
            `INSERT INTO ${ident(table)} (${columns.map(ident).join(", ")}) VALUES ${values}`,
            params,
          );
        }
      },
      async tx(fn) {
        return s.begin((t) => fn(wrap(t)));
      },
      async readOnlyAll<T>(q: string, params: Param[] = []) {
        return s.begin(async (t) => {
          await t.unsafe("SET TRANSACTION READ ONLY");
          return normPgRows(await t.unsafe(toPg(q), params)) as T[];
        });
      },
      async tableNames() {
        const rows = await s.unsafe("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'");
        return rows.map((r) => String(r.table_name));
      },
      async columnNames(table) {
        const rows = await s.unsafe(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position",
          [ident(table)],
        );
        return rows.map((r) => String(r.column_name));
      },
      async close() {
        await s.end();
      },
    };
    return db;
  };
  return wrap(sql);
}

// ---------------------------------------------------------------------------
const g = globalThis as unknown as { __growthDb?: Db };

export function getDb(): Db {
  if (!g.__growthDb) {
    g.__growthDb = dbDriver() === "postgres" ? createPostgres() : createSqlite();
  }
  return g.__growthDb;
}

export async function closeDb(): Promise<void> {
  if (g.__growthDb) {
    await g.__growthDb.close();
    g.__growthDb = undefined;
  }
}

/** Numbers from either driver (Postgres may hand back numeric strings). */
export function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function nowIst(): string {
  // 'YYYY-MM-DD HH:MM:SS' in Asia/Kolkata (UTC+05:30, no DST).
  const d = new Date(Date.now() + 330 * 60_000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
