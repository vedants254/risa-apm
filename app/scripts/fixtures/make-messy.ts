/**
 * Builds the "messy" fixture from the original workbook: one CSV per table with renamed columns,
 * DD/MM/YYYY dates, ₹-formatted amounts with (500) credits, "Yes"/"Attendee"/"Staff"-style values,
 * campaign names instead of IDs, extra exact duplicate rows, an extra City column, and campaigns
 * renamed ("… B", IDs K01…) so a leakage test can tell the two datasets apart.
 *
 *   npx tsx scripts/fixtures/make-messy.ts <out-dir>
 *
 * scripts/fixtures/messy-mapping.json is the hand-written mapping for these files.
 */
import fs from "node:fs";
import path from "node:path";
import { parseXlsx } from "../../lib/dataset/parse";
import { normalizeTs } from "../../lib/dataset/schema";
import { datasetPath } from "../../lib/seed";

type Rec = Record<string, unknown>;
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function writeCsv(file: string, headers: string[], rows: unknown[][]) {
  fs.writeFileSync(file, [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n", "utf8");
}
/** 2025-04-12 15:21:35 → 12/04/2025 15:21:35 (date only for "date" columns). */
function dmy(v: unknown, withTime = true): string {
  const s = normalizeTs(v, "ts");
  if (!s) return "";
  const [d, t] = s.split(" ");
  const [y, m, dd] = d.split("-");
  return withTime ? `${dd}/${m}/${y} ${t}` : `${dd}/${m}/${y}`;
}
const rupees = (n: unknown) => {
  if (n === null || n === undefined || n === "") return "";
  const x = Number(n);
  const s = `₹${Math.abs(x).toLocaleString("en-IN")}`;
  return x < 0 ? `(${s})` : s;
};

export const renameId = (id: string) => (id ? `K${id.slice(1)}` : id);
export const renameName = (n: string) => (n ? `${n} B` : n);

export async function makeMessyFixture(outDir: string): Promise<string[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const file = datasetPath();
  const sheets = await parseXlsx(path.basename(file), fs.readFileSync(file));
  const rows = (name: string): Rec[] => {
    const s = sheets.find((x) => x.name === name)!;
    return s.rows.map((r) => Object.fromEntries(s.headers.map((h, i) => [h, r[i]])));
  };
  const nm = (v: unknown) => renameName(String(v ?? ""));
  const written: string[] = [];
  const out = (name: string, headers: string[], data: unknown[][]) => {
    const p = path.join(outDir, `${name}.csv`);
    writeCsv(p, headers, data);
    written.push(p);
  };

  const ev = rows("Event");
  out(
    "event",
    ["Name", "Data From", "Data To", "Opens", "Closes", "Timezone", "Currency"],
    ev.map((r) => ["CampusFest B", dmy(r.history_start, false), dmy(r.history_end, false), dmy(r.event_starts_at), dmy(r.event_ends_at), r.timezone, r.currency]),
  );
  out(
    "targets",
    ["Effective", "People Goal", "Registration Goal", "Visitor Goal", "Budget", "Plan"],
    rows("Targets").map((r) => [dmy(r.effective_at), r.identified_external_people_goal, r.registration_goal, r.unique_external_visitors_goal, rupees(r.marketing_budget_inr), r.target_version]),
  );
  out(
    "campaigns_export",
    ["Campaign", "Channel", "Audience", "Objective", "Owner", "Created", "Start", "End", "Campaign Code"],
    rows("Campaigns").map((r) => [nm(r.campaign_name), r.channel, r.target_audience, r.objective, r.owner_name, dmy(r.created_at), dmy(r.planned_start_at), dmy(r.planned_end_at), renameId(String(r.campaign_id))]),
  );
  const daily = rows("Daily Marketing").map((r) => [
    dmy(r.activity_date, false),
    nm(r.campaign_name),
    r.impressions,
    r.clicks,
    r.reported_reach,
    r.landing_page_sessions,
    r.registration_starts,
    rupees(r.marketing_spend_inr),
    r.platform,
    String(r.activity_id).replace(/-C(\d+)-/, "-K$1-"),
  ]);
  const dailyHeaders = ["Date", "Campaign", "Impressions", "Clicks", "Reach", "Sessions", "Form Starts", "Spend (Rs)", "Source", "Record ID"];
  const half = Math.floor(daily.length / 2);
  // Part 2 repeats three rows of part 1 exactly (an export overlap).
  out("daily_spend_part1", dailyHeaders, daily.slice(0, half));
  out("daily_spend_part2", dailyHeaders, [...daily.slice(half), ...daily.slice(0, 3)]);

  const TYPE: Record<string, string> = { external: "Attendee", internal: "Internal", staff: "Staff", test: "Test" };
  const people = rows("People").map((r, i) => [
    r.person_name,
    TYPE[String(r.person_type)] ?? r.person_type,
    dmy(r.first_seen_at),
    r.first_touch_source,
    r.first_campaign_name ? nm(r.first_campaign_name) : "",
    r.person_id,
    ["Pune", "Mumbai", "Delhi", "Bengaluru"][i % 4],
  ]);
  out("people", ["Name", "Type", "First Seen", "Came From", "First Campaign", "Person ID", "City"], [...people, people[0], people[1]]);
  out(
    "engagement",
    ["Person ID", "Campaign", "When", "Action", "Detail", "Interaction ID"],
    rows("Interest and Engagement").map((r) => [r.person_id, r.campaign_name ? nm(r.campaign_name) : "", dmy(r.occurred_at), r.event_type, r.detail, r.interaction_id]),
  );
  out(
    "registrations",
    ["Registration ID", "Person ID", "Campaign", "Registered On"],
    rows("Registrations").map((r) => [r.registration_id, r.person_id, r.campaign_name ? nm(r.campaign_name) : "", dmy(r.registered_at)]),
  );
  const STATUS: Record<string, string> = { interested: "Interested", confirmed: "Confirmed", cancelled: "Cancelled", waitlisted: "On waitlist" };
  out(
    "status_history",
    ["History ID", "Registration ID", "Status", "Effective"],
    rows("Registration History").map((r) => [r.history_id, r.registration_id, STATUS[String(r.status)] ?? r.status, dmy(r.effective_at)]),
  );
  const RESULT: Record<string, string> = { admitted: "Yes", denied: "No", pending: "Pending" };
  out(
    "checkins",
    ["Check-in ID", "Person ID", "Registration ID", "Campaign", "Time", "Attended", "Verified", "Method"],
    rows("Check-ins").map((r) => [
      r.event_id,
      r.person_id,
      r.registration_id ?? "",
      r.campaign_name ? nm(r.campaign_name) : "",
      dmy(r.occurred_at),
      RESULT[String(r.result)] ?? r.result,
      r.verification === "verified" ? "Y" : "N",
      r.source === "scanner" ? "Scan" : "Manual",
    ]),
  );
  return written;
}

if (process.argv[1] && /make-messy\.ts$/.test(process.argv[1])) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: npx tsx scripts/fixtures/make-messy.ts <out-dir>");
    process.exit(1);
  }
  makeMessyFixture(path.resolve(dir)).then((files) => console.log(`Wrote ${files.length} files to ${path.resolve(dir)}`));
}
