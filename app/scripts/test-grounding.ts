/**
 * npm run test:grounding — unit tests for lib/grounding.ts (the copilot's numeric grounding check).
 * Pure functions, no DB or key needed.
 */
import { extractClaims, findUngroundedNumbers } from "../lib/grounding";

let fails = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${!cond && detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
  if (!cond) fails++;
};
const none = (name: string, answer: string, evidence: string[], user = "") => {
  const bad = findUngroundedNumbers(answer, evidence, user);
  check(name, bad.length === 0, bad);
};
const flags = (name: string, answer: string, evidence: string[], expected: string[], user = "") => {
  const bad = findUngroundedNumbers(answer, evidence, user);
  check(name, JSON.stringify(bad) === JSON.stringify(expected), bad);
};

const tool = JSON.stringify({
  campaign_name: "Paid Social",
  spend_inr: 48800,
  registrations: 271,
  cost_per_registration: 180.0738,
  median_cost_per_registration: 214.2,
  show_up_rate: 0.7009,
  ratio_to_median: 0.8406,
  total_spend: 274000,
  identified: 115399,
  visitors: 2243,
  efficiency: 2.2187,
});

console.log("Grounded answers pass");
none("rounded rupees (₹180 from 180.0738)", "Paid Social costs ₹180 per registration against a median of ₹214.", [tool]);
none("percent from fraction (70.1% from 0.7009)", "Its show-up rate is 70.1%.", [tool]);
none("percent at lower precision (70%)", "About 70% of registrants show up.", [tool]);
none("lakh forms (₹2.74L, ₹2.74 lakh)", "Total spend is ₹2.74L (₹2.74 lakh).", [tool]);
none("ratio with × and x (0.84×, 2.22x)", "It runs at 0.84× the median; efficiency is 2.22x.", [tool]);
none("Indian and Western grouping (1,15,399 / 2,243)", "There are 1,15,399 identified people and 2,243 verified visitors.", [tool]);
none("whole-rupee spend with grouping (₹48,800)", "₹48,800 spend ÷ 271 registrations = ₹180 per registration.", [tool]);
none("k suffix (48.8k)", "Spend so far is 48.8k.", [tool]);
none("calculate output grounds a derived number", "Registrations would rise to 312.", [tool, JSON.stringify({ expression: "48800/156.4", value: 312.0204, rounded: 312.0204 })]);
none("user's own numbers are evidence", "Moving 20% of the budget (₹9,760) is an estimate.", [JSON.stringify({ moved_inr: 9760 })], "What if we move 20% of it?");
none("fraction from a percent in evidence", "That is a share of 0.25.", [], "assume 25% uplift");
none("negative values compare by size", "Visitors fall by 12.5%.", [JSON.stringify({ change_pct: -12.5 })]);

console.log("Dates, labels and counts are ignored");
none("ISO date and day-month", "As of 2025-03-29 (29 Mar), cost is ₹180.", [tool]);
none("month-day with year", "Since March 29, 2025, nothing changed.", []);
none("T-14 / T-7 / D+3 markers", "Between T-14 and T-7 registrations slowed; D+3 is after.", []);
none("week numbers, top N, ordinals", "In week 3 the top 3 campaigns led; it ranked 1st and #2.", []);
none("small counts", "2 campaigns and 7 owners are affected.", []);
none("durations", "Over the last 14 days and a 30-day window, 3 weeks in.", []);
none("bare year", "CampusFest 2025 runs in April.", []);
none("campaign IDs", "C03 and C06 are the ones to watch.", []);
none("markdown list markers", "1. Paid Social\n2. Creator Partners\n12. Other", []);
none("clock time", "Check-in closes at 18:00.", []);

console.log("Invented numbers fail");
flags("invented rupee figure", "Paid Social costs ₹180 per registration against a median of ₹250.", [tool], ["₹250"]);
flags("invented percentage", "Its show-up rate is 82.4%.", [tool], ["82.4%"]);
flags("wrong rounding (₹181 from 180.07)", "Paid Social costs ₹181.", [tool], ["₹181"]);
flags("invented lakh amount", "That frees up ₹3.5L.", [tool], ["₹3.5L"]);
flags("invented ratio", "It runs at 1.37× the median.", [tool], ["1.37×"]);
flags("invented count above 10", "That adds 57 visitors.", [tool], ["57"]);
flags("deduplicated, in order", "₹999 then 45% then ₹999 again.", [], ["₹999", "45%"]);
flags("no evidence at all", "Expect about 1,240 registrations.", [], ["1,240"]);

console.log("Extraction details");
const c = extractClaims("₹2.74L, ₹10.2 lakh, 1.2M, ₹1.5 cr, 4.2 pp");
check("multipliers applied", c.map((x) => Math.round(x.value * 100) / 100).join() === "274000,1020000,1200000,15000000,4.2", c);
check("tolerance follows precision (₹2.74L → ±500)", Math.abs(c[0].tol - 500) < 1e-6, c[0]);
check("pp is a percentage", c[4].percent, c[4]);
const r = extractClaims("₹1,80,000 budget");
check("rounded-looking integers get ±0.5%", r[0].tol === 900, r[0]);

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
