/**
 * The one metrics module. Every number on the dashboard and every copilot answer comes
 * from these functions, computed live from the database rows (nothing is hardcoded).
 *
 * Definitions follow ../SPEC.md ("Canonical metric definitions"):
 *   - Snapshot date D = end of day D in IST; a record counts only if its timestamp <= D 23:59:59.
 *   - Import copies are deduplicated by stable ID (activity_id, interaction_id, history_id,
 *     registration_id, check-in event_id, person_id); the first copy wins.
 *   - Only person_type == 'external' counts towards goal metrics.
 *   - Verified visitor = distinct external person with a check-in where result='admitted'
 *     AND verification='verified' at or before D (walk-ins included).
 *   - Registration status as of D = latest history version with effective_at <= D.
 *   - Targets as of D = latest Targets row with effective_at <= D.
 *   - Spend = net ledger amount (credits are negative) with activity_date <= D.
 *   - Attribution = the registration's campaign_id; identified people use first_campaign_id
 *     (identical to the registration campaign in this dataset); walk-ins are unattributed.
 *
 * Driver-agnostic: rows are fetched with plain SELECTs and aggregated in TypeScript.
 */
import fs from "node:fs";
import path from "node:path";
import { getDb, num } from "./db";
import { ensureSeeded } from "./seed";
import { DEFAULT_SETTINGS, type Settings } from "./settings";
import { clampToRange, resolveDate, type DataRange } from "./range";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface EventInfo {
  event_name: string;
  history_start: string;
  history_end: string;
  event_starts_at: string;
  event_ends_at: string;
  timezone: string;
  currency: string;
}
export interface TargetRow {
  effective_at: string;
  identified_external_people_goal: number;
  registration_goal: number;
  unique_external_visitors_goal: number;
  marketing_budget_inr: number;
  target_version: string;
}
export interface CampaignRow {
  campaign_id: string;
  campaign_name: string;
  channel: string;
  target_audience: string;
  objective: string;
  owner_name: string;
  owner_id: string;
  created_at: string;
  planned_start_at: string;
  planned_end_at: string;
}
export interface CampaignMeta {
  campaign_id: string;
  status: string;
  owner_name: string | null;
  owner_id: string | null;
  planned_budget_inr: number | null;
  notes: string | null;
  updated_at: string | null;
}
interface DailyRow {
  activity_id: string;
  activity_date: string;
  campaign_id: string;
  impressions: number;
  clicks: number;
  reported_reach: number;
  landing_page_sessions: number;
  registration_starts: number;
  marketing_spend_inr: number;
}
interface PersonRow {
  person_id: string;
  person_type: string;
  first_seen_at: string;
  first_touch_source: string;
  first_campaign_id: string | null;
}
interface RegRow {
  registration_id: string;
  person_id: string;
  campaign_id: string | null;
  registered_at: string;
}
interface HistRow {
  history_id: string;
  registration_id: string;
  effective_at: string;
  status: string;
}
interface CheckinRow {
  event_id: string;
  person_id: string;
  registration_id: string | null;
  campaign_id: string | null;
  occurred_at: string;
  result: string;
  verification: string;
  source: string;
}
interface InteractionRow {
  interaction_id: string;
  person_id: string;
  campaign_id: string | null;
  occurred_at: string;
  event_type: string;
}

export interface RawData {
  version: string;
  event: EventInfo;
  targets: TargetRow[];
  campaigns: CampaignRow[];
  meta: Map<string, CampaignMeta>;
  daily: DailyRow[];
  people: Map<string, PersonRow>;
  regs: RegRow[];
  histByReg: Map<string, HistRow[]>;
  checkins: CheckinRow[];
  interactions: InteractionRow[];
  settings: Settings;
  duplicates: Record<string, number>;
  /** How the active dataset arrived: "original" / "reset" (the provided workbook) or "upload". */
  datasetKind: string;
}

export const STATUSES = ["interested", "confirmed", "cancelled", "waitlisted"] as const;
export type StatusCounts = Record<(typeof STATUSES)[number], number>;

export interface AnonCounts {
  spend_inr: number;
  impressions: number;
  clicks: number;
  landing_page_sessions: number;
  registration_starts: number;
  reported_reach_sum: number;
}

export interface CampaignMetrics extends AnonCounts {
  campaign_id: string;
  campaign_name: string;
  channel: string;
  owner_name: string;
  status: string;
  planned_budget_inr: number | null;
  identified_external: number;
  registered_external: number;
  verified_visitors: number;
  status_counts: StatusCounts;
  cac_per_visitor_inr: number | null;
  cac_per_registration_inr: number | null;
  show_up_rate: number | null;
  share_of_visitor_goal: number | null;
  share_of_registration_goal: number | null;
}

export interface Snapshot {
  date: string;
  cutoff: string;
  event: EventInfo;
  phase: "pre_event" | "event" | "post_event";
  totals: {
    identified_external: number;
    registered_external: number;
    status_counts: StatusCounts;
    verified_visitors: number;
    verified_visitors_registered: number;
    verified_walkins: number;
    marketing_spend_inr: number;
    impressions: number;
    clicks: number;
    landing_page_sessions: number;
    registration_starts: number;
    reported_reach_sum: number;
    confirmed_at_event_start: number;
    show_up_rate: number | null;
    show_up_rate_vs_confirmed: number | null;
    cac_per_visitor_inr: number | null;
    cac_per_registration_inr: number | null;
    excluded_non_external: { identified: number; registered: number; verified_checkins: number };
  };
  targets: {
    version: string;
    effective_at: string;
    identified_external_people_goal: number;
    registration_goal: number;
    unique_external_visitors_goal: number;
    marketing_budget_inr: number;
  } | null;
  rates: Record<string, number | null>;
  by_campaign: Record<string, CampaignMetrics>;
  unattributed: { identified_external: number; registered_external: number; verified_visitors: number };
}

// ---------------------------------------------------------------------------
// Loading (cached per data_version)
// ---------------------------------------------------------------------------
const cache = globalThis as unknown as { __growthData?: RawData; __growthLoading?: Promise<RawData> };

function dedupe<T>(rows: T[], key: (r: T) => string, dupCounter: { n: number }): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const k = key(r);
    if (seen.has(k)) {
      dupCounter.n++;
      continue;
    }
    seen.add(k);
    out.push(r);
  }
  return out;
}

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const sn = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const lc = (v: unknown) => s(v).trim().toLowerCase();

async function currentVersion(): Promise<string> {
  await ensureSeeded();
  const r = await getDb().get<{ value: string }>("SELECT value FROM app_meta WHERE key = 'data_version'");
  return r?.value ?? "0";
}

export async function loadData(): Promise<RawData> {
  const version = await currentVersion();
  if (cache.__growthData && cache.__growthData.version === version) return cache.__growthData;
  if (cache.__growthLoading) {
    const d = await cache.__growthLoading;
    if (d.version === version) return d;
  }
  cache.__growthLoading = fetchAll(version);
  try {
    cache.__growthData = await cache.__growthLoading;
  } finally {
    cache.__growthLoading = undefined;
  }
  return cache.__growthData;
}

