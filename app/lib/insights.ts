/**
 * Diagnose & Decide layer. Pure functions over lib/metrics.ts outputs; every rule and
 * threshold is visible (thresholds live in app_settings and are editable in the UI).
 */
import {
  STAGE_LABELS,
  addDays,
  assertDate,
  computeSnapshot,
  cutoffOf,
  div,
  loadData,
  median,
  type CampaignMetrics,
  type RawData,
  type Snapshot,
  stageRates,
} from "./metrics";
import type { Thresholds } from "./settings";

export type CacBasis = "visitor" | "registration";

export interface StageCompare {
  stage: string;
  label: string;
  campaign_rate: number | null;
  overall_rate: number | null;
  ratio_to_overall: number | null;
}

export interface CampaignDiagnosis {
  campaign_id: string;
  campaign_name: string;
  owner_name: string;
  status: string;
  spend_inr: number;
  registered_external: number;
  verified_visitors: number;
  cac: number | null;
  cac_ratio_to_median: number | null;
  show_up_rate: number | null;
  show_up_ratio_to_median: number | null;
  efficiency_index: number | null;
  verdict: "over-performing" | "on par" | "under-performing" | "insufficient data";
  rank: number;
  stages: StageCompare[];
  bottleneck: StageCompare | null;
}

export interface Diagnosis {
  date: string;
  cac_basis: CacBasis;
  cac_basis_note: string;
  median_cac: number | null;
  median_show_up: number | null;
  overall_rates: Record<string, number | null>;
  campaigns: CampaignDiagnosis[];
  method: string[];
}

function campaignRates(c: CampaignMetrics) {
  return stageRates({
    impressions: c.impressions,
    clicks: c.clicks,
    sessions: c.landing_page_sessions,
    starts: c.registration_starts,
    identified: c.identified_external,
    registered: c.registered_external,
    confirmed: c.status_counts.confirmed,
    visitors_registered: c.verified_visitors,
  });
}

export function computeDiagnosis(snap: Snapshot): Diagnosis {
  const cs = Object.values(snap.by_campaign);
  const basis: CacBasis = snap.totals.verified_visitors > 0 ? "visitor" : "registration";
  const cacOf = (c: CampaignMetrics) => (basis === "visitor" ? c.cac_per_visitor_inr : c.cac_per_registration_inr);
  const medCac = median(cs.map(cacOf));
  const medShow = basis === "visitor" ? median(cs.map((c) => c.show_up_rate)) : null;
  const overall = { ...snap.rates };
  // Overall show-up for campaign comparison excludes walk-ins (they have no campaign).
  if (basis !== "visitor") overall.show_up = null;

  const rows: CampaignDiagnosis[] = cs.map((c) => {
    const cac = cacOf(c);
    const cacRatio = cac !== null && medCac ? cac / medCac : null;
    const showRatio = c.show_up_rate !== null && medShow ? c.show_up_rate / medShow : null;
    // Efficiency index: (median CAC / CAC) x (show-up / median show-up). > 1 is better than median.
    const eff =
      cacRatio !== null && cacRatio > 0 ? (1 / cacRatio) * (showRatio ?? 1) : cac !== null && cac <= 0 ? Infinity : null;
    const verdict: CampaignDiagnosis["verdict"] =
      eff === null ? "insufficient data" : eff >= 1.1 ? "over-performing" : eff <= 0.9 ? "under-performing" : "on par";
    const rates = campaignRates(c);
    const stages: StageCompare[] = Object.keys(STAGE_LABELS)
      .filter((k) => !(k === "show_up" && basis !== "visitor"))
      .map((k) => ({
        stage: k,
        label: STAGE_LABELS[k],
        campaign_rate: rates[k],
        overall_rate: overall[k],
        ratio_to_overall:
          rates[k] !== null && overall[k] ? (rates[k] as number) / (overall[k] as number) : null,
      }));
    const bottleneck =
      stages
        .filter((s) => s.ratio_to_overall !== null)
        .sort((a, b) => (a.ratio_to_overall as number) - (b.ratio_to_overall as number))[0] ?? null;
    return {
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      owner_name: c.owner_name,
      status: c.status,
      spend_inr: c.spend_inr,
      registered_external: c.registered_external,
      verified_visitors: c.verified_visitors,
      cac,
      cac_ratio_to_median: cacRatio,
      show_up_rate: c.show_up_rate,
      show_up_ratio_to_median: showRatio,
      efficiency_index: eff === Infinity ? null : eff,
      verdict,
      rank: 0,
      stages,
      bottleneck,
    };
  });
  rows
    .sort((a, b) => (b.efficiency_index ?? -1) - (a.efficiency_index ?? -1))
    .forEach((r, i) => (r.rank = i + 1));

  return {
    date: snap.date,
    cac_basis: basis,
    cac_basis_note:
      basis === "visitor"
        ? "CAC per verified visitor (spend / attributed verified visitors)."
        : "No verified visitors yet at this date, so CAC per registration is used and show-up is not assessed.",
    median_cac: medCac,
    median_show_up: medShow,
    overall_rates: overall,
    campaigns: rows,
    method: [
      "Median taken across campaigns with a defined CAC.",
      "Efficiency index = (median CAC / campaign CAC) x (campaign show-up / median show-up); >= 1.1 over-performing, <= 0.9 under-performing.",
      "Bottleneck = the stage whose conversion is lowest relative to the overall rate for all campaigns.",
      "Starts -> registrations compares anonymous form-start events with identified people, so it is a proxy, not a true conversion.",
    ],
  };
}

