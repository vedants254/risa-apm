/**
 * The canonical schema every dataset is mapped into: nine raw tables with typed columns, what
 * each column means, which columns an import needs, and the value vocabularies the metrics read.
 * Also the value parsers (coerce / normalizeTs) shared by the seed, the table editor and uploads.
 */
import type { Param } from "../db";

export type ColType = "text" | "int" | "date" | "ts";
export interface TableSpec {
  sheet: string;
  table: string;
  prefix: string;
  columns: Record<string, ColType>;
}

/** Sheet → table mapping. Column order matches the original workbook. */
export const RAW_TABLES: TableSpec[] = [
  {
    sheet: "Event",
    table: "event",
    prefix: "ev",
    columns: {
      event_name: "text",
      history_start: "date",
      history_end: "date",
      event_starts_at: "ts",
      event_ends_at: "ts",
      timezone: "text",
      currency: "text",
      fictional: "text",
    },
  },
  {
    sheet: "Targets",
    table: "targets",
    prefix: "tg",
    columns: {
      effective_at: "ts",
      identified_external_people_goal: "int",
      registration_goal: "int",
      unique_external_visitors_goal: "int",
      marketing_budget_inr: "int",
      target_version: "text",
    },
  },
  {
    sheet: "Campaigns",
    table: "campaigns",
    prefix: "cp",
    columns: {
      campaign_name: "text",
      channel: "text",
      target_audience: "text",
      objective: "text",
      owner_name: "text",
      created_at: "ts",
      planned_start_at: "ts",
      planned_end_at: "ts",
      campaign_id: "text",
      owner_id: "text",
    },
  },
  {
    sheet: "Daily Marketing",
    table: "daily_marketing",
    prefix: "dm",
    columns: {
      campaign_name: "text",
      owner_name: "text",
      activity_date: "date",
      impressions: "int",
      clicks: "int",
      reported_reach: "int",
      landing_page_sessions: "int",
      registration_starts: "int",
      marketing_spend_inr: "int",
      platform: "text",
      activity_id: "text",
      campaign_id: "text",
      owner_id: "text",
    },
  },
  {
    sheet: "People",
    table: "people",
    prefix: "pp",
    columns: {
      person_name: "text",
      person_type: "text",
      first_seen_at: "ts",
      first_touch_source: "text",
      first_campaign_name: "text",
      owner_name: "text",
      person_id: "text",
      first_campaign_id: "text",
      owner_id: "text",
    },
  },
  {
    sheet: "Interest and Engagement",
    table: "interactions",
    prefix: "li",
    columns: {
      person_name: "text",
      campaign_name: "text",
      owner_name: "text",
      occurred_at: "ts",
      event_type: "text",
      detail: "text",
      interaction_id: "text",
      person_id: "text",
      campaign_id: "text",
      owner_id: "text",
    },
  },
  {
    sheet: "Registrations",
    table: "registrations",
    prefix: "rg",
    columns: {
      person_name: "text",
      campaign_name: "text",
      owner_name: "text",
      registered_at: "ts",
      registration_id: "text",
      person_id: "text",
      campaign_id: "text",
      owner_id: "text",
    },
  },
  {
    sheet: "Registration History",
    table: "registration_history",
    prefix: "rh",
    columns: {
      person_name: "text",
      campaign_name: "text",
      owner_name: "text",
      effective_at: "ts",
      status: "text",
      history_id: "text",
      registration_id: "text",
      person_id: "text",
      campaign_id: "text",
      owner_id: "text",
    },
  },
  {
    sheet: "Check-ins",
    table: "checkins",
    prefix: "ci",
    columns: {
      person_name: "text",
      campaign_name: "text",
      owner_name: "text",
      occurred_at: "ts",
      result: "text",
      verification: "text",
      source: "text",
      event_id: "text",
      person_id: "text",
      registration_id: "text",
      campaign_id: "text",
      owner_id: "text",
    },
  },
];

export type TableName =
  | "event"
  | "targets"
  | "campaigns"
  | "daily_marketing"
  | "people"
  | "interactions"
  | "registrations"
  | "registration_history"
  | "checkins";

export const TABLE_NAMES = RAW_TABLES.map((t) => t.table) as TableName[];
export const specOf = (t: string): TableSpec | undefined => RAW_TABLES.find((s) => s.table === t);