async function fetchAll(version: string): Promise<RawData> {
  const db = getDb();
  const [ev] = await db.all("SELECT * FROM event ORDER BY _rid");
  const targets = (await db.all("SELECT * FROM targets ORDER BY effective_at, _rid")).map((r) => ({
    effective_at: s(r.effective_at),
    identified_external_people_goal: num(r.identified_external_people_goal),
    registration_goal: num(r.registration_goal),
    unique_external_visitors_goal: num(r.unique_external_visitors_goal),
    marketing_budget_inr: num(r.marketing_budget_inr),
    target_version: s(r.target_version),
  }));
  const dups: Record<string, number> = {};
  const count = (k: string) => {
    const c = { n: 0 };
    return { c, done: () => (dups[k] = c.n) };
  };

  const cc = count("campaigns");
  const campaigns = dedupe(
    (await db.all("SELECT * FROM campaigns ORDER BY _rid")).map((r) => ({
      campaign_id: s(r.campaign_id),
      campaign_name: s(r.campaign_name),
      channel: s(r.channel),
      target_audience: s(r.target_audience),
      objective: s(r.objective),
      owner_name: s(r.owner_name),
      owner_id: s(r.owner_id),
      created_at: s(r.created_at),
      planned_start_at: s(r.planned_start_at),
      planned_end_at: s(r.planned_end_at),
    })),
    (r) => r.campaign_id,
    cc.c,
  ).sort((a, b) => a.campaign_id.localeCompare(b.campaign_id));
  cc.done();

  const meta = new Map<string, CampaignMeta>();
  for (const r of await db.all("SELECT * FROM campaigns_meta")) {
    meta.set(s(r.campaign_id), {
      campaign_id: s(r.campaign_id),
      status: s(r.status) || "active",
      owner_name: sn(r.owner_name),
      owner_id: sn(r.owner_id),
      planned_budget_inr: r.planned_budget_inr === null ? null : num(r.planned_budget_inr),
      notes: sn(r.notes),
      updated_at: sn(r.updated_at),
    });
  }

  const dc = count("daily_marketing");
  const daily = dedupe(
    (await db.all("SELECT * FROM daily_marketing ORDER BY _rid")).map((r) => ({
      activity_id: s(r.activity_id),
      activity_date: s(r.activity_date).slice(0, 10),
      campaign_id: s(r.campaign_id),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      reported_reach: num(r.reported_reach),
      landing_page_sessions: num(r.landing_page_sessions),
      registration_starts: num(r.registration_starts),
      marketing_spend_inr: num(r.marketing_spend_inr),
    })),
    (r) => r.activity_id,
    dc.c,
  );
  dc.done();

  const pc = count("people");
  const people = new Map<string, PersonRow>();
  for (const r of dedupe(
    await db.all("SELECT person_id, person_type, first_seen_at, first_touch_source, first_campaign_id FROM people ORDER BY _rid"),
    (r) => s(r.person_id),
    pc.c,
  )) {
    people.set(s(r.person_id), {
      person_id: s(r.person_id),
      person_type: lc(r.person_type),
      first_seen_at: s(r.first_seen_at),
      first_touch_source: s(r.first_touch_source),
      first_campaign_id: sn(r.first_campaign_id),
    });
  }
  pc.done();

  const rc = count("registrations");
  const regs = dedupe(
    (await db.all("SELECT registration_id, person_id, campaign_id, registered_at FROM registrations ORDER BY _rid")).map(
      (r) => ({
        registration_id: s(r.registration_id),
        person_id: s(r.person_id),
        campaign_id: sn(r.campaign_id),
        registered_at: s(r.registered_at),
      }),
    ),
    (r) => r.registration_id,
    rc.c,
  );
  rc.done();

  const hc = count("registration_history");
  const hist = dedupe(
    (await db.all("SELECT history_id, registration_id, effective_at, status FROM registration_history ORDER BY _rid")).map(
      (r) => ({
        history_id: s(r.history_id),
        registration_id: s(r.registration_id),
        effective_at: s(r.effective_at),
        status: lc(r.status),
      }),
    ),
    (r) => r.history_id,
    hc.c,
  );
  hc.done();
  const histByReg = new Map<string, HistRow[]>();
  for (const h of hist) {
    const arr = histByReg.get(h.registration_id) ?? [];
    arr.push(h);
    histByReg.set(h.registration_id, arr);
  }
  for (const arr of histByReg.values()) {
    arr.sort((a, b) => a.effective_at.localeCompare(b.effective_at) || a.history_id.localeCompare(b.history_id));
  }

  const kc = count("checkins");
  const checkins = dedupe(
    (await db.all(
      "SELECT event_id, person_id, registration_id, campaign_id, occurred_at, result, verification, source FROM checkins ORDER BY _rid",
    )).map((r) => ({
      event_id: s(r.event_id),
      person_id: s(r.person_id),
      registration_id: sn(r.registration_id),
      campaign_id: sn(r.campaign_id),
      occurred_at: s(r.occurred_at),
      result: lc(r.result),
      verification: lc(r.verification),
      source: lc(r.source),
    })),
    (r) => r.event_id,
    kc.c,
  );
  kc.done();

  const ic = count("interactions");
  const interactions = dedupe(
    (await db.all("SELECT interaction_id, person_id, campaign_id, occurred_at, event_type FROM interactions ORDER BY _rid")).map(
      (r) => ({
        interaction_id: s(r.interaction_id),
        person_id: s(r.person_id),
        campaign_id: sn(r.campaign_id),
        occurred_at: s(r.occurred_at),
        event_type: lc(r.event_type),
      }),
    ),
    (r) => r.interaction_id,
    ic.c,
  );
  ic.done();

  const settings: Settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const r of await db.all("SELECT key, value FROM app_settings")) {
    const k = s(r.key) as keyof Settings;
    if (k in settings) {
      try {
        Object.assign(settings[k], JSON.parse(s(r.value)));
      } catch {
        /* keep defaults for malformed settings */
      }
    }
  }

  // Event dates missing from the source fall back to the data's own range (never to constants).
  const days = [
    ...daily.map((r) => r.activity_date),
    ...regs.map((r) => r.registered_at.slice(0, 10)),
    ...checkins.map((r) => r.occurred_at.slice(0, 10)),
  ]
    .filter(Boolean)
    .sort();
  const firstDay = days[0] ?? new Date().toISOString().slice(0, 10);
  const lastDay = days[days.length - 1] ?? firstDay;
  const checkinTimes = checkins.map((c) => c.occurred_at).filter(Boolean).sort();
  const historyStart = s(ev?.history_start).slice(0, 10) || firstDay;
  const historyEnd = s(ev?.history_end).slice(0, 10) || lastDay;
  const kind = await db.get<{ value: string }>("SELECT value FROM app_meta WHERE key = 'dataset_kind'");

  return {
    version,
    datasetKind: kind?.value ?? "original",
    event: {
      event_name: s(ev?.event_name),
      history_start: historyStart,
      history_end: historyEnd,
      event_starts_at: s(ev?.event_starts_at) || checkinTimes[0] || `${historyEnd} 10:00:00`,
      event_ends_at: s(ev?.event_ends_at) || checkinTimes[checkinTimes.length - 1] || `${historyEnd} 20:00:00`,
      timezone: s(ev?.timezone) || "Asia/Kolkata",
      currency: s(ev?.currency) || "INR",
    },
    targets,
    campaigns,
    meta,
    daily,
    people,
    regs,
    histByReg,
    checkins,
    interactions,
    settings,
    duplicates: dups,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(d: string, label = "date"): string {
  if (!DATE_RE.test(d) || Number.isNaN(Date.parse(d + "T00:00:00Z"))) {
    throw new Error(`Invalid ${label} "${d}". Use YYYY-MM-DD.`);
  }
  return d;
}
export const cutoffOf = (d: string) => `${d} 23:59:59`;
export const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export function addDays(d: string, n: number): string {
  const t = new Date(d + "T00:00:00Z").getTime() + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
export function median(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function targetsAt(data: RawData, d: string): TargetRow | null {
  const cut = cutoffOf(d);
  let t: TargetRow | null = null;
  for (const row of data.targets) if (row.effective_at <= cut) t = row;
  return t;
}

function statusAt(data: RawData, registrationId: string, cut: string): string | null {
  const h = data.histByReg.get(registrationId);
  if (!h) return null;
  let st: string | null = null;
  for (const v of h) {
    if (v.effective_at <= cut) st = v.status;
    else break;
  }
  return st;
}

const isVerified = (c: CheckinRow) => c.result === "admitted" && c.verification === "verified";
const emptyStatus = (): StatusCounts => ({ interested: 0, confirmed: 0, cancelled: 0, waitlisted: 0 });
const emptyAnon = (): AnonCounts => ({
  spend_inr: 0,
  impressions: 0,
  clicks: 0,
  landing_page_sessions: 0,
  registration_starts: 0,
  reported_reach_sum: 0,
});

/** person_id -> campaign of their earliest registration at or before cut (external only). */
function registeredPeople(data: RawData, cut: string): Map<string, { campaign_id: string | null; registration_id: string; registered_at: string }> {
  const out = new Map<string, { campaign_id: string | null; registration_id: string; registered_at: string }>();
  for (const r of data.regs) {
    if (r.registered_at > cut) continue;
    if (data.people.get(r.person_id)?.person_type !== "external") continue;
    const prev = out.get(r.person_id);
    if (!prev || r.registered_at < prev.registered_at) {
      out.set(r.person_id, { campaign_id: r.campaign_id, registration_id: r.registration_id, registered_at: r.registered_at });
    }
  }
  return out;
}

/** person_id -> first verified admission timestamp at or before cut (external only). */
function verifiedPeople(data: RawData, cut: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of data.checkins) {
    if (!isVerified(c) || c.occurred_at > cut) continue;
    if (data.people.get(c.person_id)?.person_type !== "external") continue;
    const prev = out.get(c.person_id);
    if (!prev || c.occurred_at < prev) out.set(c.person_id, c.occurred_at);
  }
  return out;
}

export function phaseOf(data: RawData, d: string): Snapshot["phase"] {
  const cut = cutoffOf(d);
  if (cut < data.event.event_starts_at) return "pre_event";
  if (d < data.event.event_ends_at.slice(0, 10)) return "event";
  return "post_event";
}

// ---------------------------------------------------------------------------
// Snapshot (the golden-tested shape)
// ---------------------------------------------------------------------------
export async function getSnapshot(date: string): Promise<Snapshot> {
  return computeSnapshot(await loadData(), assertDate(date));
}

const snapMemo = new WeakMap<RawData, Map<string, Snapshot>>();

/** Memoised per loaded data version and date (callers must treat the result as read-only). */
export function computeSnapshot(data: RawData, d: string): Snapshot {
  let m = snapMemo.get(data);
  if (!m) snapMemo.set(data, (m = new Map()));
  const hit = m.get(d);
  if (hit) return hit;
  const out = buildSnapshot(data, d);
  m.set(d, out);
  return out;
}

function buildSnapshot(data: RawData, d: string): Snapshot {
  const cut = cutoffOf(d);
  const byC: Record<string, CampaignMetrics> = {};
  for (const c of data.campaigns) {
    const m = data.meta.get(c.campaign_id);
    byC[c.campaign_id] = {
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      channel: c.channel,
      owner_name: m?.owner_name || c.owner_name,
      status: m?.status || "active",
      planned_budget_inr: m?.planned_budget_inr ?? null,
      ...emptyAnon(),
      identified_external: 0,
      registered_external: 0,
      verified_visitors: 0,
      status_counts: emptyStatus(),
      cac_per_visitor_inr: null,
      cac_per_registration_inr: null,
      show_up_rate: null,
      share_of_visitor_goal: null,
      share_of_registration_goal: null,
    };
  }
  const ensure = (id: string | null) => {
    if (!id) return null;
    if (!byC[id]) {
      // A campaign id that appears in activity but not in the campaigns tab (e.g. added via edits).
      byC[id] = {
        campaign_id: id,
        campaign_name: id,
        channel: "unknown",
        owner_name: "",
        status: data.meta.get(id)?.status || "active",
        planned_budget_inr: data.meta.get(id)?.planned_budget_inr ?? null,
        ...emptyAnon(),
        identified_external: 0,
        registered_external: 0,
        verified_visitors: 0,
        status_counts: emptyStatus(),
        cac_per_visitor_inr: null,
        cac_per_registration_inr: null,
        show_up_rate: null,
        share_of_visitor_goal: null,
        share_of_registration_goal: null,
      };
    }
    return byC[id];
  };

  // Anonymous funnel + spend
  const anon = emptyAnon();
  for (const r of data.daily) {
    if (r.activity_date > d) continue;
    const c = ensure(r.campaign_id);
    for (const tgt of c ? [anon, c] : [anon]) {
      tgt.spend_inr += r.marketing_spend_inr;
      tgt.impressions += r.impressions;
      tgt.clicks += r.clicks;
      tgt.landing_page_sessions += r.landing_page_sessions;
      tgt.registration_starts += r.registration_starts;
      tgt.reported_reach_sum += r.reported_reach;
    }
  }

  // Identified external people
  let identified = 0;
  let identifiedNonExt = 0;
  const unattributed = { identified_external: 0, registered_external: 0, verified_visitors: 0 };
  for (const p of data.people.values()) {
    if (p.first_seen_at > cut || !p.first_seen_at) continue;
    if (p.person_type !== "external") {
      identifiedNonExt++;
      continue;
    }
    identified++;
    const c = ensure(p.first_campaign_id);
    if (c) c.identified_external++;
    else unattributed.identified_external++;
  }

  // Registered external people + status as of D
  const reg = registeredPeople(data, cut);
  let regNonExt = 0;
  for (const r of data.regs) {
    if (r.registered_at <= cut && data.people.get(r.person_id)?.person_type !== "external") regNonExt++;
  }
  for (const v of reg.values()) {
    const c = ensure(v.campaign_id);
    if (c) c.registered_external++;
    else unattributed.registered_external++;
  }
  const statusCounts = emptyStatus();
  const eventStartCut = data.event.event_starts_at && data.event.event_starts_at < cut ? data.event.event_starts_at : cut;
  const confirmedAtStart = new Set<string>();
  for (const r of data.regs) {
    if (data.people.get(r.person_id)?.person_type !== "external") continue;
    if (r.registered_at > cut) continue;
    const st = statusAt(data, r.registration_id, cut);
    if (st && st in statusCounts) {
      statusCounts[st as keyof StatusCounts]++;
      const c = ensure(r.campaign_id);
      if (c) c.status_counts[st as keyof StatusCounts]++;
    }
    if (statusAt(data, r.registration_id, eventStartCut) === "confirmed") confirmedAtStart.add(r.person_id);
  }

  // Verified visitors
  const vis = verifiedPeople(data, cut);
  let visReg = 0;
  let verifiedNonExt = 0;
  for (const c of data.checkins) {
    if (isVerified(c) && c.occurred_at <= cut && data.people.get(c.person_id)?.person_type !== "external") verifiedNonExt++;
  }
  let confirmedAndVisited = 0;
  for (const pid of vis.keys()) {
    const r = reg.get(pid);
    if (r) {
      visReg++;
      const c = ensure(r.campaign_id);
      if (c) c.verified_visitors++;
      else unattributed.verified_visitors++;
    } else {
      unattributed.verified_visitors++;
    }
    if (confirmedAtStart.has(pid)) confirmedAndVisited++;
  }

  const t = targetsAt(data, d);
  for (const c of Object.values(byC)) {
    c.cac_per_visitor_inr = div(c.spend_inr, c.verified_visitors);
    c.cac_per_registration_inr = div(c.spend_inr, c.registered_external);
    c.show_up_rate = div(c.verified_visitors, c.registered_external);
    c.share_of_visitor_goal = t ? div(c.verified_visitors, t.unique_external_visitors_goal) : null;
    c.share_of_registration_goal = t ? div(c.registered_external, t.registration_goal) : null;
  }

  const totals: Snapshot["totals"] = {
    identified_external: identified,
    registered_external: reg.size,
    status_counts: statusCounts,
    verified_visitors: vis.size,
    verified_visitors_registered: visReg,
    verified_walkins: vis.size - visReg,
    marketing_spend_inr: anon.spend_inr,
    impressions: anon.impressions,
    clicks: anon.clicks,
    landing_page_sessions: anon.landing_page_sessions,
    registration_starts: anon.registration_starts,
    reported_reach_sum: anon.reported_reach_sum,
    confirmed_at_event_start: confirmedAtStart.size,
    show_up_rate: div(visReg, reg.size),
    show_up_rate_vs_confirmed: div(confirmedAndVisited, confirmedAtStart.size),
    cac_per_visitor_inr: div(anon.spend_inr, vis.size),
    cac_per_registration_inr: div(anon.spend_inr, reg.size),
    excluded_non_external: { identified: identifiedNonExt, registered: regNonExt, verified_checkins: verifiedNonExt },
  };

  return {
    date: d,
    cutoff: cut + " IST",
    event: data.event,
    phase: phaseOf(data, d),
    totals,
    targets: t
      ? {
          version: t.target_version,
          effective_at: t.effective_at,
          identified_external_people_goal: t.identified_external_people_goal,
          registration_goal: t.registration_goal,
          unique_external_visitors_goal: t.unique_external_visitors_goal,
          marketing_budget_inr: t.marketing_budget_inr,
        }
      : null,
    rates: stageRates({
      impressions: anon.impressions,
      clicks: anon.clicks,
      sessions: anon.landing_page_sessions,
      starts: anon.registration_starts,
      identified,
      registered: reg.size,
      confirmed: statusCounts.confirmed,
      visitors_registered: visReg,
    }),
    by_campaign: byC,
    unattributed,
  };
}

export interface StageInput {
  impressions: number;
  clicks: number;
  sessions: number;
  starts: number;
  identified: number;
  registered: number;
  confirmed: number;
  visitors_registered: number;
}

/** Stage conversion rates. Anonymous-to-people ratios are event/people proxies, not true conversions. */
export function stageRates(x: StageInput): Record<string, number | null> {
  return {
    ctr: div(x.clicks, x.impressions),
    click_to_session: div(x.sessions, x.clicks),
    session_to_start: div(x.starts, x.sessions),
    start_to_registration_proxy: div(x.registered, x.starts),
    identified_to_registered: div(x.registered, x.identified),
    registered_to_confirmed: div(x.confirmed, x.registered),
    show_up: div(x.visitors_registered, x.registered),
  };
}

export const STAGE_LABELS: Record<string, string> = {
  ctr: "Impressions → clicks (CTR)",
  click_to_session: "Clicks → landing sessions",
  session_to_start: "Sessions → registration starts",
  start_to_registration_proxy: "Registration starts → registrations (proxy: events vs people)",
  identified_to_registered: "Identified → registered",
  registered_to_confirmed: "Registered → confirmed (status as of D)",
  show_up: "Registered → verified visitor (show-up)",
};

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------
export interface FunnelStage {
  key: string;
  label: string;
  value: number;
  rate_from_prev: number | null;
}
export interface Funnel {
  date: string;
  campaign_id: string | null;
  campaign_name: string;
  anonymous: FunnelStage[];
  people: FunnelStage[];
  rates: Record<string, number | null>;
  notes: string[];
}

export async function getFunnel(date: string, campaignId?: string | null): Promise<Funnel> {
  const data = await loadData();
  const snap = computeSnapshot(data, assertDate(date));
  return funnelFromSnapshot(snap, campaignId ?? null);
}

export function funnelFromSnapshot(snap: Snapshot, campaignId: string | null): Funnel {
  let a: AnonCounts & { identified: number; registered: number; confirmed: number; visitors: number; visitorsRegistered: number };
  let name = "All campaigns";
  if (campaignId) {
    const c = snap.by_campaign[campaignId];
    if (!c) throw new Error(`Unknown campaign_id "${campaignId}". Known: ${Object.keys(snap.by_campaign).join(", ")}`);
    name = c.campaign_name;
    a = {
      ...c,
      identified: c.identified_external,
      registered: c.registered_external,
      confirmed: c.status_counts.confirmed,
      visitors: c.verified_visitors,
      visitorsRegistered: c.verified_visitors,
    };
  } else {
    const t = snap.totals;
    a = {
      spend_inr: t.marketing_spend_inr,
      impressions: t.impressions,
      clicks: t.clicks,
      landing_page_sessions: t.landing_page_sessions,
      registration_starts: t.registration_starts,
      reported_reach_sum: t.reported_reach_sum,
      identified: t.identified_external,
      registered: t.registered_external,
      confirmed: t.status_counts.confirmed,
      visitors: t.verified_visitors,
      visitorsRegistered: t.verified_visitors_registered,
    };
  }
  const chain = (stages: [string, string, number][]): FunnelStage[] =>
    stages.map(([key, label, value], i) => ({
      key,
      label,
      value,
      rate_from_prev: i === 0 ? null : div(value, stages[i - 1][2]),
    }));
  return {
    date: snap.date,
    campaign_id: campaignId,
    campaign_name: name,
    anonymous: chain([
      ["impressions", "Impressions", a.impressions],
      ["clicks", "Clicks", a.clicks],
      ["landing_page_sessions", "Landing-page sessions", a.landing_page_sessions],
      ["registration_starts", "Registration starts", a.registration_starts],
    ]),
    people: chain([
      ["identified_external", "Identified external people", a.identified],
      ["registered_external", "Registered external people", a.registered],
      ["confirmed", "Confirmed (status as of D)", a.confirmed],
      ["verified_visitors", campaignId ? "Verified visitors (attributed)" : "Verified visitors (incl. walk-ins)", a.visitors],
    ]),
    rates: stageRates({
      impressions: a.impressions,
      clicks: a.clicks,
      sessions: a.landing_page_sessions,
      starts: a.registration_starts,
      identified: a.identified,
      registered: a.registered,
      confirmed: a.confirmed,
      visitors_registered: a.visitorsRegistered,
    }),
    notes: [
      "Anonymous counts are platform events (not people); they are not joined to identified people.",
      "Stages are not strictly nested: a verified visitor may have a cancelled/waitlisted status, and walk-ins have no registration.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Daily / cumulative trends
// ---------------------------------------------------------------------------
export const TREND_METRICS = [
  "spend_inr",
  "impressions",
  "clicks",
  "landing_page_sessions",
  "registration_starts",
  "identified_external",
  "registered_external",
  "verified_visitors",
  "confirmed",
] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];

export interface TrendPoint {
  date: string;
  daily: Record<TrendMetric, number>;
  cumulative: Record<TrendMetric, number>;
}

export async function getTrend(from: string, to: string, campaignId?: string | null): Promise<TrendPoint[]> {
  const data = await loadData();
  return computeTrend(data, assertDate(from, "from"), assertDate(to, "to"), campaignId ?? null);
}

export function computeTrend(data: RawData, from: string, to: string, campaignId: string | null): TrendPoint[] {
  if (from > to) throw new Error(`"from" (${from}) is after "to" (${to}).`);
  const start = data.event.history_start && data.event.history_start < from ? data.event.history_start : from;
  const days = dateRange(start, to);
  const idx = new Map(days.map((d, i) => [d, i]));
  const zero = () => Object.fromEntries(TREND_METRICS.map((m) => [m, 0])) as Record<TrendMetric, number>;
  const daily = days.map(() => zero());
  const bump = (day: string, m: TrendMetric, v = 1) => {
    const i = idx.get(day);
    if (i !== undefined) daily[i][m] += v;
  };
  const before = zero(); // totals strictly before the first day in range
  const add = (day: string, m: TrendMetric, v = 1) => {
    if (day < start) before[m] += v;
    else bump(day, m, v);
  };
  const cutTo = cutoffOf(to);

  for (const r of data.daily) {
    if (campaignId && r.campaign_id !== campaignId) continue;
    if (r.activity_date > to) continue;
    add(r.activity_date, "spend_inr", r.marketing_spend_inr);
    add(r.activity_date, "impressions", r.impressions);
    add(r.activity_date, "clicks", r.clicks);
    add(r.activity_date, "landing_page_sessions", r.landing_page_sessions);
    add(r.activity_date, "registration_starts", r.registration_starts);
  }
  for (const p of data.people.values()) {
    if (p.person_type !== "external" || !p.first_seen_at || p.first_seen_at > cutTo) continue;
    if (campaignId && p.first_campaign_id !== campaignId) continue;
    add(p.first_seen_at.slice(0, 10), "identified_external");
  }
  const reg = registeredPeople(data, cutTo);
  for (const v of reg.values()) {
    if (campaignId && v.campaign_id !== campaignId) continue;
    add(v.registered_at.slice(0, 10), "registered_external");
  }
  for (const [pid, at] of verifiedPeople(data, cutTo)) {
    // A person's attribution is their registration campaign as of the visit day.
    const r = reg.get(pid);
    const attributed = r && r.registered_at <= at.slice(0, 10) + " 23:59:59" ? r.campaign_id : null;
    if (campaignId && attributed !== campaignId) continue;
    add(at.slice(0, 10), "verified_visitors");
  }
  // Confirmed status count at the end of each day (a stock, stored as daily net change).
  for (const r of data.regs) {
    if (data.people.get(r.person_id)?.person_type !== "external") continue;
    if (campaignId && r.campaign_id !== campaignId) continue;
    const h = data.histByReg.get(r.registration_id) ?? [];
    let prev = false;
    for (const v of h) {
      if (v.effective_at > cutTo) break;
      const now = v.status === "confirmed";
      if (now !== prev) add(v.effective_at.slice(0, 10), "confirmed", now ? 1 : -1);
      prev = now;
    }
  }

  const out: TrendPoint[] = [];
  const cum = { ...before };
  days.forEach((d, i) => {
    for (const m of TREND_METRICS) cum[m] += daily[i][m];
    if (d >= from) out.push({ date: d, daily: { ...daily[i] }, cumulative: { ...cum } });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Budget pacing
// ---------------------------------------------------------------------------
export interface BudgetView {
  date: string;
  target_version: string | null;
  budget_inr: number | null;
  spend_to_date_inr: number;
  remaining_inr: number | null;
  pct_budget_used: number | null;
  window_start: string;
  window_end: string;
  pct_time_elapsed: number;
  pacing_index: number | null;
  avg_daily_spend_last_7d: number;
  days_remaining: number;
  projected_spend_at_window_end: number;
  projected_vs_budget: number | null;
  credits_to_date_inr: number;
  by_campaign: {
    campaign_id: string;
    campaign_name: string;
    planned_budget_inr: number | null;
    spend_inr: number;
    pct_of_planned: number | null;
    share_of_spend: number | null;
  }[];
  notes: string[];
}

export async function getBudget(date: string): Promise<BudgetView> {
  const data = await loadData();
  return computeBudget(data, assertDate(date));
}

export function computeBudget(data: RawData, d: string): BudgetView {
  const snap = computeSnapshot(data, d);
  const t = targetsAt(data, d);
  const start = data.event.history_start;
  const end = data.event.event_ends_at.slice(0, 10);
  const total = Math.max(1, daysBetween(start, end) + 1);
  const elapsed = Math.min(total, Math.max(0, daysBetween(start, d) + 1));
  const from7 = addDays(d, -6);
  let last7 = 0;
  let credits = 0;
  for (const r of data.daily) {
    if (r.activity_date > d) continue;
    if (r.activity_date >= from7) last7 += r.marketing_spend_inr;
    if (r.marketing_spend_inr < 0) credits += r.marketing_spend_inr;
  }
  const avg7 = last7 / 7;
  const daysRemaining = Math.max(0, daysBetween(d, end));
  const spend = snap.totals.marketing_spend_inr;
  const projected = spend + avg7 * daysRemaining;
  const budget = t?.marketing_budget_inr ?? null;
  const pctUsed = budget ? spend / budget : null;
  const pctTime = elapsed / total;
  return {
    date: d,
    target_version: t?.target_version ?? null,
    budget_inr: budget,
    spend_to_date_inr: spend,
    remaining_inr: budget === null ? null : budget - spend,
    pct_budget_used: pctUsed,
    window_start: start,
    window_end: end,
    pct_time_elapsed: pctTime,
    pacing_index: pctUsed === null ? null : pctUsed / pctTime,
    avg_daily_spend_last_7d: avg7,
    days_remaining: daysRemaining,
    projected_spend_at_window_end: projected,
    projected_vs_budget: budget ? projected / budget : null,
    credits_to_date_inr: credits,
    by_campaign: Object.values(snap.by_campaign).map((c) => ({
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      planned_budget_inr: c.planned_budget_inr,
      spend_inr: c.spend_inr,
      pct_of_planned: c.planned_budget_inr ? c.spend_inr / c.planned_budget_inr : null,
      share_of_spend: div(c.spend_inr, spend),
    })),
    notes: [
      "Spend is the net ledger amount (debits less credits) with activity_date <= D.",
      `Pacing index = % of budget used / % of the campaign window elapsed (${start} to ${end}); 1.0 = on pace.`,
      "Projected spend = spend to date + 7-day average daily spend x days remaining (estimate).",
      "Per-campaign planned budgets are app metadata (seeded as an assumption), not source data.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Projection of final outcomes vs goal
// ---------------------------------------------------------------------------
export interface Projection {
  date: string;
  method: "actual" | "pace_curve" | "simple_pace";
  method_note: string;
  goal: number | null;
  actual_to_date: number;
  projected: { low: number; mid: number; high: number };
  projected_vs_goal: { low: number | null; mid: number | null; high: number | null };
  registrations: {
    to_date: number;
    goal: number | null;
    pace_per_day: number;
    days_left_to_event: number;
    projected_low: number;
    projected_mid: number;
    projected_high: number;
  };
  /** Simple pace projection, always computed as a cross-check of the curve. */
  cross_check: { method: "simple_pace"; low: number; mid: number; high: number } | null;
  assumptions: string[];
  /** Per-campaign projection: projected registrations x campaign show-up (show-up differs a lot by channel). */
  per_campaign: CampaignProjection[];
  per_campaign_total: { registered_visitors: number; walkins: number; total: number; vs_goal: number | null };
  per_campaign_note: string;
}

export interface CampaignProjection {
  campaign_id: string;
  campaign_name: string;
  registrations_to_date: number;
  projected_registrations: number;
  registration_method: "actual" | "campaign_pace_curve" | "pooled_pace_curve" | "simple_pace";
  show_up_rate: number;
  show_up_source: string;
  projected_visitors: number;
  actual_visitors: number;
}

type ProjectionCore = Omit<Projection, "per_campaign" | "per_campaign_total" | "per_campaign_note">;

interface PacePoint {
  days_to_event: number;
  share_of_final: number | null;
  share_p10: number | null;
  share_p90: number | null;
  attendee_multiplier: number | null;
  attendee_multiplier_p10: number | null;
  attendee_multiplier_p90: number | null;
}
interface PaceCurve {
  eventDay: string;
  byDays: Map<number, PacePoint>;
  /** campaign_id -> (days_to_event -> cumulative share of that campaign's final registrations) */
  campaignShare: Map<string, Map<number, number>>;
  walkinRatio: number | null;
  source: string;
}

const finite = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : v === null || v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** analysis/derived/pace_curve.json (written by the analysis workstream), if present. */
function loadPaceCurve(): PaceCurve | null {
  // A copy ships inside the app (seed-data/) so deployments find it; the analysis folder is the source.
  const bundled = path.join(process.cwd(), "seed-data", "pace_curve.json");
  const file =
    process.env.PACE_CURVE_PATH ||
    (fs.existsSync(bundled) ? bundled : path.resolve(process.cwd(), "..", "analysis", "derived", "pace_curve.json"));
  if (!fs.existsSync(file)) return null;
  try {
    // The file is produced by pandas and may contain bare NaN tokens, which JSON.parse rejects.
    const raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/\bNaN\b/g, "null"));
    const pts = Array.isArray(raw?.curve) ? (raw.curve as Record<string, unknown>[]) : [];
    const byDays = new Map<number, PacePoint>();
    for (const p of pts) {
      const x = finite(p.days_to_event);
      if (x === null) continue;
      byDays.set(x, {
        days_to_event: x,
        share_of_final: finite(p.share_of_final),
        share_p10: finite(p.share_p10),
        share_p90: finite(p.share_p90),
        attendee_multiplier: finite(p.attendee_multiplier),
        attendee_multiplier_p10: finite(p.attendee_multiplier_p10),
        attendee_multiplier_p90: finite(p.attendee_multiplier_p90),
      });
    }
    if (!byDays.size) return null;
    const campaignShare = new Map<string, Map<number, number>>();
    for (const [cid, ms] of Object.entries((raw.campaign_share_at ?? {}) as Record<string, Record<string, unknown>>)) {
      const m = new Map<number, number>();
      for (const [k, v] of Object.entries(ms ?? {})) {
        const xm = k.match(/^T-(\d+)$/);
        const sv = finite(v);
        if (xm && sv !== null) m.set(Number(xm[1]), sv);
      }
      m.set(0, 1);
      campaignShare.set(cid, m);
    }
    return {
      eventDay: String(raw.event_day ?? ""),
      byDays,
      campaignShare,
      walkinRatio: finite(raw.constants?.walkin_ratio_to_registered_attendees),
      source: "2025 benchmark pace curve (pace_curve.json)",
    };
  } catch {
    return null;
  }
}

export async function getProjection(date: string): Promise<Projection> {
  const data = await loadData();
  return computeProjection(data, assertDate(date));
}

export function computeProjection(data: RawData, d: string): Projection {
  const core = projectionCore(data, d);
  return { ...core, ...campaignProjection(data, d, core) };
}

/** Linear interpolation of a campaign's cumulative registration share at T-x. */
function campaignShareAt(
  curve: PaceCurve,
  cid: string,
  x: number,
): { share: number; method: CampaignProjection["registration_method"] } | null {
  const pooled = curve.byDays.get(x)?.share_of_final ?? null;
  const m = curve.campaignShare.get(cid);
  if (m && m.size > 1) {
    const xs = [...m.keys()].sort((a, b) => a - b);
    const maxX = xs[xs.length - 1];
    if (x <= maxX) {
      for (let i = 0; i < xs.length - 1; i++) {
        const a = xs[i];
        const b = xs[i + 1];
        if (x >= a && x <= b) {
          const sa = m.get(a) as number;
          const sb = m.get(b) as number;
          return { share: sa + ((sb - sa) * (x - a)) / (b - a), method: "campaign_pace_curve" };
        }
      }
    }
    // Beyond the campaign's last milestone: scale the pooled curve by the campaign's relative pace there.
    const pooledAtMax = curve.byDays.get(maxX)?.share_of_final ?? null;
    if (pooled && pooledAtMax)
      return { share: Math.min(1, pooled * ((m.get(maxX) as number) / pooledAtMax)), method: "campaign_pace_curve" };
  }
  return pooled ? { share: pooled, method: "pooled_pace_curve" } : null;
}

/**
 * Projected attendees per campaign = projected registrations x that campaign's show-up.
 * Show-up differs 50-86% by channel, so a pooled rate misallocates the projection.
 */
function campaignProjection(
  data: RawData,
  d: string,
  core: ProjectionCore,
): Pick<Projection, "per_campaign" | "per_campaign_total" | "per_campaign_note"> {
  const snap = computeSnapshot(data, d);
  const a = data.settings.projection;
  const eventStartDay = data.event.event_starts_at.slice(0, 10);
  const curve = loadPaceCurve();
  // Days to THIS dataset's event start; the curve is indexed by days to event, not by calendar date.
  const x = daysBetween(d, eventStartDay);
  const post = snap.phase === "post_event";
  // Channel show-up prior: each campaign's observed show-up at the end of the history (this
  // data's outcome). Before/during the event this is an in-sample prior and is labelled as an assumption.
  const finalSnap = computeSnapshot(data, data.event.history_end);
  const winStart = addDays(d, -(a.pace_window_days - 1));
  const daysLeft = Math.max(0, daysBetween(d, eventStartDay) - 1);
  const recent: Record<string, number> = {};
  for (const v of registeredPeople(data, cutoffOf(d)).values())
    if (v.campaign_id && v.registered_at.slice(0, 10) >= winStart) recent[v.campaign_id] = (recent[v.campaign_id] ?? 0) + 1;

  const rows: CampaignProjection[] = Object.values(snap.by_campaign).map((c) => {
    const regs = c.registered_external;
    let projRegs = regs;
    let method: CampaignProjection["registration_method"] = "actual";
    if (snap.phase === "pre_event") {
      // Per-campaign curves were fitted on the provided workbook's campaigns; an upload's campaign IDs
      // may reuse those codes for different campaigns, so uploads use the pooled benchmark only.
      const sh = curve ? campaignShareAt(curve, data.datasetKind === "upload" ? "" : c.campaign_id, x) : null;
      if (sh && sh.share > 0 && regs > 0) {
        projRegs = Math.max(regs, regs / sh.share);
        method = sh.method;
      } else {
        projRegs = regs + ((recent[c.campaign_id] ?? 0) / a.pace_window_days) * daysLeft;
        method = "simple_pace";
      }
    }
    let show: number;
    let src: string;
    if (post && c.show_up_rate !== null) {
      show = c.show_up_rate;
      src = "actual (as of D)";
    } else {
      const prior = finalSnap.by_campaign[c.campaign_id]?.show_up_rate;
      if (prior) {
        show = prior;
        src = "channel prior: observed show-up in this data (in-sample assumption)";
      } else {
        show = a.showup_mid;
        src = "assumed (projection settings)";
      }
    }
    const projected = post ? c.verified_visitors : Math.max(c.verified_visitors, projRegs * show);
    return {
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      registrations_to_date: regs,
      projected_registrations: Math.round(projRegs),
      registration_method: method,
      show_up_rate: show,
      show_up_source: src,
      projected_visitors: Math.round(projected),
      actual_visitors: c.verified_visitors,
    };
  });
  const regVisitors = rows.reduce((sum, r) => sum + r.projected_visitors, 0);
  const walkRatio = curve?.walkinRatio ?? a.walkin_ratio;
  const walkins = post
    ? snap.totals.verified_walkins
    : Math.max(snap.totals.verified_walkins, Math.round(regVisitors * walkRatio));
  const total = post ? snap.totals.verified_visitors : regVisitors + walkins;
  return {
    per_campaign: rows,
    per_campaign_total: { registered_visitors: regVisitors, walkins, total, vs_goal: core.goal ? total / core.goal : null },
    per_campaign_note: post
      ? "Event has ended: per-campaign values are actual verified visitors."
      : `Per campaign: projected registrations (campaign pace curve at T-${x} where available, else simple pace) x that campaign's show-up prior; walk-ins add ${(walkRatio * 100).toFixed(1)}% of registered visitors. [Assumption] Show-up priors are each channel's observed show-up in this data, i.e. in-sample.${curve ? ` The pace curve is the ${curve.source}, not fitted on this data.` : ""}`,
  };
}

function projectionCore(data: RawData, d: string): ProjectionCore {
  const snap = computeSnapshot(data, d);
  const a = data.settings.projection;
  const goal = snap.targets?.unique_external_visitors_goal ?? null;
  const regGoal = snap.targets?.registration_goal ?? null;
  const eventStartDay = data.event.event_starts_at.slice(0, 10);
  const registered = snap.totals.registered_external;
  const actual = snap.totals.verified_visitors;
  const vsGoal = (x: number) => (goal ? x / goal : null);

  // Simple pace: registrations/day over the trailing window, extended to the day before the event.
  const winStart = addDays(d, -(a.pace_window_days - 1));
  let recent = 0;
  for (const v of registeredPeople(data, cutoffOf(d)).values()) if (v.registered_at.slice(0, 10) >= winStart) recent++;
  const pace = recent / a.pace_window_days;
  const daysLeft = Math.max(0, daysBetween(d, eventStartDay) - 1);
  const sRegLow = registered + pace * 0.8 * daysLeft;
  const sRegMid = registered + pace * daysLeft;
  const sRegHigh = registered + pace * 1.2 * daysLeft;
  const walk = a.walkin_ratio;
  const simple = {
    low: sRegLow * a.showup_low * (1 + walk),
    mid: sRegMid * a.showup_mid * (1 + walk),
    high: sRegHigh * a.showup_high * (1 + walk),
  };
  const simpleAssumptions = [
    `Simple pace: ${pace.toFixed(1)} registrations/day (last ${a.pace_window_days} days) x ${daysLeft} day(s) left; low/high pace = 0.8x / 1.2x.`,
    `Show-up ${(a.showup_low * 100).toFixed(0)}% / ${(a.showup_mid * 100).toFixed(0)}% / ${(a.showup_high * 100).toFixed(0)}% of registered, plus walk-ins = ${(walk * 100).toFixed(0)}% of registered visitors (assumptions, editable).`,
  ];

  if (snap.phase === "post_event") {
    return {
      date: d,
      method: "actual",
      method_note: "Event has ended: the outcome is the actual verified visitor count as of D.",
      goal,
      actual_to_date: actual,
      projected: { low: actual, mid: actual, high: actual },
      projected_vs_goal: { low: vsGoal(actual), mid: vsGoal(actual), high: vsGoal(actual) },
      registrations: {
        to_date: registered,
        goal: regGoal,
        pace_per_day: pace,
        days_left_to_event: 0,
        projected_low: registered,
        projected_mid: registered,
        projected_high: registered,
      },
      cross_check: null,
      assumptions: ["No projection after the event: values are actuals."],
    };
  }

  const floor = (x: number) => (snap.phase === "event" ? Math.max(x, actual) : x);
  const curve = loadPaceCurve();
  const x = daysBetween(d, eventStartDay);
  const pt = curve?.byDays.get(x);
  if (curve && pt && pt.attendee_multiplier !== null && pt.share_of_final && registered > 0) {
    const mid = registered * pt.attendee_multiplier;
    const low = registered * (pt.attendee_multiplier_p10 ?? pt.attendee_multiplier);
    const high = registered * (pt.attendee_multiplier_p90 ?? pt.attendee_multiplier);
    const regMid = registered / pt.share_of_final;
    const regLow = pt.share_p90 ? registered / pt.share_p90 : regMid;
    const regHigh = pt.share_p10 ? registered / pt.share_p10 : regMid;
    return {
      date: d,
      method: "pace_curve",
      method_note: `Pace curve (${curve.source}) at T-${x}: ${(pt.share_of_final * 100).toFixed(1)}% of final registrations are typically in; visitors = registrations x attendee multiplier ${pt.attendee_multiplier.toFixed(3)} (band p10-p90).`,
      goal,
      actual_to_date: actual,
      projected: { low: Math.round(floor(low)), mid: Math.round(floor(mid)), high: Math.round(floor(high)) },
      projected_vs_goal: { low: vsGoal(floor(low)), mid: vsGoal(floor(mid)), high: vsGoal(floor(high)) },
      registrations: {
        to_date: registered,
        goal: regGoal,
        pace_per_day: pace,
        days_left_to_event: daysLeft,
        projected_low: Math.round(regLow),
        projected_mid: Math.round(regMid),
        projected_high: Math.round(regHigh),
      },
      cross_check: { method: "simple_pace", low: Math.round(floor(simple.low)), mid: Math.round(floor(simple.mid)), high: Math.round(floor(simple.high)) },
      assumptions: [
        data.datasetKind === "upload"
          ? "[Assumption] The pace curve is a 2025 benchmark fitted on another event (CampusFest 2025), not on this data; treat the projection as a template, and the p10-p90 band as the uncertainty."
          : "[Assumption] The curve's share-of-final and multipliers are a 2025 benchmark fitted on this same 2025 outcome, so for 2025 dates the mid value reproduces the known result by construction; the p10-p90 band (campaign bootstrap) is the honest uncertainty. Use it as a template for the next event.",
        "Cross-check shows the simple pace method, which uses only data up to D.",
        ...(snap.phase === "event" ? ["During the event the projection is floored at visitors already verified."] : []),
        ...simpleAssumptions,
      ],
    };
  }

  return {
    date: d,
    method: "simple_pace",
    method_note: `Simple pace projection (no applicable pace curve at T-${x}${curve ? "" : "; pace_curve.json not found"}).`,
    goal,
    actual_to_date: actual,
    projected: { low: Math.round(floor(simple.low)), mid: Math.round(floor(simple.mid)), high: Math.round(floor(simple.high)) },
    projected_vs_goal: { low: vsGoal(floor(simple.low)), mid: vsGoal(floor(simple.mid)), high: vsGoal(floor(simple.high)) },
    registrations: {
      to_date: registered,
      goal: regGoal,
      pace_per_day: pace,
      days_left_to_event: daysLeft,
      projected_low: Math.round(sRegLow),
      projected_mid: Math.round(sRegMid),
      projected_high: Math.round(sRegHigh),
    },
    cross_check: null,
    assumptions: [
      ...simpleAssumptions,
      ...(snap.phase === "event" ? ["During the event the projection is floored at visitors already verified."] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// What changed between two snapshot dates
// ---------------------------------------------------------------------------
export interface ChangeReport {
  from: string;
  to: string;
  target_version_change: { from: string | null; to: string | null } | null;
  totals: { metric: string; from: number | null; to: number | null; delta: number | null }[];
  by_campaign: {
    campaign_id: string;
    campaign_name: string;
    spend_delta: number;
    registered_delta: number;
    visitors_delta: number;
    identified_delta: number;
    cac_per_registration_from: number | null;
    cac_per_registration_to: number | null;
    share_of_registration_change: number | null;
  }[];
  highlights: string[];
}

export async function compareSnapshots(from: string, to: string): Promise<ChangeReport> {
  const data = await loadData();
  return computeChanges(data, assertDate(from, "from"), assertDate(to, "to"));
}

export function computeChanges(data: RawData, from: string, to: string): ChangeReport {
  const a = computeSnapshot(data, from);
  const b = computeSnapshot(data, to);
  const keys: [string, (s: Snapshot) => number | null][] = [
    ["identified_external", (s) => s.totals.identified_external],
    ["registered_external", (s) => s.totals.registered_external],
    ["confirmed", (s) => s.totals.status_counts.confirmed],
    ["cancelled", (s) => s.totals.status_counts.cancelled],
    ["waitlisted", (s) => s.totals.status_counts.waitlisted],
    ["verified_visitors", (s) => s.totals.verified_visitors],
    ["marketing_spend_inr", (s) => s.totals.marketing_spend_inr],
    ["impressions", (s) => s.totals.impressions],
    ["clicks", (s) => s.totals.clicks],
    ["landing_page_sessions", (s) => s.totals.landing_page_sessions],
    ["registration_starts", (s) => s.totals.registration_starts],
    ["cac_per_registration_inr", (s) => s.totals.cac_per_registration_inr],
    ["registration_goal", (s) => s.targets?.registration_goal ?? null],
    ["unique_external_visitors_goal", (s) => s.targets?.unique_external_visitors_goal ?? null],
    ["marketing_budget_inr", (s) => s.targets?.marketing_budget_inr ?? null],
  ];
  const totals = keys.map(([metric, f]) => {
    const x = f(a);
    const y = f(b);
    return { metric, from: x, to: y, delta: x === null || y === null ? null : y - x };
  });
  const regDeltaTotal = b.totals.registered_external - a.totals.registered_external;
  const by = Object.values(b.by_campaign).map((cb) => {
    const ca = a.by_campaign[cb.campaign_id];
    const rd = cb.registered_external - (ca?.registered_external ?? 0);
    return {
      campaign_id: cb.campaign_id,
      campaign_name: cb.campaign_name,
      spend_delta: cb.spend_inr - (ca?.spend_inr ?? 0),
      registered_delta: rd,
      visitors_delta: cb.verified_visitors - (ca?.verified_visitors ?? 0),
      identified_delta: cb.identified_external - (ca?.identified_external ?? 0),
      cac_per_registration_from: ca?.cac_per_registration_inr ?? null,
      cac_per_registration_to: cb.cac_per_registration_inr,
      share_of_registration_change: regDeltaTotal ? rd / regDeltaTotal : null,
    };
  });
  const highlights: string[] = [];
  const tv =
    a.targets?.version !== b.targets?.version
      ? { from: a.targets?.version ?? null, to: b.targets?.version ?? null }
      : null;
  if (tv) highlights.push(`Target plan changed from "${tv.from}" to "${tv.to}".`);
  const topReg = [...by].sort((x, y) => y.registered_delta - x.registered_delta)[0];
  if (topReg && topReg.registered_delta > 0)
    highlights.push(
      `${topReg.campaign_name} added the most registrations (+${topReg.registered_delta}, ${((topReg.share_of_registration_change ?? 0) * 100).toFixed(0)}% of the change).`,
    );
  const topSpend = [...by].sort((x, y) => y.spend_delta - x.spend_delta)[0];
  if (topSpend && topSpend.spend_delta > 0)
    highlights.push(`${topSpend.campaign_name} spent the most in the period (INR ${Math.round(topSpend.spend_delta).toLocaleString("en-IN")}).`);
  const v = totals.find((t) => t.metric === "verified_visitors");
  if (v?.delta) highlights.push(`Verified visitors changed by ${v.delta > 0 ? "+" : ""}${v.delta}.`);
  return { from, to, target_version_change: tv, totals, by_campaign: by, highlights };
}

// ---------------------------------------------------------------------------
// Engagement (identified interactions) – supporting context
// ---------------------------------------------------------------------------
export async function getEngagement(date: string, campaignId?: string | null) {
  const data = await loadData();
  const cut = cutoffOf(assertDate(date));
  const counts: Record<string, number> = {};
  const people: Record<string, Set<string>> = {};
  for (const i of data.interactions) {
    if (i.occurred_at > cut) continue;
    if (campaignId && i.campaign_id !== campaignId) continue;
    if (data.people.get(i.person_id)?.person_type !== "external") continue;
    counts[i.event_type] = (counts[i.event_type] ?? 0) + 1;
    (people[i.event_type] ??= new Set()).add(i.person_id);
  }
  return {
    date,
    campaign_id: campaignId ?? null,
    events: counts,
    distinct_people: Object.fromEntries(Object.entries(people).map(([k, v]) => [k, v.size])),
    note: "Identified interactions of external people at or before D. Email opens/reach do not prove attendance.",
  };
}

/** Data quality summary (import copies removed, people excluded) for transparency. */
export async function getDataQuality(date: string) {
  const data = await loadData();
  const snap = computeSnapshot(data, assertDate(date));
  const types: Record<string, number> = {};
  for (const p of data.people.values()) types[p.person_type] = (types[p.person_type] ?? 0) + 1;
  const checkinBreakdown: Record<string, number> = {};
  for (const c of data.checkins) {
    if (c.occurred_at > snap.cutoff.slice(0, 19)) continue;
    const k = `${c.result}/${c.verification}`;
    checkinBreakdown[k] = (checkinBreakdown[k] ?? 0) + 1;
  }
  return {
    duplicates_removed: data.duplicates,
    person_types: types,
    checkins_by_result_verification: checkinBreakdown,
    excluded_non_external: snap.totals.excluded_non_external,
  };
}

export async function getCampaignList() {
  const data = await loadData();
  return data.campaigns.map((c) => ({ ...c, meta: data.meta.get(c.campaign_id) ?? null }));
}

export async function getEventInfo() {
  return (await loadData()).event;
}

export async function getSettings(): Promise<Settings> {
  return (await loadData()).settings;
}

// ---------------------------------------------------------------------------
// Golden shape (analysis/golden_metrics.json contract)
// ---------------------------------------------------------------------------
const roundInr = (x: number | null) => (x === null ? null : Math.round(x));
const roundRate = (x: number | null) => (x === null ? null : Math.round(x * 1e4) / 1e4);

/** Snapshot in the exact shape and rounding of analysis/golden_metrics.json
 *  (INR: Math.round; rates: 4 dp; null when the denominator is 0). */
export function toGoldenShape(s: Snapshot) {
  const t = s.totals;
  return {
    identified_external: t.identified_external,
    registered_external: t.registered_external,
    status_counts: { ...t.status_counts },
    verified_visitors: t.verified_visitors,
    verified_visitors_registered: t.verified_visitors_registered,
    verified_walkins: t.verified_walkins,
    marketing_spend_inr: roundInr(t.marketing_spend_inr),
    impressions: t.impressions,
    clicks: t.clicks,
    landing_page_sessions: t.landing_page_sessions,
    registration_starts: t.registration_starts,
    targets: s.targets
      ? {
          version: s.targets.version,
          identified_external_people_goal: s.targets.identified_external_people_goal,
          registration_goal: s.targets.registration_goal,
          unique_external_visitors_goal: s.targets.unique_external_visitors_goal,
          marketing_budget_inr: s.targets.marketing_budget_inr,
        }
      : null,
    derived: {
      show_up_rate: roundRate(t.show_up_rate),
      confirmed_at_event_start: t.confirmed_at_event_start,
      show_up_rate_vs_confirmed: roundRate(t.show_up_rate_vs_confirmed),
      cac_per_visitor_inr: roundInr(t.cac_per_visitor_inr),
      cac_per_registration_inr: roundInr(t.cac_per_registration_inr),
    },
    by_campaign: Object.fromEntries(
      Object.values(s.by_campaign).map((c) => [
        c.campaign_id,
        {
          spend_inr: roundInr(c.spend_inr),
          impressions: c.impressions,
          clicks: c.clicks,
          landing_page_sessions: c.landing_page_sessions,
          registration_starts: c.registration_starts,
          identified_external: c.identified_external,
          registered_external: c.registered_external,
          verified_visitors: c.verified_visitors,
          cac_per_visitor_inr: roundInr(c.cac_per_visitor_inr),
          cac_per_registration_inr: roundInr(c.cac_per_registration_inr),
          show_up_rate: roundRate(c.show_up_rate),
        },
      ]),
    ),
  };
}

export async function getGoldenSnapshot(date: string) {
  return toGoldenShape(await getSnapshot(date));
}

// ---------------------------------------------------------------------------
// Active dataset range (drives the timeline, default snapshot date and ?d= clamping)
// ---------------------------------------------------------------------------
export async function getDataRange(): Promise<DataRange> {
  const data = await loadData();
  const e = data.event;
  const start = e.history_start;
  const end = e.history_end >= start ? e.history_end : start;
  const eventStart = e.event_starts_at.slice(0, 10) || end;
  const eventEnd = e.event_ends_at.slice(0, 10) || eventStart;
  const active = await getDb().get<{ id: string }>("SELECT id FROM dataset_versions WHERE is_active = 1").catch(() => undefined);
  return {
    start,
    end,
    eventStart,
    eventEnd,
    defaultDate: clampToRange(eventEnd, { start, end }),
    eventName: e.event_name,
    datasetId: active?.id ?? data.version,
  };
}

/** The ?d= snapshot date for a server page or API route: validated and clamped to the active data. */
export async function snapshotDate(d: string | null | undefined): Promise<string> {
  return resolveDate(d, await getDataRange());
}
