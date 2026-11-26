/** npm run seed: (re)create the schema and import the source workbook. */
import { closeDb, dbDriver, sqlitePath } from "../lib/db";
import { seedDatabase } from "../lib/seed";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* optional */
}

const started = Date.now();
seedDatabase()
  .then(async (r) => {
    console.log(`Seeded ${dbDriver() === "sqlite" ? sqlitePath() : "postgres"} from ${r.dataset}`);
    for (const [t, n] of Object.entries(r.counts)) console.log(`  ${t.padEnd(22)} ${n} rows (raw, duplicates kept)`);
    console.log(`Done in ${Date.now() - started} ms`);
    await closeDb();
  })
  .catch(async (e) => {
    console.error("Seed failed:", e instanceof Error ? e.message : e);
    await closeDb();
    process.exit(1);
  });
