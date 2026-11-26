/**
 * npm run test:golden — compares lib/metrics.ts against analysis/golden_metrics.json
 * (written independently by the analysis workstream's Python reference implementation).
 * Runs on a temporary copy of a freshly seeded DB so local edits don't affect the result.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const goldenPath = process.env.GOLDEN_PATH || path.resolve(process.cwd(), "..", "analysis", "golden_metrics.json");
if (!fs.existsSync(goldenPath)) {
  console.log(`Golden file not found at ${goldenPath}; skipping.`);
  process.exit(0);
}
process.env.SQLITE_PATH = path.join(os.tmpdir(), `growth-golden-${Date.now()}.db`);
process.env.DB_DRIVER = "sqlite";

type J = null | number | string | boolean | J[] | { [k: string]: J };

function diff(expected: J, actual: J, p: string, out: string[]) {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
      out.push(`${p}: expected object, got ${JSON.stringify(actual)}`);
      return;
    }
    for (const k of Object.keys(expected)) diff(expected[k], (actual as Record<string, J>)[k] ?? null, `${p}.${k}`, out);
    return;
  }
  if (typeof expected === "number" && typeof actual === "number") {
    if (Math.abs(expected - actual) > 1e-9) out.push(`${p}: expected ${expected}, got ${actual}`);
    return;
  }
  if (expected !== actual) out.push(`${p}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

(async () => {
  const { seedDatabase } = await import("../lib/seed");
  const { getGoldenSnapshot } = await import("../lib/metrics");
  const { closeDb } = await import("../lib/db");
  await seedDatabase();
  const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8").replace(/\bNaN\b/g, "null"));
  const snaps: Record<string, J> = golden.snapshots ?? golden;
  let fail = 0;
  let checked = 0;
  for (const [date, expected] of Object.entries(snaps)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const actual = (await getGoldenSnapshot(date)) as unknown as J;
    const out: string[] = [];
    diff(expected, actual, date, out);
    checked++;
    if (out.length) {
      fail += out.length;
      console.log(`FAIL ${date} (${out.length} differences)`);
      for (const line of out.slice(0, 40)) console.log("   ", line);
    } else console.log(`ok   ${date}`);
  }
  await closeDb();
  for (const ext of ["", "-wal", "-shm"]) fs.rmSync(process.env.SQLITE_PATH + ext, { force: true });
  console.log(`\n${checked} snapshot dates checked against ${path.relative(process.cwd(), goldenPath)}: ${fail ? `${fail} differences` : "all values match"}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