export const TABLE_LABELS: Record<TableName, string> = {
  event: "Event",
  targets: "Targets",
  campaigns: "Campaigns",
  daily_marketing: "Daily marketing",
  people: "People",
  interactions: "Interest and engagement",
  registrations: "Registrations",
  registration_history: "Registration history",
  checkins: "Check-ins",
};

/** The stable ID per table (import copies share it). Event and targets have none. */
export const ID_COLUMN: Partial<Record<TableName, string>> = {
  campaigns: "campaign_id",
  daily_marketing: "activity_id",
  people: "person_id",
  interactions: "interaction_id",
  registrations: "registration_id",
  registration_history: "history_id",
  checkins: "event_id",
};

/** The column that places a row in time (used for conflicts and the activity window). */
export const TIME_COLUMN: Partial<Record<TableName, string>> = {
  targets: "effective_at",
  campaigns: "created_at",
  daily_marketing: "activity_date",
  people: "first_seen_at",
  interactions: "occurred_at",
  registrations: "registered_at",
  registration_history: "effective_at",
  checkins: "occurred_at",
};

/** What each table and column means; sent to the mapping model and used in the docs. */
export const TABLE_MEANING: Record<TableName, string> = {
  event: "One row describing the event: name, the date range the data covers, and when the event opens and closes.",
  targets: "Goal plans. Each row is a full version of the goals that takes effect at effective_at.",
  campaigns: "One row per marketing campaign.",
  daily_marketing: "One row per campaign per day: anonymous funnel counts and net marketing spend.",
  people: "One row per identified person (attendee lead, staff, test account).",
  interactions: "Identified engagement actions by a person (page visit, brochure download, email opened...).",
  registrations: "One row per registration, with the campaign that drove it.",
  registration_history: "Status versions of each registration over time.",
  checkins: "Event admission observations (scans or manual entries) at the venue.",
};

export const COLUMN_MEANING: Record<string, string> = {
  event_name: "Event display name",
  history_start: "First date the data covers",
  history_end: "Last date the data covers",
  event_starts_at: "Event opening timestamp",
  event_ends_at: "Event closing timestamp",
  timezone: "Timezone, e.g. Asia/Kolkata",
  currency: "Currency of spend, e.g. INR",
  fictional: "Whether the data is synthetic",
  effective_at: "When this row takes effect",
  identified_external_people_goal: "Goal: distinct identified external people",
  registration_goal: "Goal: distinct external people with a registration",
  unique_external_visitors_goal: "Goal: distinct verified external visitors at the event",
  marketing_budget_inr: "Approved marketing budget, whole INR",
  target_version: "Label of the goal plan",
  campaign_name: "Campaign label",
  channel: "Marketing channel, e.g. paid_social, referrals",
  target_audience: "Intended audience (text)",
  objective: "Campaign purpose (text)",
  owner_name: "Name of the team member who owns it",
  owner_id: "Stable owner key",
  created_at: "When the record was created",
  planned_start_at: "Planned campaign start",
  planned_end_at: "Planned campaign end",
  campaign_id: "Stable campaign key",
  activity_date: "Reporting day",
  impressions: "Daily impressions (events, not people)",
  clicks: "Daily clicks",
  reported_reach: "Platform-reported reach for the day",
  landing_page_sessions: "Daily landing-page sessions",
  registration_starts: "Daily registration form starts",
  marketing_spend_inr: "Net spend for this campaign and day, whole INR; negative = credit or refund",
  platform: "Reporting source",
  activity_id: "Stable daily record key",
  person_name: "Person display name (names can repeat)",
  person_type: "external (attendee), internal, staff or test",
  first_seen_at: "When the person first appears",
  first_touch_source: "campaign, internal_registration, walk_in or event_access",
  first_campaign_name: "First campaign that reached the person",
  first_campaign_id: "Key of the first campaign",
  person_id: "Stable person key",
  occurred_at: "When it happened",
  event_type: "Action type, e.g. page_visit, brochure_download, nurture_email_opened",
  detail: "Free-text description",
  interaction_id: "Stable action key",
  registered_at: "When the registration was created",
  registration_id: "Stable registration key",
  status: "interested, confirmed, waitlisted or cancelled",
  history_id: "Stable status-version key",
  result: "admitted, denied or pending",
  verification: "verified or unverified",
  source: "scanner or manual",
  event_id: "Stable admission-event key",
};

