/**
 * npm run test:dataset — the bring-your-own-dataset pipeline without any live model call:
 *   1. the original workbook takes the fast path, and its cleaned import gives the same metrics;
 *   2. a messy CSV export (renamed columns, DD/MM dates, ₹ amounts, "Yes"/"Attendee" values,
 *      duplicates, names instead of IDs) with a hand-written mapping reproduces the original metrics;
 *   3. the model path: invalid JSON is retried once, a second failure gives an actionable error;
 *   4. a sponsor workbook is refused (no daily spend, no registrations);
 *   5. no leakage: after importing B over A, nothing of A is left in any table, app state is fresh,
 *      and the analyst's prompt and query schema only mention B;
 *   6. schema versioning: a fresh database and a version-1 database both end at the current version
 *      with exactly one active dataset_versions row.
 * Every database is a temporary SQLite file.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_DRIVER = "sqlite";
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "growth-dataset-"));
let dbN = 0;

let fails = 0;
let passes = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) passes++;
  else fails++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${!cond && detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
};

(async () => {
  const { closeDb, getDb } = await import("../lib/db");
  const { seedDatabase, seedTables, datasetPath, ensureSeeded } = await import("../lib/seed");
  const { parseFiles, parseXlsx } = await import("../lib/dataset/parse");
  const { fastPathMapping, validateMapping } = await import("../lib/dataset/mapping");
  const { buildDataset } = await import("../lib/dataset/pipeline");
  const { proposeMapping } = await import("../lib/dataset/ai");
  const { setLlmOverride } = await import("../lib/llm");
  const { loadData, computeSnapshot } = await import("../lib/metrics");
  const { SCHEMA_VERSION } = await import("../lib/schema-version");
  const { DEFAULT_SETTINGS } = await import("../lib/settings");
  const { makeMessyFixture, renameId } = await import("./fixtures/make-messy");

  /** Point the app at a fresh temporary database. */
  const useDb = async () => {
    await closeDb();
    process.env.SQLITE_PATH = path.join(tmpRoot, `db-${++dbN}.db`);
  };
  type Snap = ReturnType<typeof computeSnapshot>;
  const snapAt = async (d: string): Promise<Snap> => computeSnapshot(await loadData(), d);
  const DATES = ["2025-03-29", "2025-04-13", "2025-04-20"];
  const TOTALS = [
    "identified_external",
    "registered_external",
    "verified_visitors",
    "verified_visitors_registered",
    "verified_walkins",
    "marketing_spend_inr",
    "impressions",
    "clicks",
    "landing_page_sessions",
    "registration_starts",
    "reported_reach_sum",
    "confirmed_at_event_start",
  ] as const;
  const sameMetrics = (a: Snap, b: Snap, mapId: (id: string) => string = (x) => x) => {
    const diffs: string[] = [];
    for (const k of TOTALS) if (a.totals[k] !== b.totals[k]) diffs.push(`${k}: ${a.totals[k]} vs ${b.totals[k]}`);
    if (JSON.stringify(a.totals.status_counts) !== JSON.stringify(b.totals.status_counts)) diffs.push("status_counts");
    if (JSON.stringify(a.targets) !== JSON.stringify(b.targets)) diffs.push("targets");
    for (const [id, c] of Object.entries(a.by_campaign)) {
      const o = b.by_campaign[mapId(id)];
      if (!o) diffs.push(`campaign ${id} missing`);
      else for (const k of ["spend_inr", "registered_external", "verified_visitors", "identified_external"] as const) if (c[k] !== o[k]) diffs.push(`${id}.${k}: ${c[k]} vs ${o[k]}`);
    }
    return diffs;
  };

  // ---- 1. Original workbook ---------------------------------------------------------------
  console.log("Original workbook");
  await useDb();
  await seedDatabase("original");
  const orig: Record<string, Snap> = {};
  for (const d of DATES) orig[d] = await snapAt(d);
  check("registrations at 2025-03-29 = 2,243", orig["2025-03-29"].totals.registered_external === 2243, orig["2025-03-29"].totals.registered_external);
  check("verified visitors at 2025-04-20 = 2,050", orig["2025-04-20"].totals.verified_visitors === 2050, orig["2025-04-20"].totals.verified_visitors);
  check("registrations at 2025-04-20 = 2,800", orig["2025-04-20"].totals.registered_external === 2800, orig["2025-04-20"].totals.registered_external);

  const wb = await parseXlsx("Attendee_Dataset.xlsx", fs.readFileSync(datasetPath()));
  const fast = fastPathMapping(wb);
  check("original workbook takes the fast path (no model call)", !!fast);
  const builtOrig = buildDataset(wb, fast!, "Attendee Dataset");
  check("no blocking problems", builtOrig.blocking.length === 0, builtOrig.blocking);
  check("cleaning removes the 26 import copies", builtOrig.clean.report.duplicates_removed === 26, builtOrig.clean.report);
  check("60 internal, staff or test people kept out of goals", builtOrig.clean.report.non_external_people === 60, builtOrig.clean.report.non_external_people);
  await useDb();
  await seedTables({ tables: builtOrig.clean.tables, extras: builtOrig.clean.extras, sideTables: builtOrig.sideTables, source: { name: "Attendee_Dataset.xlsx", kind: "upload" } });
  for (const d of DATES) {
    const diffs = sameMetrics(orig[d], await snapAt(d));
    check(`cleaned upload of the original matches at ${d}`, diffs.length === 0, diffs);
  }

  // ---- 2. Messy CSV export with a hand-written mapping -------------------------------------
  console.log("Messy CSV fixture");
  const fixDir = path.join(tmpRoot, "messy");
  const csvs = await makeMessyFixture(fixDir);
  const sheets = await parseFiles(csvs.map((f) => ({ name: path.basename(f), buf: fs.readFileSync(f) })));
  check("messy files do not take the fast path", fastPathMapping(sheets) === null);
  const rawMapping = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts", "fixtures", "messy-mapping.json"), "utf8"));
  const v = validateMapping(rawMapping, sheets);
  check("hand-written mapping validates", !!v.mapping, v.errors);
  const builtMessy = buildDataset(sheets, v.mapping!, "messy");
  check("messy data has no blocking problems", builtMessy.blocking.length === 0, builtMessy.blocking);
  check("unreadable cells: none", builtMessy.clean.report.unreadable_cells === 0, builtMessy.clean.report);
  check("unknown categorical values: none", builtMessy.clean.report.unknown_values === 0, builtMessy.clean.report.log.slice(0, 5));
  check("City kept as an extra people column", builtMessy.clean.extras.people?.some((e) => e.column === "x_city"), builtMessy.clean.extras);
  const spend = builtMessy.clean.tables.daily_marketing.find((r) => (r.marketing_spend_inr as number) < 0);
  check("(₹500)-style credits parse as negative spend", !!spend, spend);
  check("DD/MM/YYYY dates parsed to ISO", builtMessy.clean.tables.checkins.every((r) => /^2025-04-1[23] /.test(String(r.occurred_at))));
  check("campaign IDs linked from names on daily rows", builtMessy.clean.tables.daily_marketing.every((r) => /^K\d\d$/.test(String(r.campaign_id))));
  await useDb();
  await seedTables({ tables: builtMessy.clean.tables, extras: builtMessy.clean.extras, sideTables: builtMessy.sideTables, source: { name: "messy", kind: "upload" } });
  for (const d of DATES) {
    const diffs = sameMetrics(orig[d], await snapAt(d), renameId);
    check(`messy import reproduces the original metrics at ${d}`, diffs.length === 0, diffs);
  }

  // ---- 3. Model path with a scripted provider -----------------------------------------------
  console.log("Model mapping (scripted, no network)");
  let calls = 0;
  const scripted = (replies: string[]) => ({
    name: "Scripted",
    model: "scripted",
    configured: true,
    missingKeyMessage: "",
    async chat() {
      return { message: { role: "assistant" as const, content: replies[Math.min(calls++, replies.length - 1)] } };
    },
  });
  setLlmOverride(scripted(["not json at all", JSON.stringify(rawMapping)]));
  const p = await proposeMapping(sheets);
  check("invalid reply is retried once, then accepted", p.calls === 2 && calls === 2, { calls: p.calls });
  calls = 0;
  setLlmOverride(scripted([JSON.stringify({ tables: { nonsense: {} } })]));
  let err = "";
  try {
    await proposeMapping(sheets);
  } catch (e) {
    err = (e as Error).message;
  }
  check("two invalid replies give an actionable error", calls === 2 && /could not produce a usable mapping/.test(err) && /Unknown table "nonsense"/.test(err), err);
  setLlmOverride(undefined);
  err = "";
  try {
    await proposeMapping(sheets);
  } catch (e) {
    err = (e as Error).message;
  }
  check("no API key: clear message instead of a crash", /OPENAI_API_KEY/.test(err), err);

  // ---- 4. Sponsor workbook is refused --------------------------------------------------------
  console.log("Sponsor workbook");
  const sponsorPath = path.resolve(process.cwd(), "..", "dataset", "Sponsor_Dataset.xlsx");
  if (fs.existsSync(sponsorPath)) {
    const sp = await parseXlsx("Sponsor_Dataset.xlsx", fs.readFileSync(sponsorPath));
    check("sponsor workbook does not take the fast path", fastPathMapping(sp) === null);
    const m = validateMapping(
      {
        tables: { campaigns: { source: "Sponsor campaigns", columns: { campaign_name: "campaign_name", campaign_id: "sponsor_campaign_id", channel: "channel" } } },
        can_import: false,
        reason: "The file has sponsor campaigns but no daily spend or attendee registrations.",
      },
      sp,
    );
    const b = buildDataset(sp, m.mapping!, "sponsor");
    check("sponsor data is blocked with a reason", b.blocking.some((x) => /daily marketing spend/.test(x)), b.blocking);
  } else console.log("  (Sponsor_Dataset.xlsx not found; skipped)");

  // ---- 5. No leakage from A into B -----------------------------------------------------------
  console.log("No leakage between datasets");
  await useDb();
  await seedDatabase("original"); // dataset A
  const repo = await import("../lib/repo");
  const A = await loadData();
  const aIds = new Set(A.campaigns.map((c) => c.campaign_id));
  const aNames = new Set(A.campaigns.map((c) => c.campaign_name));
  await repo.createTask({ title: `Follow up ${A.campaigns[0].campaign_name}`, campaign_id: A.campaigns[0].campaign_id });
  await repo.createAction({ kind: "stop", description: `Stop ${A.campaigns[1].campaign_name}`, campaign_id: A.campaigns[1].campaign_id });
  await repo.appendChat("default", { role: "user", content: `How is ${A.campaigns[2].campaign_name}?`, tool_calls: null, tool_call_id: null, name: null, meta: null });
  await repo.updateSettings("thresholds", { min_volume: 5 });
  await seedTables({ tables: builtMessy.clean.tables, extras: builtMessy.clean.extras, sideTables: builtMessy.sideTables, source: { name: "messy B", kind: "upload", mapping: v.mapping } });
  const db = getDb();
  const leaks: string[] = [];
  for (const t of await db.tableNames()) {
    if (t === "dataset_versions") continue; // metadata history only (file names, counts)
    for (const r of await db.all(`SELECT * FROM ${t}`))
      for (const [k, val] of Object.entries(r)) if (typeof val === "string" && (aIds.has(val) || aNames.has(val))) leaks.push(`${t}.${k}=${val}`);
  }
  check("no A campaign id or name in any table", leaks.length === 0, leaks.slice(0, 5));
  const tables = await db.tableNames();
  check("A's side tables (Read me, Field guide) are gone", !tables.some((t) => /^x_(read_me|field_guide)/.test(t)), tables);
  for (const t of ["tasks", "action_items", "chat_messages"]) {
    const n = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))!.n;
    check(`${t} is empty after the import`, Number(n) === 0, n);
  }
  const settings = await db.all<{ key: string; value: string }>("SELECT key, value FROM app_settings");
  check("settings are back at their defaults", settings.every((s) => JSON.stringify(JSON.parse(s.value)) === JSON.stringify(DEFAULT_SETTINGS[s.key as keyof typeof DEFAULT_SETTINGS])), settings);
  const edits = await db.all<{ detail: string }>("SELECT detail FROM data_edits");
  check("change log starts fresh with one import entry", edits.length === 1 && /Imported messy B/.test(edits[0].detail), edits);
  const B = await loadData();
  check("loadData returns only B's campaigns", B.campaigns.length > 0 && B.campaigns.every((c) => /^K\d\d$/.test(c.campaign_id)), B.campaigns.map((c) => c.campaign_id));
  const active = await db.all<{ source_name: string; data_version: string }>("SELECT source_name, data_version FROM dataset_versions WHERE is_active = 1");
  const meta = await db.get<{ value: string }>("SELECT value FROM app_meta WHERE key = 'data_version'");
  check("exactly one active dataset_versions row, and it is B", active.length === 1 && active[0].source_name === "messy B", active);
  check("app_meta.data_version equals the active row's", active[0]?.data_version === meta?.value, [active[0]?.data_version, meta?.value]);
  check("dataset history kept (A then B)", Number((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM dataset_versions"))!.n) === 2);
  await repo.bumpVersion();
  const after = await db.all<{ data_version: string }>("SELECT data_version FROM dataset_versions WHERE is_active = 1");
  const meta2 = await db.get<{ value: string }>("SELECT value FROM app_meta WHERE key = 'data_version'");
  check("an edit keeps app_meta.data_version and the active row in step", after[0]?.data_version === meta2?.value);
  const { systemPrompt } = await import("../lib/copilot");
  const { toolDefs } = await import("../lib/tools");
  const prompt = await systemPrompt("2025-04-13");
  const qd = (await toolDefs()).find((t) => t.function.name === "query_data")!.function.description;
  check("system prompt names only B's campaigns", [...aNames].every((n) => !prompt.includes(`${n} (`) && !prompt.includes(` ${n};`)) && prompt.includes("Campus Ambassadors B"), prompt.slice(0, 400));
  check("system prompt lists B's extra field (people.x_city)", prompt.includes("people.x_city"), prompt.slice(-600));
  check("query_data schema comes from B (x_city, no A side tables)", qd.includes("x_city") && !qd.includes("x_read_me"), qd.slice(-500));

  // ---- 6. Schema versioning ------------------------------------------------------------------
  console.log("Schema versioning");
  await useDb();
  await ensureSeeded(); // fresh database: schema.sql + seed
  const fresh = await getDb().get<{ value: string }>("SELECT value FROM app_meta WHERE key = 'schema_version'");
  check(`fresh database is at schema version ${SCHEMA_VERSION}`, Number(fresh?.value) === SCHEMA_VERSION, fresh);
  await useDb();
  // A version-1 database: the original schema and a seeded app_meta, no dataset_versions.
  await getDb().exec(fs.readFileSync(path.join(process.cwd(), "db", "migrations", "001_initial.sql"), "utf8"));
  await getDb().run("INSERT INTO app_meta (key, value) VALUES ('data_version', 'v1-version'), ('seeded_at', '2025-01-01 00:00:00')");
  await getDb().run("INSERT INTO campaigns (_rid, campaign_id, campaign_name) VALUES ('cp-1', 'C01', 'Old')");
  await ensureSeeded(); // migrates
  const v1 = await getDb().get<{ value: string }>("SELECT value FROM app_meta WHERE key = 'schema_version'");
  check(`version-1 database migrates to ${SCHEMA_VERSION}`, Number(v1?.value) === SCHEMA_VERSION, v1);
  const dv = await getDb().all<{ data_version: string; is_active: number }>("SELECT data_version, is_active FROM dataset_versions");
  check("migration records one active dataset row with the existing data_version", dv.length === 1 && Number(dv[0].is_active) === 1 && dv[0].data_version === "v1-version", dv);
  check("migration keeps the existing rows", (await getDb().all("SELECT * FROM campaigns")).length === 1);
  check("dataset_uploads exists after migration", (await getDb().tableNames()).includes("dataset_uploads"));

  await closeDb();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
