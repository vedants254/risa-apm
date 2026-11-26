/**
 * Numeric grounding check for copilot answers.
 *
 * Every figure in an answer must be backed by something the model actually saw: a tool result
 * (including calculate outputs) recorded under the current dataset, or the user's own messages.
 * The check is deliberately mechanical: it extracts numeric claims from the answer and looks for
 * an equivalent value in the evidence, allowing for formatting and display rounding.
 *
 * Matching rules
 * - A claim's value is normalised: grouping commas dropped (2,243 and 1,15,399), unit multipliers
 *   applied (k = 1e3, L / lakh = 1e5, M / mn / million = 1e6, cr / crore = 1e7, bn = 1e9), sign ignored
 *   (direction is carried by words like "down").
 * - Tolerance follows the displayed precision: half a unit of the last shown digit, scaled by the
 *   multiplier (₹180 → ±0.5; 70.1% → ±0.05; ₹2.74L → ±500; 0.84× → ±0.005). An integer of 1,000 or
 *   more ending in two or more zeros is treated as rounded and also gets ±0.5% (₹1,80,000).
 * - Percent and fraction are interchangeable both ways: 70.1% matches 0.7009 or 70.09, and a plain
 *   0.701 matches evidence written as "70.1%". Percentage points (pp) count as percentages.
 *
 * Not treated as claims (to avoid blocking good answers)
 * - Dates and times: 2025-03-29, 29 Mar, March 29, 29/03, 18:00; relative markers T-14, D-7.
 * - Labels and ordinals: week 3, day 2, step 1, top 3, #1, 1st, list markers "1." / "2)".
 * - Durations: 7 days, 14-day, 3 weeks (any number joined to a following word by a hyphen).
 * - Identifiers: numbers glued to letters (C03, Q1, v2).
 * - Bare years 1900-2100 and bare whole numbers 0-10 (counts like "2 campaigns"; number words such
 *   as "three" are never parsed).
 */

export interface NumericClaim {
  /** The figure as written in the answer, e.g. "₹2.74L". */
  text: string;
  /** Normalised absolute value (2.74L → 274000; 70.1% → 70.1). */
  value: number;
  /** Allowed absolute difference implied by the displayed precision. */
  tol: number;
  percent: boolean;
}

interface EvidenceValue {
  value: number;
  percent: boolean;
}

const CURRENCY = String.raw`₹\s?|Rs\.?\s?|INR\s?`;
const NUMBER = String.raw`\d{1,3}(?:,\d{2,3})+(?!\d)(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+`;
const SUFFIX =
  String.raw`\s?%|\s?×|[xX](?![A-Za-z])|\s?(?:pp|percentage points?|[Ll]akhs?|[Ll]acs?|[Cc]rores?|[Cc]r|mn|[Mm]illion|bn|[Bb]illion)(?![A-Za-z])|[LkKM](?![A-Za-z])`;
const claimRe = () => new RegExp(`(${CURRENCY})?([-−])?(${NUMBER})(${SUFFIX})?`, "g");

