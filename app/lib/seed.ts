/**
 * Loads a dataset into the database. One path for every source:
 *
 *   seedDatabase()  the original workbook, imported exactly as given (import copies kept), used by
 *                   `npm run seed`, first run and "Reset to original data"
 *   seedTables()    canonical rows from any source (the workbook above, or a cleaned upload from
 *                   lib/dataset/pipeline.ts)
 *
 * seedTables runs in one transaction: it drops every data, app and side table of the previous
 * dataset, recreates the schema, inserts the new rows, starts fresh app state (settings at their
 * defaults, no tasks, decisions or chat) and records the dataset in dataset_versions. On any
 * error nothing changes.
 */
import fs from "node:fs";
import path from "node:path";
import { getDb, nowIst, type Db, type Param } from "./db";
import { applyMapping, fastPathMapping, type DatasetMapping, type Row, type SideTable } from "./dataset/mapping";
import { parseXlsx } from "./dataset/parse";
import { RAW_TABLES, TABLE_NAMES, type TableName } from "./dataset/schema";
import { SCHEMA_VERSION, migrate, readSql } from "./schema-version";
import { DEFAULT_SETTINGS } from "./settings";

// Kept here for existing imports (repo.ts, scripts).
export { RAW_TABLES, coerce, normalizeTs } from "./dataset/schema";

/** The provided workbook: a copy ships inside the app (seed-data/) so deployments can reset to it. */
export function datasetPath(): string {
  if (process.env.DATASET_PATH) return process.env.DATASET_PATH;
  const bundled = path.join(process.cwd(), "seed-data", "Attendee_Dataset.xlsx");
  return fs.existsSync(bundled) ? bundled : path.resolve(process.cwd(), "..", "dataset", "Attendee_Dataset.xlsx");
}

export interface SeedReport {
  dataset: string;
  counts: Record<string, number>;
}

export type SourceKind = "original" | "upload" | "reset";
export interface SeedInput {
  tables: Record<TableName, Row[]>;
  extras?: Partial<Record<TableName, { column: string; header: string }[]>>;
  sideTables?: SideTable[];
  source: { name: string; kind: SourceKind; mapping?: DatasetMapping | null; cleaning?: Record<string, unknown> | null };
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
function ident(s: string): string {
  if (!IDENT.test(s)) throw new Error(`Invalid identifier: ${s}`);
  return s;
}

/** The DROP VIEW / CREATE VIEW statements of schema.sql, re-run after extra columns are added. */
function viewStatements(schema: string): string {
  return schema
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => /^(DROP|CREATE) VIEW/i.test(s))
    .join(";\n");
}

