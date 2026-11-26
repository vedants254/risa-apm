/**
 * Schema versioning. db/schema.sql is the full current schema (used for fresh databases and on
 * every import, which recreates the data tables). Databases created by an older version are
 * upgraded in place by the ordered migrations below, recorded in app_meta.schema_version.
 * A database without schema_version is at version 1.
 */
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db";

export const SCHEMA_VERSION = 3;

/** Ordered migrations: `version` is the schema version the file upgrades the database to. */
export const MIGRATIONS: { version: number; file: string }[] = [
  { version: 2, file: "002_dataset_versions.sql" },
  { version: 3, file: "003_dataset_uploads.sql" },
];

export function readSql(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), "db", rel), "utf8");
}

export async function storedSchemaVersion(db: Db): Promise<number> {
  try {
    const r = await db.get<{ value: string }>("SELECT value FROM app_meta WHERE key = 'schema_version'");
    return r ? Number(r.value) || 1 : 1;
  } catch {
    return 0; // no app_meta: not seeded
  }
}

async function setVersion(db: Db, v: number) {
  await db.run("DELETE FROM app_meta WHERE key = 'schema_version'");
  await db.run("INSERT INTO app_meta (key, value) VALUES (?, ?)", ["schema_version", String(v)]);
}

/** Apply pending migrations, each in its own transaction. Returns the versions applied. */
export async function migrate(db: Db): Promise<number[]> {
  const current = await storedSchemaVersion(db);
  if (current === 0) return [];
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.tx(async (t) => {
      await t.exec(readSql(path.join("migrations", m.file)));
      await setVersion(t, m.version);
    });
    applied.push(m.version);
  }
  return applied;
}