/** Columns that must have a value for a table to be usable (IDs can be generated). */
export const REQUIRED: Partial<Record<TableName, string[]>> = {
  daily_marketing: ["activity_date", "marketing_spend_inr"],
  registrations: ["registered_at"],
  registration_history: ["effective_at", "status"],
  checkins: ["occurred_at"],
  interactions: ["occurred_at"],
};

/** Value vocabularies the metrics depend on. */
export const VOCAB = {
  person_type: ["external", "internal", "staff", "test"],
  checkin_result: ["admitted", "denied", "pending"],
  checkin_verification: ["verified", "unverified"],
  checkin_source: ["scanner", "manual"],
  registration_status: ["interested", "confirmed", "waitlisted", "cancelled"],
  first_touch_source: ["campaign", "internal_registration", "walk_in", "event_access"],
  interaction_event_type: [
    "page_visit",
    "brochure_download",
    "registration_start",
    "event_question_submitted",
    "nurture_email_sent",
    "nurture_email_opened",
    "nurture_email_clicked",
    "opted_out",
  ],
} as const;
export type VocabKey = keyof typeof VOCAB;

/** Where each vocabulary applies. Strict ones reject values outside the list. */
export const VOCAB_FIELDS: Record<VocabKey, { table: TableName; column: string; strict: boolean }> = {
  person_type: { table: "people", column: "person_type", strict: true },
  checkin_result: { table: "checkins", column: "result", strict: true },
  checkin_verification: { table: "checkins", column: "verification", strict: true },
  checkin_source: { table: "checkins", column: "source", strict: false },
  registration_status: { table: "registration_history", column: "status", strict: true },
  first_touch_source: { table: "people", column: "first_touch_source", strict: false },
  interaction_event_type: { table: "interactions", column: "event_type", strict: false },
};

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------
export type DateOrder = "YMD" | "DMY" | "MDY";

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function ymd(y: number, m: number, d: number, raw: string): string {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (m < 1 || m > 12 || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw new Error(`Not a valid date: "${raw}"`);
  return `${y}-${pad(m)}-${pad(d)}`;
}

function hms(h: string | undefined, mi: string | undefined, s: string | undefined, ampm: string | undefined, raw: string): string {
  let hh = Number(h ?? 0);
  const ap = ampm?.toLowerCase();
  if (ap === "pm" && hh < 12) hh += 12;
  if (ap === "am" && hh === 12) hh = 0;
  if (hh > 23 || Number(mi ?? 0) > 59 || Number(s ?? 0) > 59) throw new Error(`Not a valid time: "${raw}"`);
  return `${pad(hh)}:${pad(Number(mi ?? 0))}:${pad(Number(s ?? 0))}`;
}

const TIME_PART = String.raw`(?:[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp][Mm])?)?`;
/** 12/04/2025, 12-04-2025, 12.04.25 with optional time. */
export const NUMERIC_DATE_RE = new RegExp(String.raw`^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})${TIME_PART}$`);
const SLASH_YMD_RE = new RegExp(String.raw`^(\d{4})[/.](\d{1,2})[/.](\d{1,2})${TIME_PART}$`);
const NAMED_DMY_RE = new RegExp(String.raw`^(\d{1,2})[\s\-]([A-Za-z]{3,9})\.?[\s\-,]+(\d{4})${TIME_PART}$`);
const NAMED_MDY_RE = new RegExp(String.raw`^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})${TIME_PART}$`);

const monthOf = (name: string) => {
  const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  if (i < 0) throw new Error(`Unknown month "${name}"`);
  return i + 1;
};

/** Excel stores dates as days since 1899-12-30; the fraction is the time of day. */
function fromExcelSerial(n: number): Date {
  return new Date(Math.round((n - 25569) * 86_400_000));
}

/**
 * Normalise a timestamp to 'YYYY-MM-DD HH:MM:SS' IST. Accepts JS Dates from the workbook
 * (naive IST wall-clock values that exceljs exposes as UTC), ISO strings with or without
 * an offset, and 'YYYY-MM-DD'. With a day order (uploads), it also reads DD/MM/YYYY or
 * MM/DD/YYYY with optional time and AM/PM, YYYY/MM/DD, "12 Apr 2025", "Apr 12, 2025" and
 * Excel serial numbers.
 */
export function normalizeTs(v: unknown, kind: "date" | "ts", order?: DateOrder): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (order && typeof v === "number" && v > 20000 && v < 80000) v = fromExcelSerial(v);
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new Error("Not a valid date");
    const s = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    if (kind === "date") return s;
    return `${s} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  }
  const str = String(v).trim();
  const m = str.match(
    /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (!m) {
    if (order) {
      let out: string | null = null;
      let mm: RegExpMatchArray | null;
      if ((mm = str.match(NUMERIC_DATE_RE))) {
        const [, a, b, y, h, mi, s, ap] = mm;
        const [d, mo] = order === "MDY" ? [Number(b), Number(a)] : [Number(a), Number(b)];
        out = `${ymd(Number(y), mo, d, str)} ${hms(h, mi, s, ap, str)}`;
      } else if ((mm = str.match(SLASH_YMD_RE))) {
        const [, y, mo, d, h, mi, s, ap] = mm;
        out = `${ymd(Number(y), Number(mo), Number(d), str)} ${hms(h, mi, s, ap, str)}`;
      } else if ((mm = str.match(NAMED_DMY_RE))) {
        const [, d, mon, y, h, mi, s, ap] = mm;
        out = `${ymd(Number(y), monthOf(mon), Number(d), str)} ${hms(h, mi, s, ap, str)}`;
      } else if ((mm = str.match(NAMED_MDY_RE))) {
        const [, mon, d, y, h, mi, s, ap] = mm;
        out = `${ymd(Number(y), monthOf(mon), Number(d), str)} ${hms(h, mi, s, ap, str)}`;
      } else if (/^\d+(\.\d+)?$/.test(str) && Number(str) > 20000 && Number(str) < 80000) {
        return normalizeTs(Number(str), kind, order);
      }
      if (out) return kind === "date" ? out.slice(0, 10) : out;
    }
    throw new Error(`Unrecognised date/time "${str}". Use YYYY-MM-DD or YYYY-MM-DD HH:MM[:SS].`);
  }
  const [, day, hh = "00", mm = "00", ss = "00", tz] = m;
  let out = `${day} ${hh}:${mm}:${ss}`;
  if (tz && tz !== "+05:30" && tz !== "+0530") {
    // Convert other offsets to IST wall-clock time.
    const iso = `${day}T${hh}:${mm}:${ss}${tz === "Z" ? "Z" : tz.length === 5 ? `${tz.slice(0, 3)}:${tz.slice(3)}` : tz}`;
    const t = new Date(iso).getTime() + 330 * 60_000;
    out = new Date(t).toISOString().slice(0, 19).replace("T", " ");
  }
  return kind === "date" ? out.slice(0, 10) : out;
}

/** "₹1,400", "Rs. 1400", "(500)", "1 400", "12%" → number. Returns NaN when it is not a number. */
export function parseNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  let s = String(v).trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/₹|\bINR\b|\bRs\.?|%/gi, "").replace(/[,\s ]/g, "");
  if (/^-.+/.test(s) && neg) s = s.slice(1);
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(s)) return NaN;
  const n = Number(s);
  return neg ? -n : n;
}

/** Unwrap exceljs cell objects (formula results, rich text, hyperlinks). */
export function cellValue(v: unknown): unknown {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[]; error?: unknown };
    if (o.result !== undefined) return o.result;
    if (o.richText) return o.richText.map((x) => x.text).join("");
    if (o.text !== undefined) return o.text;
    if (o.error !== undefined) return null;
  }
  return v;
}

export function coerce(v: unknown, t: ColType, order?: DateOrder): Param {
  v = cellValue(v);
  if (v === null || v === undefined || v === "") return null;
  switch (t) {
    case "int": {
      const n = parseNumber(v);
      if (!Number.isFinite(n)) throw new Error(`Expected a number, got "${String(v)}"`);
      return Math.round(n);
    }
    case "date":
    case "ts":
      return normalizeTs(v, t, order);
    default: {
      const s = (v instanceof Date ? normalizeTs(v, "ts") ?? "" : String(v)).trim();
      return s === "" ? null : s;
    }
  }
}
