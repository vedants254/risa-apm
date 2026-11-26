/**
 * Automatic cleaning between "apply mapping" and the preview. Same rules for every upload:
 *
 *   values     categorical columns mapped onto the vocabulary the metrics read (value map from
 *              the mapping, else exact vocabulary match, else a safe default); person flags;
 *              impossible counts (negative impressions, clicks...) cleared; negative spend kept
 *              (credits and refunds)
 *   time       rows without their timestamp, or far outside the data's activity window, dropped
 *   identity   campaign and owner IDs reconciled with names (missing ones assigned); missing
 *              stable IDs generated from a hash of the row, so re-imports give the same IDs
 *   copies     exact duplicate rows and repeated stable IDs collapsed (conflicting copies keep
 *              the latest by timestamp, else the first)
 *   links      unknown campaigns get a placeholder campaign; rows pointing at unknown people or
 *              registrations are dropped
 *   gaps       missing tables are built from what is there (event dates from the data range,
 *              people from registrations, status history from registrations); targets stay empty
 *
 * The read-time rules in lib/metrics.ts (dedupe by stable ID, external people only, verified
 * admissions only, status as of the snapshot date) still apply unchanged after this.
 */
import crypto from "node:crypto";
import type { Param } from "../db";
import type { AppliedTable, DatasetMapping, Row } from "./mapping";
import { findHeader } from "./mapping";
import { ID_COLUMN, RAW_TABLES, REQUIRED, TABLE_NAMES, TIME_COLUMN, VOCAB, VOCAB_FIELDS, type TableName, type VocabKey } from "./schema";

export type TableOrigin = "file" | "built" | "empty";
export interface CleanReport {
  duplicates_removed: number;
  conflicts_resolved: number;
  values_normalised: number;
  unknown_values: number;
  invalid_values_cleared: number;
  unreadable_cells: number;
  rows_missing_time: number;
  rows_out_of_window: number;
  orphans_dropped: number;
  ids_generated: number;
  placeholder_campaigns: number;
  people_flagged: number;
  non_external_people: number;
  /** Internal log of what changed (first few examples per rule); not shown in the UI. */
  log: string[];
}
export interface CleanResult {
  tables: Record<TableName, Row[]>;
  extras: Partial<Record<TableName, { column: string; header: string }[]>>;
  origin: Record<TableName, TableOrigin>;
  report: CleanReport;
}

const DAY = 86_400_000;
const WINDOW_DAYS = 180;
const COUNT_COLUMNS = ["impressions", "clicks", "reported_reach", "landing_page_sessions", "registration_starts"];
const GOAL_COLUMNS = ["identified_external_people_goal", "registration_goal", "unique_external_visitors_goal", "marketing_budget_inr"];

const norm = (v: Param | undefined) => (v === null || v === undefined ? "" : String(v).trim().toLowerCase());
const snake = (v: string) => v.trim().toLowerCase().replace(/[\s\-/]+/g, "_");
const hash = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10).toUpperCase();
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

