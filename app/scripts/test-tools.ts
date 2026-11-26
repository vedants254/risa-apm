/**
 * npm run test:tools — exercises every copilot tool directly (no LLM key needed), the SQL
 * guard, the calculator, confirm-gating, and live recomputation after a data edit.
 * Runs against a temporary copy of data/growth.db so the dev database is untouched.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const src = path.join(process.cwd(), "data", "growth.db");
if (!fs.existsSync(src)) {
  console.error("data/growth.db not found. Run `npm run seed` first.");
  process.exit(1);
}
const tmp = path.join(os.tmpdir(), `growth-test-${Date.now()}.db`);
fs.copyFileSync(src, tmp);
process.env.SQLITE_PATH = tmp;
process.env.DB_DRIVER = "sqlite";

let failures = 0;
let passes = 0;
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) {
    passes++;
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
  }
}

(async () => {
  const { TOOL_DEFS, safeRunTool, guardSql } = await import("../lib/tools");
  const { closeDb } = await import("../lib/db");
  const repo = await import("../lib/repo");
  const ctx = { date: "2025-04-13" };
  const run = (n: string, a: Record<string, unknown> = {}) => safeRunTool(n, a, ctx);

  console.log("Tool smoke tests");
  const sample: Record<string, Record<string, unknown>> = {
    get_overview: {},
    get_funnel: { campaign_id: "C02" },
    compare_campaigns: { metric: "cac_per_visitor_inr" },
    get_trend: { metric: "registered_external", from: "2025-03-01", to: "2025-04-13" },
    get_targets: { date: "2025-03-20" },
    get_budget: {},
    diagnose: {},
    get_recommendations: {},
    simulate_reallocation: { from_campaign_id: "C03", to_campaign_id: "C05", pct: 0.2 },
    what_changed: { from: "2025-03-14", to: "2025-03-15" },
    list_campaigns: {},
    list_tasks: {},
    propose_task: { title: "Pause Creator Partners", campaign_id: "C03", priority: "high" },
    propose_campaign_update: { campaign_id: "C03", status: "paused" },
    query_data: { sql: "SELECT campaign_id, COUNT(*) AS n FROM v_registrations GROUP BY campaign_id" },
    calculate: { expression: "(93000 - 61000) / 2" },
    get_engagement: { campaign_id: "C07" },
    get_data_quality: {},
  };
  for (const t of TOOL_DEFS) {
    const out = await run(t.function.name, sample[t.function.name] ?? {});
    check(`${t.function.name} runs`, !out.error, out.error);
  }

  console.log("Values");
  const ov = (await run("get_overview")).result as { totals: { verified_visitors: number; registered_external: number } };
  check("overview has visitors and registrations", ov.totals.verified_visitors > 0 && ov.totals.registered_external > 0, ov.totals);
  const tg = (await run("get_targets", { date: "2025-03-14" })).result as { target_version: string };
  const tg2 = (await run("get_targets", { date: "2025-03-15" })).result as { target_version: string };
  check("target version switches on 2025-03-15", tg.target_version !== tg2.target_version, [tg.target_version, tg2.target_version]);
  const pre = (await run("get_overview", { date: "2025-03-01" })).result as { totals: { verified_visitors: number } };
  check("no visitors before the event (no future leakage)", pre.totals.verified_visitors === 0);
  const calc = (await run("calculate", { expression: "round(276500/2050, 2)" })).result as { value: number };
  check("calculate exact", calc.value === 134.88, calc);
  const bad = await run("calculate", { expression: "process.exit(1)" });
  check("calculate rejects code", Boolean(bad.error));

  console.log("SQL guard");
  const rejects = [
    "DELETE FROM tasks",
    "SELECT * FROM tasks; DROP TABLE tasks",
    "SELECT * FROM sqlite_master",
    "SELECT * FROM chat_messages",
    "SELECT * FROM app_settings",
    "WITH x AS (SELECT 1) UPDATE tasks SET title='x'",
    "PRAGMA table_info(tasks)",
    "SELECT * FROM v_people p, chat_messages c",
    "ATTACH DATABASE 'x.db' AS x",
  ];
  for (const q of rejects) {
    let threw = false;
    try {
      guardSql(q);
    } catch {
      threw = true;
    }
    check(`rejects: ${q}`, threw);
  }
  const accepts = [
    "SELECT COUNT(*) FROM v_checkins WHERE result = 'admitted'",
    "WITH r AS (SELECT * FROM v_registrations) SELECT campaign_id, COUNT(*) FROM r GROUP BY campaign_id",
    "SELECT p.person_type, COUNT(*) FROM v_people p JOIN v_checkins c ON c.person_id = p.person_id GROUP BY p.person_type",
  ];
  for (const q of accepts) {
    let ok = true;
    try {
      guardSql(q);
    } catch (e) {
      ok = false;
      console.log("   ", (e as Error).message);
    }
    check(`accepts: ${q.slice(0, 60)}`, ok);
  }
  const lim = (await run("query_data", { sql: "SELECT * FROM v_interactions" })).result as { row_count: number; truncated: boolean };
  check("row limit 200 enforced", lim.row_count === 200 && lim.truncated, lim);

  console.log("Confirm gating");
  const before = (await repo.listTasks()).length;
  const prop = await run("propose_task", { title: "Pause Creator Partners", campaign_id: "C03" });
  const after = (await repo.listTasks()).length;
  check("propose_task returns a draft", prop.proposal?.kind === "task");
  check("propose_task does not create a task", before === after, { before, after });
  check("owner defaults to campaign owner", (prop.proposal?.draft as { owner_name: string }).owner_name === "Nisha Rao", prop.proposal?.draft);

  console.log("Live recomputation after data edits");
  const spend0 = ((await run("get_budget")).result as { spend_to_date_inr: number }).spend_to_date_inr;
  const row = (await repo.insertRow("daily_marketing", {
    campaign_id: "C02",
    activity_date: "2025-04-10",
    marketing_spend_inr: 10000,
    clicks: 100,
  })) as { _rid: string };
  const spend1 = ((await run("get_budget")).result as { spend_to_date_inr: number }).spend_to_date_inr;
  check("added spend row changes spend by +10000", spend1 - spend0 === 10000, { spend0, spend1 });
  await repo.deleteRow("daily_marketing", row._rid);
  const spend2 = ((await run("get_budget")).result as { spend_to_date_inr: number }).spend_to_date_inr;
  check("deleting the row restores spend", spend2 === spend0, { spend0, spend2 });
  await repo.updateSettings("thresholds", { stop_cac_ratio: 10, stop_showup_ratio: 0 });
  const recs = (await run("get_recommendations")).result as { recommendations: { action: string }[] };
  check("editable thresholds change recommendations (no stops at 10x)", !recs.recommendations.some((r) => r.action === "stop"));

  await closeDb();
  fs.rmSync(tmp, { force: true });
  for (const ext of ["-wal", "-shm"]) fs.rmSync(tmp + ext, { force: true });
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