export async function seedTables(input: SeedInput, db: Db = getDb()): Promise<SeedReport> {
  const schema = readSql("schema.sql");
  const counts: Record<string, number> = {};
  const now = nowIst();
  const version = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const extras = input.extras ?? {};
  const sideTables = input.sideTables ?? [];

  await db.tx(async (t) => {
    // Serverless instances can boot at once on an empty Postgres; serialise the seeds so they do
    // not drop tables under each other (the lock ends with the transaction).
    if (t.driver === "postgres") await t.get("SELECT pg_advisory_xact_lock(724501)");
    // Side tables of the previous upload (x_*) go first, so nothing of it survives.
    for (const name of await t.tableNames()) if (/^x_/i.test(name)) await t.exec(`DROP TABLE IF EXISTS ${ident(name.toLowerCase())}`);
    await t.exec(schema);

    for (const [table, cols] of Object.entries(extras) as [TableName, { column: string }[]][])
      for (const c of cols) await t.exec(`ALTER TABLE ${ident(table)} ADD COLUMN ${ident(c.column)} TEXT`);
    if (Object.values(extras).some((c) => c?.length)) await t.exec(viewStatements(schema));

    for (const spec of RAW_TABLES) {
      const table = spec.table as TableName;
      const cols = [...Object.keys(spec.columns), ...(extras[table] ?? []).map((e) => e.column)];
      const rows: Param[][] = (input.tables[table] ?? []).map((r, i) => [
        `${spec.prefix}-${String(i + 1).padStart(6, "0")}`,
        ...cols.map((c) => (r[c] === undefined ? null : r[c])),
      ]);
      await t.insertMany(table, ["_rid", ...cols], rows);
      counts[table] = rows.length;
    }

    for (const s of sideTables) {
      await t.exec(
        `CREATE TABLE ${ident(s.name)} (_rid TEXT NOT NULL PRIMARY KEY${s.columns.map((c) => `, ${ident(c.column)} TEXT`).join("")})`,
      );
      await t.insertMany(
        s.name,
        ["_rid", ...s.columns.map((c) => c.column)],
        s.rows.map((r, i) => [`x-${String(i + 1).padStart(6, "0")}`, ...r]),
      );
      counts[s.name] = s.rows.length;
    }

    // ---- App tables: fresh for this dataset --------------------------------------------
    const campaigns = await t.all<{ campaign_id: string; owner_name: string; owner_id: string }>(
      "SELECT campaign_id, MIN(owner_name) AS owner_name, MIN(owner_id) AS owner_id FROM campaigns GROUP BY campaign_id ORDER BY campaign_id",
    );
    // Planned budget per campaign is not in the source. Seed it as the latest approved
    // budget allocated pro-rata to each campaign's share of net ledger spend (editable).
    const spend = await t.all<{ campaign_id: string; s: number }>(
      "SELECT campaign_id, SUM(marketing_spend_inr) AS s FROM v_daily_marketing GROUP BY campaign_id",
    );
    const budgetRow = await t.get<{ marketing_budget_inr: number }>(
      "SELECT marketing_budget_inr FROM targets ORDER BY effective_at DESC LIMIT 1",
    );
    const budget = Number(budgetRow?.marketing_budget_inr ?? 0);
    const totalSpend = spend.reduce((a, r) => a + Number(r.s), 0) || 1;
    for (const c of campaigns) {
      const s = Number(spend.find((r) => r.campaign_id === c.campaign_id)?.s ?? 0);
      const planned = budget > 0 ? Math.round(((budget * s) / totalSpend) / 1000) * 1000 : null;
      await t.run(
        "INSERT INTO campaigns_meta (campaign_id, status, owner_name, owner_id, planned_budget_inr, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          c.campaign_id,
          "active",
          c.owner_name,
          c.owner_id,
          planned,
          planned === null
            ? null
            : "Seeded planned budget = latest approved budget x share of net ledger spend (assumption, editable).",
          now,
        ],
      );
    }
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      await t.run("INSERT INTO app_settings (key, value) VALUES (?, ?)", [k, JSON.stringify(v)]);
    }
    const extraFields = (Object.entries(extras) as [string, { column: string; header: string }[]][]).flatMap(([table, cols]) =>
      cols.map((c) => ({ table, column: c.column, header: c.header })),
    );
    const extraTables = sideTables.map((s) => ({ table: s.name, sheet: s.sheet, columns: s.columns.map((c) => c.column), rows: s.rows.length }));
    const meta: [string, string][] = [
      ["data_version", version],
      ["seeded_at", now],
      ["schema_version", String(SCHEMA_VERSION)],
      ["dataset_name", input.source.name],
      ["dataset_kind", input.source.kind],
      ["extra_fields", JSON.stringify(extraFields)],
      ["extra_tables", JSON.stringify(extraTables)],
    ];
    for (const [k, v] of meta) await t.run("INSERT INTO app_meta (key, value) VALUES (?, ?)", [k, v]);
    await t.run("INSERT INTO chat_sessions (id, title, created_at) VALUES (?, ?, ?)", ["default", "Growth analyst", now]);
    await t.run(
      "INSERT INTO data_edits (id, at, table_name, row_ref, action, detail) VALUES (?, ?, ?, ?, ?, ?)",
      [
        `seed-${version}`,
        now,
        "*",
        null,
        input.source.kind === "upload" ? "import" : "reset",
        `Imported ${input.source.name}${input.source.kind === "upload" ? " (uploaded)" : ""}`,
      ],
    );

    // Postgres only (Supabase exposes the public schema over its REST API): row-level security on
    // with no policies, so only the app's own connection (the table owner) can read or write.
    if (t.driver === "postgres")
      for (const name of await t.tableNames()) await t.exec(`ALTER TABLE ${ident(name.toLowerCase())} ENABLE ROW LEVEL SECURITY`);

    await t.run("UPDATE dataset_versions SET is_active = 0 WHERE is_active = 1");
    await t.run(
      `INSERT INTO dataset_versions (id, data_version, source_name, source_kind, imported_at, row_counts, mapping, cleaning, schema_version, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        `dv-${version}`,
        version,
        input.source.name,
        input.source.kind,
        now,
        JSON.stringify(counts),
        input.source.mapping ? JSON.stringify(input.source.mapping) : null,
        input.source.cleaning ? JSON.stringify(input.source.cleaning) : null,
        SCHEMA_VERSION,
      ],
    );
  });

  return { dataset: input.source.name, counts };
}

/** Import the original workbook exactly as given (duplicates kept; read-time rules dedupe). */
export async function seedDatabase(kind: SourceKind = "original"): Promise<SeedReport> {
  const file = datasetPath();
  if (!fs.existsSync(file)) throw new Error(`Dataset not found at ${file}. Set DATASET_PATH.`);
  const sheets = await parseXlsx(path.basename(file), fs.readFileSync(file));
  const mapping = fastPathMapping(sheets);
  if (!mapping) throw new Error(`${file} is not in the expected workbook layout (sheets ${RAW_TABLES.map((s) => s.sheet).join(", ")}).`);
  const { tables: applied, sideTables } = applyMapping(sheets, mapping);
  const tables = {} as Record<TableName, Row[]>;
  for (const t of TABLE_NAMES) {
    const a = applied[t];
    if (!a) throw new Error(`Sheet for "${t}" missing from ${file}`);
    if (a.badCells) throw new Error(`${a.badCells} unreadable values in sheet "${a.sources[0]}" (rows ${a.badRows.slice(0, 5).join(", ")}).`);
    tables[t] = a.rows;
  }
  const extras = Object.fromEntries(TABLE_NAMES.filter((t) => applied[t]!.extras.length).map((t) => [t, applied[t]!.extras]));
  const report = await seedTables({ tables, extras, sideTables, source: { name: path.basename(file), kind } });
  return { ...report, dataset: file };
}

// Migrations run once per connection (tests switch databases by reopening the connection).
const checked = new WeakSet<Db>();

/** Make sure the DB exists (seed it on first use so a fresh clone just works) and is migrated. */
export async function ensureSeeded(): Promise<void> {
  const db = getDb();
  try {
    await db.get("SELECT value FROM app_meta WHERE key = 'data_version'");
  } catch {
    await seedDatabase("original");
    checked.add(db);
    return;
  }
  if (!checked.has(db)) {
    await migrate(db);
    checked.add(db);
  }
}