export async function getDiagnosis(date: string): Promise<Diagnosis> {
  const data = await loadData();
  return computeDiagnosis(computeSnapshot(data, assertDate(date)));
}

// ---------------------------------------------------------------------------
// Recommendations (transparent rules)
// ---------------------------------------------------------------------------
export interface Recommendation {
  campaign_id: string;
  campaign_name: string;
  owner_name: string;
  campaign_status: string;
  action: "scale" | "change" | "stop" | "maintain";
  rule: string;
  evidence: string[];
  suggested_task: { title: string; description: string; priority: "high" | "medium" | "low"; owner_name: string; campaign_id: string };
}

const pct = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(d)}%`);
const inr = (x: number | null | undefined) =>
  x === null || x === undefined ? "n/a" : `INR ${Math.round(x).toLocaleString("en-IN")}`;
const ratio = (x: number | null) => (x === null ? "n/a" : `${x.toFixed(2)}x`);

export function computeRecommendations(diag: Diagnosis, t: Thresholds): Recommendation[] {
  const unit = diag.cac_basis === "visitor" ? "visitor" : "registration";
  return diag.campaigns.map((c) => {
    const volume = diag.cac_basis === "visitor" ? c.verified_visitors : c.registered_external;
    const ev = [
      `CAC per ${unit}: ${inr(c.cac)} vs median ${inr(diag.median_cac)} (${ratio(c.cac_ratio_to_median)}).`,
      diag.cac_basis === "visitor"
        ? `Show-up rate: ${pct(c.show_up_rate)} vs median ${pct(diag.median_show_up)} (${ratio(c.show_up_ratio_to_median)}).`
        : "Show-up not assessed (no check-ins yet).",
      `Volume: ${volume} ${unit}s, spend ${inr(c.spend_inr)}.`,
    ];
    if (c.bottleneck)
      ev.push(
        `Weakest stage: ${c.bottleneck.label} at ${pct(c.bottleneck.campaign_rate)} vs overall ${pct(c.bottleneck.overall_rate)} (${ratio(c.bottleneck.ratio_to_overall)}).`,
      );

    let action: Recommendation["action"] = "maintain";
    let rule = "No rule triggered: keep running and monitor.";
    const cr = c.cac_ratio_to_median;
    const sr = c.show_up_ratio_to_median;
    if ((cr !== null && cr > t.stop_cac_ratio) || (sr !== null && sr < t.stop_showup_ratio)) {
      action = "stop";
      rule =
        cr !== null && cr > t.stop_cac_ratio
          ? `STOP: CAC ${ratio(cr)} median > ${t.stop_cac_ratio}x threshold.`
          : `STOP: show-up ${ratio(sr)} median < ${t.stop_showup_ratio}x threshold.`;
    } else if (cr !== null && cr < t.scale_cac_ratio && volume >= t.min_volume) {
      action = "scale";
      rule = `SCALE: CAC ${ratio(cr)} median < ${t.scale_cac_ratio}x and volume ${volume} >= ${t.min_volume}.`;
    } else if (c.bottleneck && c.bottleneck.ratio_to_overall !== null && c.bottleneck.ratio_to_overall < t.bad_stage_ratio) {
      action = "change";
      rule = `CHANGE: CAC within range but "${c.bottleneck.label}" is ${ratio(c.bottleneck.ratio_to_overall)} the overall rate (< ${t.bad_stage_ratio}x).`;
    } else if (cr !== null && cr < t.scale_cac_ratio) {
      rule = `CAC ${ratio(cr)} median is good but volume ${volume} < ${t.min_volume}: test a small budget increase before scaling.`;
    }

    const task = {
      stop: {
        title: `Pause ${c.campaign_name} and review spend`,
        description: `Rule: ${rule} Evidence: ${ev.join(" ")} Pause new spend, confirm no committed vendor costs, and propose where to move the remaining budget.`,
        priority: "high" as const,
      },
      scale: {
        title: `Scale ${c.campaign_name}: raise budget in a controlled step`,
        description: `Rule: ${rule} Evidence: ${ev.join(" ")} Increase daily budget by ~20%, watch CAC weekly, roll back if CAC rises above the median.`,
        priority: "high" as const,
      },
      change: {
        title: `Fix ${c.campaign_name} bottleneck: ${c.bottleneck?.label ?? "weak stage"}`,
        description: `Rule: ${rule} Evidence: ${ev.join(" ")} Run one targeted fix on this stage (creative, landing page, form or reminder flow) and re-check in 7 days.`,
        priority: "medium" as const,
      },
      maintain: {
        title: `Monitor ${c.campaign_name} weekly`,
        description: `Rule: ${rule} Evidence: ${ev.join(" ")}`,
        priority: "low" as const,
      },
    }[action];

    return {
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      owner_name: c.owner_name,
      campaign_status: c.status,
      action,
      rule,
      evidence: ev,
      suggested_task: { ...task, owner_name: c.owner_name, campaign_id: c.campaign_id },
    };
  });
}

export async function getRecommendations(date: string) {
  const data = await loadData();
  const diag = computeDiagnosis(computeSnapshot(data, assertDate(date)));
  return {
    date,
    thresholds: data.settings.thresholds,
    cac_basis: diag.cac_basis,
    median_cac: diag.median_cac,
    median_show_up: diag.median_show_up,
    recommendations: computeRecommendations(diag, data.settings.thresholds),
    rules: [
      `Scale: CAC < ${data.settings.thresholds.scale_cac_ratio}x median AND volume >= ${data.settings.thresholds.min_volume}.`,
      `Change: CAC acceptable but a stage converts < ${data.settings.thresholds.bad_stage_ratio}x the overall rate.`,
      `Stop: CAC > ${data.settings.thresholds.stop_cac_ratio}x median OR show-up < ${data.settings.thresholds.stop_showup_ratio}x median.`,
      "Otherwise: maintain and monitor.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Budget reallocation simulator (estimate)
// ---------------------------------------------------------------------------
export interface MarginalCac {
  campaign_id: string;
  campaign_name: string;
  window_from: string;
  window_to: string;
  window_spend_inr: number;
  window_registrations: number;
  show_up_used: number;
  show_up_source: string;
  marginal_cac_per_visitor: number | null;
  average_cac_per_visitor: number | null;
}

export function computeMarginal(data: RawData, snap: Snapshot): MarginalCac[] {
  const w = data.settings.simulator.window_days;
  const to = snap.date;
  const from = addDays(to, -(w - 1));
  const cut = cutoffOf(to);
  const spend: Record<string, number> = {};
  for (const r of data.daily) {
    if (r.activity_date < from || r.activity_date > to) continue;
    spend[r.campaign_id] = (spend[r.campaign_id] ?? 0) + r.marketing_spend_inr;
  }
  const regs: Record<string, number> = {};
  const seen = new Set<string>();
  for (const r of [...data.regs].sort((a, b) => a.registered_at.localeCompare(b.registered_at))) {
    if (r.registered_at > cut || seen.has(r.person_id)) continue;
    if (data.people.get(r.person_id)?.person_type !== "external") continue;
    seen.add(r.person_id);
    if (r.registered_at.slice(0, 10) >= from && r.campaign_id) regs[r.campaign_id] = (regs[r.campaign_id] ?? 0) + 1;
  }
  const overallShow = snap.totals.show_up_rate;
  // Before the event is over, actual show-up is 0 or partial (nobody has checked in yet), so dividing by it
  // gives an infinite CAC. Use the same rule as the projection in metrics.ts: the channel's observed
  // show-up in the final snapshot (an in-sample assumption), else the projection setting.
  const post = snap.phase === "post_event";
  const finalSnap = post ? null : computeSnapshot(data, data.event.history_end);
  const showFor = (c: Snapshot["by_campaign"][string]): [number, string] => {
    if (post) {
      if (c.show_up_rate) return [c.show_up_rate, "campaign actual show-up"];
      if (overallShow) return [overallShow, "overall actual show-up"];
    } else {
      const prior = finalSnap?.by_campaign[c.campaign_id]?.show_up_rate;
      if (prior) return [prior, "channel prior: observed show-up in this data (in-sample assumption)"];
    }
    return [data.settings.projection.showup_mid, "assumed show-up (projection settings)"];
  };
  return Object.values(snap.by_campaign).map((c) => {
    const [show, src] = showFor(c);
    let ws = spend[c.campaign_id] ?? 0;
    let wr = regs[c.campaign_id] ?? 0;
    let marginal: number | null = ws > 0 && wr > 0 ? ws / (wr * show) : null;
    if (marginal === null && c.spend_inr > 0 && c.registered_external > 0) {
      // Fall back to campaign-to-date averages when the recent window is empty.
      ws = c.spend_inr;
      wr = c.registered_external;
      marginal = ws / (wr * show);
    }
    return {
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      window_from: from,
      window_to: to,
      window_spend_inr: ws,
      window_registrations: wr,
      show_up_used: show,
      show_up_source: src,
      marginal_cac_per_visitor: marginal,
      average_cac_per_visitor: c.cac_per_visitor_inr ?? (c.registered_external ? c.spend_inr / (c.registered_external * show) : null),
    };
  });
}

export interface SimulationInput {
  date: string;
  from_campaign_id: string;
  to_campaign_id: string;
  pct?: number; // 0..1 of the from-campaign's base
  amount_inr?: number;
  base?: "spend_to_date" | "planned_budget";
}

export interface SimulationResult {
  label: "ESTIMATE";
  date: string;
  from: MarginalCac & { base_inr: number; base_kind: string };
  to: MarginalCac & { effective_cac_after_diminishing: number | null };
  moved_inr: number;
  visitors_lost: number;
  visitors_gained: number;
  net_visitor_change: number;
  formula: string[];
  assumptions: string[];
}

export async function simulateReallocation(input: SimulationInput): Promise<SimulationResult> {
  const data = await loadData();
  const d = assertDate(input.date);
  const snap = computeSnapshot(data, d);
  const m = computeMarginal(data, snap);
  const from = m.find((x) => x.campaign_id === input.from_campaign_id);
  const to = m.find((x) => x.campaign_id === input.to_campaign_id);
  if (!from) throw new Error(`Unknown from_campaign_id "${input.from_campaign_id}".`);
  if (!to) throw new Error(`Unknown to_campaign_id "${input.to_campaign_id}".`);
  if (from.campaign_id === to.campaign_id) throw new Error("from and to campaigns must differ.");
  const fc = snap.by_campaign[from.campaign_id];
  const baseKind = input.base === "planned_budget" && fc.planned_budget_inr ? "planned budget" : "spend to date";
  const base = baseKind === "planned budget" ? (fc.planned_budget_inr as number) : fc.spend_inr;
  let moved: number;
  if (typeof input.amount_inr === "number" && input.amount_inr > 0) moved = input.amount_inr;
  else {
    const p = input.pct ?? 0.2;
    if (!(p > 0 && p <= 1)) throw new Error("pct must be between 0 and 1 (e.g. 0.2 for 20%).");
    moved = base * p;
  }
  if (moved <= 0) throw new Error(`Nothing to move: ${from.campaign_name} has ${baseKind} of INR ${Math.round(base)}.`);
  const k = data.settings.simulator.diminishing_k;
  const lost = from.marginal_cac_per_visitor ? moved / from.marginal_cac_per_visitor : 0;
  const toBase = Math.max(1, to.window_spend_inr);
  const effTo = to.marginal_cac_per_visitor ? to.marginal_cac_per_visitor * (1 + (k * moved) / toBase) : null;
  const gained = effTo ? moved / effTo : 0;
  return {
    label: "ESTIMATE",
    date: d,
    from: { ...from, base_inr: base, base_kind: baseKind },
    to: { ...to, effective_cac_after_diminishing: effTo },
    moved_inr: moved,
    visitors_lost: lost,
    visitors_gained: gained,
    net_visitor_change: gained - lost,
    formula: [
      `marginal CAC per visitor = window spend / (window registrations x show-up)  [window = last ${data.settings.simulator.window_days} days to D]`,
      "visitors lost = moved / marginal CAC(from)",
      `effective CAC(to) = marginal CAC(to) x (1 + k x moved / window spend(to)), k = ${k}`,
      "visitors gained = moved / effective CAC(to)",
    ],
    assumptions: [
      "Estimate, not a forecast: assumes recent cost per registration holds at the margin and show-up stays at the rate shown.",
      `Diminishing returns on the receiving campaign are modelled with k = ${k} (assumption, editable).`,
      "Removing spend loses visitors at the from-campaign's marginal CAC (no saturation benefit modelled).",
      snap.phase === "post_event"
        ? "The event is over: read this as a counterfactual (what the move would likely have produced)."
        : "Gains only materialise if the money can still be spent before registrations close.",
    ],
  };
}

export async function getMarginal(date: string) {
  const data = await loadData();
  const snap = computeSnapshot(data, assertDate(date));
  return computeMarginal(data, snap);
}

export { div };