const MONTH = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)`;
const ORD = String.raw`(?:st|nd|rd|th)?`;

/** Spans removed from the answer before extracting claims. */
const IGNORED: RegExp[] = [
  // ISO dates / timestamps, clock times, dd/mm(/yyyy)
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?/g,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  // 29 Mar, 29-31 March 2025, 1st of April / March 29, Mar 29-31, 2025
  new RegExp(String.raw`\b\d{1,2}${ORD}(?:\s?[-–]\s?\d{1,2}${ORD})?\s+(?:of\s+)?${MONTH}\b\.?(?:,?\s+\d{4})?`, "g"),
  new RegExp(String.raw`\b${MONTH}\.?\s+\d{1,2}${ORD}(?:\s?[-–]\s?\d{1,2}${ORD})?(?:,?\s+\d{4})?(?!\d|[.,]\d)`, "g"),
  // Labels: week 3, day 2, step 1, top 3, priority 1, #2 (not "top 20%")
  /\b(?:[Ww]eeks?|[Ww]k|[Dd]ays?|[Ss]teps?|[Ss]tages?|[Pp]hases?|[Rr]ounds?|[Rr]ank(?:ed)?|[Tt]op|[Bb]ottom|[Vv]ersion|[Oo]ptions?|[Pp]riority|[Rr]ows?|[Ii]tems?|[Nn]o\.)\s?\d+(?![.,]?\d|\s?%)/g,
  /#\d+/g,
  // Durations: 7 days, 3 weeks, 2.5 hours
  /\b\d+(?:\.\d+)?\s?(?:[Dd]ays?|[Ww]eeks?|[Mm]onths?|[Hh]ours?|hrs?|[Mm]inutes?|mins?|[Yy]ears?|yrs?)\b/g,
  // Markdown list markers and footnotes
  /^(\s*)\d+[.)](?=\s)/gm,
  /\[\d+\]/g,
];

function multiplier(suffix: string): { mult: number; percent: boolean } {
  const s = suffix.trim();
  if (!s) return { mult: 1, percent: false };
  if (s === "%" || s === "pp" || /^percentage/.test(s)) return { mult: 1, percent: true };
  if (/^(?:L|l|lakhs?|Lakhs?|lacs?|Lacs?)$/.test(s)) return { mult: 1e5, percent: false };
  if (/^(?:cr|Cr|crores?|Crores?)$/.test(s)) return { mult: 1e7, percent: false };
  if (s === "k" || s === "K") return { mult: 1e3, percent: false };
  if (/^(?:M|mn|million|Million)$/.test(s)) return { mult: 1e6, percent: false };
  if (/^(?:bn|billion|Billion)$/.test(s)) return { mult: 1e9, percent: false };
  return { mult: 1, percent: false }; // × / x ratios
}

function parse(raw: string, suffix: string) {
  const digits = raw.replace(/,/g, "");
  const decimals = digits.includes(".") ? digits.length - digits.indexOf(".") - 1 : 0;
  const { mult, percent } = multiplier(suffix);
  return { value: Math.abs(parseFloat(digits)) * mult, decimals, mult, percent };
}

/** Numeric claims in an answer, after removing dates, labels, identifiers and small counts. */
export function extractClaims(answer: string): NumericClaim[] {
  let text = answer;
  for (const re of IGNORED) text = text.replace(re, (m, lead?: unknown) => (typeof lead === "string" ? lead : " ").padEnd(m.length, " "));
  const out: NumericClaim[] = [];
  for (const m of text.matchAll(claimRe())) {
    const [whole, currency = "", sign = "", raw, suffix = ""] = m;
    const start = m.index ?? 0;
    const end = start + whole.length;
    const prev = text[start - 1] ?? "";
    const prev2 = text[start - 2] ?? "";
    const next = text[end] ?? "";
    // Identifiers and dotted versions: C03, Q1, v2, 1.2.3; relative markers T-14 / D+3.
    if (/[A-Za-z0-9_]/.test(prev)) continue;
    if (prev === "." && /\d/.test(prev2)) continue;
    if (/[-−–+]/.test(prev) && /[A-Za-z]/.test(prev2)) continue;
    if (!suffix) {
      // Ordinals and glued units (1st, 24h, 10am) and hyphenated modifiers (7-day, 2-step).
      if (/[A-Za-z]/.test(next)) continue;
      if (next === "-" && /[A-Za-z]/.test(text[end + 1] ?? "")) continue;
    }
    const p = parse(raw, suffix);
    if (!Number.isFinite(p.value)) continue;
    const bare = !currency && !suffix && !raw.includes(",") && p.decimals === 0;
    if (bare && p.value <= 10) continue;
    if (bare && raw.length === 4 && p.value >= 1900 && p.value <= 2100) continue;
    let tol = 0.5 * 10 ** -p.decimals * p.mult;
    if (p.mult === 1 && p.decimals === 0 && p.value >= 1000) {
      const zeros = (String(Math.round(p.value)).match(/0+$/)?.[0].length ?? 0);
      if (zeros >= 2) tol = Math.max(tol, Math.min(0.5 * 10 ** zeros, 0.005 * p.value));
    }
    out.push({ text: (currency + sign + raw + suffix).trim(), value: p.value, tol, percent: p.percent });
  }
  return out;
}

/** Every number in an evidence text (tool JSON, calculate output, user message). */
function extractEvidence(texts: string[]): EvidenceValue[] {
  const seen = new Map<string, EvidenceValue>();
  const add = (value: number, percent: boolean) => {
    if (!Number.isFinite(value)) return;
    const v = Math.abs(value);
    seen.set(`${v}|${percent}`, { value: v, percent });
  };
  for (const t of texts) {
    if (!t) continue;
    // Formatted figures (₹2.74L, 1,15,399, 20%) ...
    for (const m of t.matchAll(claimRe())) {
      const p = parse(m[3], m[4] ?? "");
      add(p.value, p.percent);
    }
    // ... and every raw literal, so JSON arrays like [12,345] also yield 12 and 345.
    for (const m of t.matchAll(/\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g)) add(parseFloat(m[0]), false);
  }
  return [...seen.values()];
}

function grounded(c: NumericClaim, evidence: EvidenceValue[]): boolean {
  const slack = c.tol * (1 + 1e-9) + 1e-9;
  for (const e of evidence) {
    if (Math.abs(e.value - c.value) <= slack) return true;
    if (c.percent && !e.percent && Math.abs(e.value * 100 - c.value) <= slack) return true;
    if (!c.percent && e.percent && Math.abs(e.value / 100 - c.value) <= slack) return true;
  }
  return false;
}

/**
 * Figures in `answer` that no evidence backs, as written in the answer (deduplicated, in order).
 * `evidence` = tool result contents (this turn and earlier turns on the same dataset, calculate
 * outputs included); `userText` = the user's messages, which may introduce numbers themselves.
 */
export function findUngroundedNumbers(answer: string, evidence: string[], userText: string): string[] {
  const claims = extractClaims(answer ?? "");
  if (!claims.length) return [];
  const ev = extractEvidence([...evidence, userText]);
  const bad: string[] = [];
  for (const c of claims) if (!grounded(c, ev) && !bad.includes(c.text)) bad.push(c.text);
  return bad;
}