function quantile(sorted: string[], q: number): string {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

export function cleanTables(applied: Partial<Record<TableName, AppliedTable>>, mapping: DatasetMapping, datasetName: string): CleanResult {
  const report: CleanReport = {
    duplicates_removed: 0,
    conflicts_resolved: 0,
    values_normalised: 0,
    unknown_values: 0,
    invalid_values_cleared: 0,
    unreadable_cells: 0,
    rows_missing_time: 0,
    rows_out_of_window: 0,
    orphans_dropped: 0,
    ids_generated: 0,
    placeholder_campaigns: 0,
    people_flagged: 0,
    non_external_people: 0,
    log: [],
  };
  const log = (msg: string) => {
    if (report.log.length < 200) report.log.push(msg);
  };
  const T = {} as Record<TableName, Row[]>;
  const origin = {} as Record<TableName, TableOrigin>;
  const extras: CleanResult["extras"] = {};
  for (const t of TABLE_NAMES) {
    const a = applied[t];
    T[t] = a ? a.rows.map((r) => ({ ...r })) : [];
    origin[t] = a ? "file" : "empty";
    if (a?.extras.length) extras[t] = a.extras;
    if (a) report.unreadable_cells += a.badCells;
  }
  const mapped = (t: TableName, c: string) => mapping.tables[t]?.columns[c] !== undefined;

  // ---- values: categorical vocabularies ------------------------------------------------
  for (const [k, f] of Object.entries(VOCAB_FIELDS) as [VocabKey, (typeof VOCAB_FIELDS)[VocabKey]][]) {
    const rows = T[f.table];
    if (!rows.length) continue;
    const allowed = VOCAB[k] as readonly string[];
    const vmap = new Map(Object.entries(mapping.values[k] ?? {}).map(([from, to]) => [from.trim().toLowerCase(), to]));
    const isMapped = mapped(f.table, f.column);
    const keep: Row[] = [];
    for (const r of rows) {
      const raw = r[f.column];
      let out: string | null;
      if (raw === null || raw === undefined || raw === "") {
        // Column absent from the file: every row is the usual case (attendees, admissions).
        if (!isMapped) out = k === "person_type" ? "external" : k === "checkin_result" ? "admitted" : k === "checkin_verification" ? "verified" : null;
        else out = k === "person_type" ? "unknown" : k === "checkin_result" ? "pending" : k === "checkin_verification" ? "unverified" : null;
      } else {
        const v = String(raw).trim();
        const hit = vmap.get(v.toLowerCase());
        if (hit) out = hit;
        else if (allowed.includes(snake(v))) out = snake(v);
        else if (!f.strict) out = snake(v);
        else {
          report.unknown_values++;
          log(`${f.table}.${f.column}: "${v}" is not a known value`);
          // Safe defaults: unknown people are kept out of goals, unknown check-ins are not admissions.
          out = k === "person_type" ? "unknown" : k === "checkin_result" ? "pending" : k === "checkin_verification" ? "unverified" : null;
        }
      }
      if (out !== (raw ?? null)) report.values_normalised++;
      r[f.column] = out;
      if (k === "registration_status" && !out) {
        report.unknown_values++;
        continue; // a status version without a usable status says nothing; drop it
      }
      keep.push(r);
    }
    T[f.table] = keep;
  }

  // Person flags (e.g. test accounts by name or email domain).
  if (mapping.person_flags.length && applied.people) {
    const src = applied.people.src;
    T.people.forEach((r, i) => {
      const s = src[i];
      for (const f of mapping.person_flags) {
        let v: Param | undefined = r[f.column];
        if (v === undefined && s) {
          const h = findHeader(s.sheet.headers, f.column);
          v = h ? (s.values[s.sheet.headers.indexOf(h)] as Param) : undefined;
        }
        const a = norm(v);
        const b = f.value.trim().toLowerCase();
        const hit = f.op === "contains" ? a.includes(b) : f.op === "equals" ? a === b : f.op === "starts_with" ? a.startsWith(b) : a.endsWith(b);
        if (hit && (r.person_type === "external" || r.person_type === "unknown") && r.person_type !== f.person_type) {
          r.person_type = f.person_type;
          report.people_flagged++;
          break;
        }
      }
    });
  }

  // Impossible values.
  for (const r of T.daily_marketing)
    for (const c of COUNT_COLUMNS)
      if (typeof r[c] === "number" && (r[c] as number) < 0) {
        r[c] = null;
        report.invalid_values_cleared++;
      }
  for (const r of T.targets)
    for (const c of GOAL_COLUMNS)
      if (typeof r[c] === "number" && (r[c] as number) < 0) {
        r[c] = null;
        report.invalid_values_cleared++;
      }

  // ---- time: required timestamps and the activity window ---------------------------------
  for (const t of TABLE_NAMES) {
    const req = REQUIRED[t];
    if (!req) continue;
    const before = T[t].length;
    T[t] = T[t].filter((r) => req.every((c) => r[c] !== null && r[c] !== undefined && r[c] !== ""));
    if (T[t].length < before) log(`${t}: ${before - T[t].length} rows without ${req.join("/")}`);
    report.rows_missing_time += before - T[t].length;
  }
  const ev = T.event[0];
  let lo: string | null = null;
  let hi: string | null = null;
  if (ev?.history_start && ev?.history_end) {
    lo = String(ev.history_start).slice(0, 10);
    hi = String(ev.history_end).slice(0, 10);
  } else {
    const days = T.daily_marketing.map((r) => String(r.activity_date).slice(0, 10)).sort();
    if (days.length) {
      lo = quantile(days, 0.05);
      hi = quantile(days, 0.95);
    }
  }
  if (lo && hi) {
    const from = addDays(lo, -WINDOW_DAYS);
    const to = addDays(hi, WINDOW_DAYS);
    for (const t of ["daily_marketing", "people", "interactions", "registrations", "registration_history", "checkins"] as TableName[]) {
      const c = TIME_COLUMN[t]!;
      const before = T[t].length;
      T[t] = T[t].filter((r) => {
        const v = r[c];
        if (v === null || v === undefined || v === "") return true;
        const d = String(v).slice(0, 10);
        return d >= from && d <= to;
      });
      if (T[t].length < before) log(`${t}: ${before - T[t].length} rows outside ${from}..${to}`);
      report.rows_out_of_window += before - T[t].length;
    }
  }

  // ---- identity: campaigns and owners ----------------------------------------------------
  const campById = new Map<string, Row>();
  const campByName = new Map<string, string>();
  const takenIds = new Set<string>();
  const nextId = (prefix: string, taken: Set<string>, width = 2) => {
    for (let i = 1; ; i++) {
      const id = `${prefix}${String(i).padStart(width, "0")}`;
      if (!taken.has(id)) {
        taken.add(id);
        return id;
      }
    }
  };
  for (const r of T.campaigns) if (r.campaign_id) takenIds.add(String(r.campaign_id));
  for (const r of T.campaigns) {
    if (!r.campaign_id && r.campaign_name) {
      r.campaign_id = campByName.get(norm(r.campaign_name)) ?? nextId("C", takenIds);
      report.ids_generated++;
    }
    if (!r.campaign_id) continue;
    const id = String(r.campaign_id);
    if (!campById.has(id)) campById.set(id, r);
    if (r.campaign_name && !campByName.has(norm(r.campaign_name))) campByName.set(norm(r.campaign_name), id);
  }
  T.campaigns = T.campaigns.filter((r) => r.campaign_id);

  // Owners: one dictionary across every table.
  const ownerById = new Map<string, string>();
  const ownerByName = new Map<string, string>();
  const takenOwners = new Set<string>();
  for (const t of TABLE_NAMES)
    for (const r of T[t]) {
      if (r.owner_id) takenOwners.add(String(r.owner_id));
      if (r.owner_id && r.owner_name) {
        if (!ownerById.has(String(r.owner_id))) ownerById.set(String(r.owner_id), String(r.owner_name));
        if (!ownerByName.has(norm(r.owner_name))) ownerByName.set(norm(r.owner_name), String(r.owner_id));
      }
    }
  const fixOwner = (r: Row) => {
    if (!("owner_id" in r)) return;
    if (!r.owner_id && r.owner_name) {
      let id = ownerByName.get(norm(r.owner_name));
      if (!id) {
        id = nextId("T", takenOwners);
        ownerByName.set(norm(r.owner_name), id);
        ownerById.set(id, String(r.owner_name));
        report.ids_generated++;
      }
      r.owner_id = id;
    } else if (r.owner_id && !r.owner_name) r.owner_name = ownerById.get(String(r.owner_id)) ?? null;
  };
  for (const r of T.campaigns) fixOwner(r);

  const placeholder = (id: string | null, name: string | null, r: Row): string => {
    const cid = id ?? nextId("C", takenIds);
    takenIds.add(cid);
    const row: Row = {};
    for (const c of Object.keys(RAW_TABLES.find((s) => s.table === "campaigns")!.columns)) row[c] = null;
    row.campaign_id = cid;
    row.campaign_name = name ?? `Campaign ${cid}`;
    row.channel = "other";
    row.owner_name = (r.owner_name as string) ?? null;
    row.owner_id = (r.owner_id as string) ?? null;
    T.campaigns.push(row);
    campById.set(cid, row);
    campByName.set(norm(row.campaign_name), cid);
    report.placeholder_campaigns++;
    log(`placeholder campaign ${cid} "${row.campaign_name}"`);
    return cid;
  };
  /** Fill campaign id/name (and owner) on a row that references a campaign. */
  const linkCampaign = (r: Row, idCol: string, nameCol: string) => {
    const id = r[idCol] ? String(r[idCol]) : null;
    const name = r[nameCol] ? String(r[nameCol]) : null;
    if (!id && !name) return;
    let cid = id && campById.has(id) ? id : null;
    if (!cid && !id && name) cid = campByName.get(norm(name)) ?? null;
    if (!cid) cid = placeholder(id, name, r);
    r[idCol] = cid;
    const c = campById.get(cid)!;
    if (!r[nameCol]) r[nameCol] = c.campaign_name;
    if (idCol === "campaign_id" && "owner_id" in r && !r.owner_id && !r.owner_name) {
      r.owner_id = c.owner_id;
      r.owner_name = c.owner_name;
    }
  };
  for (const t of ["daily_marketing", "interactions", "registrations", "registration_history", "checkins"] as TableName[])
    for (const r of T[t]) {
      linkCampaign(r, "campaign_id", "campaign_name");
      fixOwner(r);
    }
  for (const r of T.people) {
    linkCampaign(r, "first_campaign_id", "first_campaign_name");
    fixOwner(r);
  }
  // Daily rows without any campaign cannot be attributed; spend needs a campaign.
  {
    const before = T.daily_marketing.length;
    T.daily_marketing = T.daily_marketing.filter((r) => r.campaign_id);
    report.orphans_dropped += before - T.daily_marketing.length;
  }

  // ---- identity: stable IDs --------------------------------------------------------------
  const rowKey = (r: Row, skip: string) =>
    Object.keys(r)
      .filter((k) => k !== skip)
      .sort()
      .map((k) => `${k}=${r[k] ?? ""}`)
      .join("|");
  const genIds = (t: TableName, prefix: string) => {
    const c = ID_COLUMN[t]!;
    for (const r of T[t])
      if (!r[c]) {
        r[c] = `${prefix}-${hash(rowKey(r, c))}`;
        report.ids_generated++;
      }
  };
  // People without IDs: key on name + first seen (names alone repeat).
  for (const r of T.people)
    if (!r.person_id && r.person_name) {
      r.person_id = `P-${hash(`${norm(r.person_name)}|${r.first_seen_at ?? ""}`)}`;
      report.ids_generated++;
    }
  T.people = T.people.filter((r) => r.person_id);
  const peopleById = new Map<string, Row>();
  const namesToIds = new Map<string, Set<string>>();
  for (const r of T.people) {
    const id = String(r.person_id);
    if (!peopleById.has(id)) peopleById.set(id, r);
    if (r.person_name) {
      const set = namesToIds.get(norm(r.person_name)) ?? new Set();
      set.add(id);
      namesToIds.set(norm(r.person_name), set);
    }
  }
  const linkPerson = (r: Row) => {
    if (!r.person_id && r.person_name) {
      const ids = namesToIds.get(norm(r.person_name));
      if (ids?.size === 1) r.person_id = [...ids][0];
    }
    if (r.person_id && !r.person_name) r.person_name = (peopleById.get(String(r.person_id))?.person_name as string) ?? null;
  };
  for (const t of ["interactions", "registrations", "registration_history", "checkins"] as TableName[]) for (const r of T[t]) linkPerson(r);

  genIds("registrations", "R");
  const regById = new Map<string, Row>();
  const regsByPerson = new Map<string, string[]>();
  for (const r of T.registrations) {
    const id = String(r.registration_id);
    if (!regById.has(id)) regById.set(id, r);
    if (r.person_id) regsByPerson.set(String(r.person_id), [...(regsByPerson.get(String(r.person_id)) ?? []), id]);
  }
  // Status versions always belong to a registration, so infer it from the person when there is
  // exactly one. Check-ins are not inferred: an empty registration means a walk-in admission.
  const linkReg = (r: Row, infer: boolean) => {
    if (infer && !r.registration_id && r.person_id) {
      const ids = [...new Set(regsByPerson.get(String(r.person_id)) ?? [])];
      if (ids.length === 1) r.registration_id = ids[0];
    }
    const reg = r.registration_id ? regById.get(String(r.registration_id)) : undefined;
    if (reg) {
      if (!r.person_id) r.person_id = reg.person_id;
      if (!r.person_name) r.person_name = reg.person_name;
      if (!r.campaign_id && reg.campaign_id) {
        r.campaign_id = reg.campaign_id;
        r.campaign_name = reg.campaign_name;
        if ("owner_id" in r && !r.owner_id) {
          r.owner_id = reg.owner_id;
          r.owner_name = reg.owner_name;
        }
      }
    }
  };
  for (const r of T.registration_history) linkReg(r, true);
  for (const r of T.checkins) linkReg(r, false);
  genIds("daily_marketing", "AD");
  genIds("interactions", "LI");
  genIds("registration_history", "RH");
  genIds("checkins", "CHK");

  // ---- gaps: people and status history built from registrations -------------------------
  if (!T.people.length && (T.registrations.length || T.checkins.length || T.interactions.length)) {
    origin.people = "built";
    const first = new Map<string, Row>();
    const touch = (pid: Param, name: Param, at: Param, reg?: Row) => {
      if (!pid) return;
      const id = String(pid);
      let p = first.get(id);
      if (!p) {
        p = {
          person_name: name ?? null,
          person_type: "external",
          first_seen_at: at ?? null,
          first_touch_source: reg?.campaign_id ? "campaign" : "walk_in",
          first_campaign_name: (reg?.campaign_name as string) ?? null,
          owner_name: (reg?.owner_name as string) ?? null,
          person_id: id,
          first_campaign_id: (reg?.campaign_id as string) ?? null,
          owner_id: (reg?.owner_id as string) ?? null,
        };
        first.set(id, p);
      } else {
        if (at && (!p.first_seen_at || String(at) < String(p.first_seen_at))) p.first_seen_at = at;
        if (!p.person_name && name) p.person_name = name;
        if (reg?.campaign_id && !p.first_campaign_id) {
          p.first_campaign_id = reg.campaign_id;
          p.first_campaign_name = reg.campaign_name;
          p.first_touch_source = "campaign";
        }
      }
    };
    for (const r of [...T.registrations].sort((a, b) => String(a.registered_at).localeCompare(String(b.registered_at))))
      touch(r.person_id, r.person_name, r.registered_at, r);
    for (const r of T.interactions) touch(r.person_id, r.person_name, r.occurred_at);
    for (const r of T.checkins) touch(r.person_id, r.person_name, r.occurred_at);
    T.people = [...first.values()];
    for (const p of T.people) peopleById.set(String(p.person_id), p);
    log(`built ${T.people.length} people from registrations, check-ins and interactions`);
  } else {
    // Fill a missing first-seen time from the person's earliest activity.
    const earliest = new Map<string, string>();
    const see = (pid: Param, at: Param) => {
      if (!pid || !at) return;
      const k = String(pid);
      if (!earliest.has(k) || String(at) < earliest.get(k)!) earliest.set(k, String(at));
    };
    for (const r of T.registrations) see(r.person_id, r.registered_at);
    for (const r of T.interactions) see(r.person_id, r.occurred_at);
    for (const r of T.checkins) see(r.person_id, r.occurred_at);
    for (const p of T.people) if (!p.first_seen_at) p.first_seen_at = earliest.get(String(p.person_id)) ?? null;
  }
  if (!T.registration_history.length && T.registrations.length) {
    origin.registration_history = "built";
    T.registration_history = T.registrations.map((r) => ({
      person_name: r.person_name,
      campaign_name: r.campaign_name,
      owner_name: r.owner_name,
      effective_at: r.registered_at,
      status: "confirmed",
      history_id: `RH-${r.registration_id}`,
      registration_id: r.registration_id,
      person_id: r.person_id,
      campaign_id: r.campaign_id,
      owner_id: r.owner_id,
    }));
    log("built status history: every registration confirmed when it was made");
  }

  // ---- copies: exact duplicates and repeated stable IDs ----------------------------------
  for (const t of TABLE_NAMES) {
    const idc = ID_COLUMN[t];
    const tc = TIME_COLUMN[t];
    const seen = new Map<string, number>(); // key -> index in out
    const contents = new Map<string, string>();
    const out: Row[] = [];
    for (const r of T[t]) {
      const content = rowKey(r, "");
      const k = idc ? String(r[idc]) : content;
      const at = seen.get(k);
      if (at === undefined) {
        seen.set(k, out.length);
        contents.set(k, content);
        out.push(r);
        continue;
      }
      report.duplicates_removed++;
      if (contents.get(k) === content) continue;
      // Same ID, different content: keep the latest version by timestamp, else the first.
      report.conflicts_resolved++;
      log(`${t}: conflicting copies of ${idc} ${k}`);
      if (tc && r[tc] && String(r[tc]) > String(out[at][tc] ?? "")) {
        out[at] = r;
        contents.set(k, content);
      }
    }
    T[t] = out;
  }

  // ---- links: rows pointing at unknown people or registrations ---------------------------
  const personIds = new Set(T.people.map((p) => String(p.person_id)));
  const regIds = new Set(T.registrations.map((r) => String(r.registration_id)));
  const dropOrphans = (t: TableName, ok: (r: Row) => boolean) => {
    const before = T[t].length;
    T[t] = T[t].filter(ok);
    if (T[t].length < before) log(`${t}: dropped ${before - T[t].length} rows with unknown references`);
    report.orphans_dropped += before - T[t].length;
  };
  dropOrphans("registrations", (r) => !!r.person_id && personIds.has(String(r.person_id)));
  const regIdsAfter = new Set(T.registrations.map((r) => String(r.registration_id)));
  dropOrphans("registration_history", (r) => !!r.registration_id && regIdsAfter.has(String(r.registration_id)));
  dropOrphans("checkins", (r) => !!r.person_id && personIds.has(String(r.person_id)));
  for (const r of T.checkins)
    if (r.registration_id && !regIds.has(String(r.registration_id))) {
      r.registration_id = null; // treated as a walk-in admission
      report.orphans_dropped++;
    }
  dropOrphans("interactions", (r) => !r.person_id || personIds.has(String(r.person_id)));

  // ---- gaps: event and targets ------------------------------------------------------------
  const allDays: string[] = [];
  for (const t of ["daily_marketing", "people", "interactions", "registrations", "registration_history", "checkins"] as TableName[]) {
    const c = TIME_COLUMN[t]!;
    for (const r of T[t]) if (r[c]) allDays.push(String(r[c]).slice(0, 10));
  }
  allDays.sort();
  const checkinTimes = T.checkins.map((r) => String(r.occurred_at)).filter(Boolean).sort();
  const dataStart = allDays[0] ?? null;
  const dataEnd = allDays[allDays.length - 1] ?? null;
  if (!T.event.length) {
    origin.event = "built";
    T.event = [
      {
        event_name: datasetName,
        history_start: null,
        history_end: null,
        event_starts_at: null,
        event_ends_at: null,
        timezone: "Asia/Kolkata",
        currency: "INR",
        fictional: null,
      },
    ];
  }
  const e = T.event[0];
  if (!e.event_name) e.event_name = datasetName;
  if (!e.history_start) e.history_start = dataStart;
  if (!e.history_end) e.history_end = dataEnd;
  // Without event dates, the check-in window is the event; with no check-ins, the last data day.
  if (!e.event_starts_at) e.event_starts_at = checkinTimes[0] ?? (dataEnd ? `${dataEnd} 10:00:00` : null);
  if (!e.event_ends_at) e.event_ends_at = checkinTimes[checkinTimes.length - 1] ?? (dataEnd ? `${dataEnd} 20:00:00` : null);
  if (!e.timezone) e.timezone = "Asia/Kolkata";
  if (!e.currency) e.currency = "INR";
  T.event = [e];

  for (const t of TABLE_NAMES) if (origin[t] === "file" && !T[t].length) origin[t] = "empty";
  if (T.campaigns.length && !applied.campaigns) origin.campaigns = "built";
  report.non_external_people = T.people.filter((p) => p.person_type !== "external").length;
  return { tables: T, extras, origin, report };
}

/** One quiet line for the preview, e.g. "Removed 26 duplicate rows. 60 internal, staff or test people are kept out of goals." */
export function cleaningSummary(r: CleanReport): string {
  const parts: string[] = [];
  const n = (x: number) => x.toLocaleString("en-IN");
  if (r.duplicates_removed) parts.push(`removed ${n(r.duplicates_removed)} duplicate rows`);
  const dropped = r.rows_missing_time + r.rows_out_of_window + r.orphans_dropped;
  if (dropped) parts.push(`dropped ${n(dropped)} unusable rows`);
  const fixed = r.invalid_values_cleared + r.unreadable_cells;
  if (fixed) parts.push(`cleared ${n(fixed)} unreadable values`);
  if (r.placeholder_campaigns) parts.push(`added ${n(r.placeholder_campaigns)} missing campaigns`);
  let s = parts.length ? parts.join(", ") : "No duplicates or broken rows found";
  s = s.charAt(0).toUpperCase() + s.slice(1) + ".";
  if (r.non_external_people) s += ` ${n(r.non_external_people)} internal, staff, test or unknown people are kept out of goals.`;
  return s;
}
