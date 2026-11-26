/**
 * Copilot tool layer. Each tool calls lib/metrics.ts / lib/insights.ts / lib/repo.ts, so the
 * copilot sees exactly the numbers the dashboard shows. Write tools only return drafts:
 * the UI turns them into confirm cards and only the user's click changes data.
 */
import { evaluate } from "./calc";
import { getDb, type Row } from "./db";
import {
  STAGE_LABELS,
  TREND_METRICS,
  assertDate,
  computeBudget,
  computeChanges,
  computeProjection,
  computeSnapshot,
  computeTrend,
  funnelFromSnapshot,
  getDataQuality,
  getEngagement,
  loadData,
  median,
  stageRates,
  type TrendMetric,
} from "./metrics";
import { computeDiagnosis, computeRecommendations, simulateReallocation } from "./insights";
import { CAMPAIGN_STATUSES, PRIORITIES, listActions, listCampaigns, listTasks } from "./repo";
import type { ToolDef } from "./llm";

export interface ToolContext {
  /** Snapshot date selected in the UI; used when the model omits `date`. */
  date: string;
}

export interface Proposal {
  kind: "task" | "campaign_update";
  draft: Record<string, unknown>;
  summary: string;
}

const dateParam = {
  type: "string",
  description: "Snapshot date YYYY-MM-DD (end of day IST). Defaults to the date selected in the UI.",
};
const campaignParam = { type: "string", description: "Campaign id, e.g. C01. Omit for all campaigns." };

const COMPARE_METRICS = [
  "spend_inr",
  "impressions",
  "clicks",
  "landing_page_sessions",
  "registration_starts",
  "identified_external",
  "registered_external",
  "verified_visitors",
  "cac_per_visitor_inr",
  "cac_per_registration_inr",
  "show_up_rate",
  "share_of_visitor_goal",
  "ctr",
  "click_to_session",
  "session_to_start",
  "start_to_registration_proxy",
  "identified_to_registered",
  "registered_to_confirmed",
] as const;

export const QUERYABLE_TABLES = [
  "event",
  "targets",
  "campaigns",
  "daily_marketing",
  "people",
  "interactions",
  "registrations",
  "registration_history",
  "checkins",
  "v_daily_marketing",
  "v_people",
  "v_interactions",
  "v_registrations",
  "v_registration_history",
  "v_checkins",
  "campaigns_meta",
  "tasks",
  "action_items",
];

/** Side tables created from unused sheets of an upload (x_<sheet>); always read-only text. */
const SIDE_TABLE = /^x_[a-z0-9_]+$/;

const QUERY_DATA_BASE =
  "Read-only SQL SELECT for questions the other tools cannot answer. Max 200 rows. Prefer the deduplicated views v_* (raw tables keep import duplicates). " +
  "Timestamps are TEXT 'YYYY-MM-DD HH:MM:SS' IST; filter <= 'D 23:59:59'. Filter people to person_type='external' for goal metrics. " +
  "Use only the tables and columns listed in the schema below; a column not listed does not exist.";

/**
 * The query_data schema, read from the live database: every queryable table and view with its
 * real columns, including extra columns (x_...) and side tables kept from an uploaded file.
 */
export async function queryDataSchema(): Promise<string> {
  const db = getDb();
  const names = new Set((await db.tableNames()).map((n) => n.toLowerCase()));
  const parts: string[] = [];
  const list = async (t: string) => (await db.columnNames(t)).filter((c) => c !== "_rid");
  for (const t of QUERYABLE_TABLES) {
    // Raw tables are described through their deduplicated views (same columns).
    if (["daily_marketing", "people", "interactions", "registrations", "registration_history", "checkins"].includes(t)) continue;
    const cols = await list(t).catch(() => []);
    if (cols.length) parts.push(`${t}(${cols.join(", ")})`);
  }
  for (const n of [...names].filter((n) => SIDE_TABLE.test(n)).sort()) {
    const cols = await list(n).catch(() => []);
    if (cols.length) parts.push(`${n}(${cols.join(", ")}) [extra sheet from the uploaded file, all TEXT]`);
  }
  return `Schema: ${parts.join("; ")}. Raw tables daily_marketing, people, interactions, registrations, registration_history, checkins have the same columns as their v_ views. Columns starting with x_ are extra fields kept from the uploaded file (TEXT).`;
}

/** Tool definitions with the query_data description generated from the current database. */
export async function toolDefs(): Promise<ToolDef[]> {
  const schema = await queryDataSchema();
  return TOOL_DEFS.map((t) =>
    t.function.name === "query_data" ? { ...t, function: { ...t.function, description: `${QUERY_DATA_BASE} ${schema}` } } : t,
  );
}

export const TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "get_overview",
      description:
        "Headline KPIs at a snapshot date: identified, registered, status counts, verified visitors (registered + walk-ins), spend, anonymous funnel totals, CAC, show-up, targets in effect and progress vs goals, projection.",
      parameters: { type: "object", properties: { date: dateParam } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_funnel",
      description:
        "Full funnel at a date: anonymous funnel (impressions, clicks, sessions, registration starts; event counts, not people) and people funnel (identified, registered, confirmed, verified visitors), with stage conversion rates. Optional campaign filter.",
      parameters: { type: "object", properties: { date: dateParam, campaign_id: campaignParam } },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_campaigns",
      description: "Rank all campaigns on one metric at a date, with the median and each campaign's ratio to the median.",
      parameters: {
        type: "object",
        properties: { date: dateParam, metric: { type: "string", enum: [...COMPARE_METRICS] } },
        required: ["metric"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_trend",
      description:
        "Daily and cumulative values of a metric between two dates (weekly buckets when the range is over 35 days). Optional campaign filter.",
      parameters: {
        type: "object",
        properties: {
          metric: { type: "string", enum: [...TREND_METRICS] },
          from: { type: "string", description: "YYYY-MM-DD" },
          to: { type: "string", description: "YYYY-MM-DD" },
          campaign_id: campaignParam,
          granularity: { type: "string", enum: ["day", "week"] },
        },
        required: ["metric", "from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_targets",
      description: "Target version in effect at the date (goals and budget), actuals, gaps, % achieved and the projected outcome range.",
      parameters: { type: "object", properties: { date: dateParam } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_budget",
      description: "Approved budget vs net spend, pacing index, 7-day burn, projected spend, credits, and per-campaign spend vs planned budget.",
      parameters: { type: "object", properties: { date: dateParam } },
    },
  },
  {
    type: "function",
    function: {
      name: "diagnose",
      description:
        "Rank campaigns vs the median CAC and show-up rate (over/under-performing) and find each campaign's bottleneck stage relative to the overall rate.",
      parameters: { type: "object", properties: { date: dateParam } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recommendations",
      description: "Rule-based scale / change / stop / maintain recommendations per campaign with the thresholds and evidence.",
      parameters: { type: "object", properties: { date: dateParam } },
    },
  },
  {
    type: "function",
    function: {
      name: "simulate_reallocation",
      description:
        "ESTIMATE the visitor impact of moving budget from one campaign to another using each campaign's marginal CAC (recent spend / recent registrations x show-up) with diminishing returns. Give pct (0-1) of the from-campaign's spend to date, or amount_inr.",
      parameters: {
        type: "object",
        properties: {
          date: dateParam,
          from_campaign_id: { type: "string" },
          to_campaign_id: { type: "string" },
          pct: { type: "number", description: "Share of the from-campaign base to move, 0-1 (0.2 = 20%)." },
          amount_inr: { type: "number" },
          base: { type: "string", enum: ["spend_to_date", "planned_budget"] },
        },
        required: ["from_campaign_id", "to_campaign_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "what_changed",
      description: "Compare two snapshot dates: deltas in totals and per campaign, target plan changes, and highlights.",
      parameters: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" } },
        required: ["from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_campaigns",
      description: "Campaign roster: id, name, channel, audience, objective, owner, status (active/paused/stopped), planned budget, notes.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tasks",
      description: "List tasks and action items, optionally filtered.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["todo", "in_progress", "done"] },
          campaign_id: { type: "string" },
          owner_name: { type: "string" },
          source: { type: "string", enum: ["manual", "copilot", "recommendation"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_task",
      description:
        "Draft a task for the user to confirm. Does NOT create it: the UI shows a confirm card and only the user's click creates it. Owner defaults to the campaign owner.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string", description: "Include the evidence (numbers) behind the task." },
          campaign_id: { type: "string" },
          owner_name: { type: "string" },
          due_date: { type: "string", description: "YYYY-MM-DD" },
          priority: { type: "string", enum: [...PRIORITIES] },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_campaign_update",
      description:
        "Draft a change to a campaign (status active/paused/stopped, owner, planned budget, notes) for the user to confirm. Does NOT apply it.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string" },
          status: { type: "string", enum: [...CAMPAIGN_STATUSES] },
          owner_name: { type: "string" },
          planned_budget_inr: { type: "number" },
          notes: { type: "string" },
          reason: { type: "string" },
        },
        required: ["campaign_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_data",
      description: QUERY_DATA_BASE,
      parameters: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description:
        "Evaluate arithmetic exactly (use for every derived number: ratios, %, differences, sums). Supports + - * / % ^ ( ) min max round(x,d) abs sqrt floor ceil. No thousands separators.",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string" },
          label: { type: "string", description: "What the number represents." },
        },
        required: ["expression"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_engagement",
      description: "Identified engagement events (page visits, brochure downloads, form starts, emails sent/opened/clicked, opt-outs, questions) for external people at a date.",
      parameters: { type: "object", properties: { date: dateParam, campaign_id: campaignParam } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_data_quality",
      description: "Import duplicates removed per table, person types excluded, and check-in result/verification breakdown.",
      parameters: { type: "object", properties: { date: dateParam } },
    },
  },
];

// ---------------------------------------------------------------------------
const r2 = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d;

function pickDate(args: Row, ctx: ToolContext, key = "date"): string {
  const v = args[key];
  return assertDate(typeof v === "string" && v ? v : ctx.date, key);
}

function roundDeep(v: unknown): unknown {
  if (typeof v === "number") return Number.isInteger(v) ? v : Math.round(v * 10000) / 10000;
  if (Array.isArray(v)) return v.map(roundDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x)]));
  return v;
}

// --- SQL guard ---------------------------------------------------------------
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|replace|vacuum|reindex|grant|revoke|truncate|copy|into|load_extension|begin|commit|rollback|savepoint|release|analyze|set|lock|listen|notify|execute|call|do)\b/i;

export function guardSql(raw: string): string {
  let sql = raw.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  sql = sql.replace(/;\s*$/, "");
  if (!sql) throw new Error("Empty SQL.");
  if (sql.length > 4000) throw new Error("SQL too long (max 4000 chars).");
  if (sql.includes(";")) throw new Error("Only a single statement is allowed.");
  if (!/^(select|with)\b/i.test(sql)) throw new Error("Only SELECT (or WITH ... SELECT) queries are allowed.");
  const noStrings = sql.replace(/'(?:[^']|'')*'/g, "''");
  const bad = noStrings.match(FORBIDDEN);
  if (bad) throw new Error(`Keyword "${bad[0]}" is not allowed in read-only queries.`);
  if (/\b(sqlite_\w*|pg_\w*|information_schema)\b/i.test(noStrings)) throw new Error("System catalogs are not queryable.");

  // Table allow-list: every identifier after FROM / JOIN (and comma lists in FROM) must be allowed or a CTE.
  const ctes = new Set<string>();
  for (const m of noStrings.matchAll(/(?:\bwith\b|,)\s*(?:recursive\s+)?([a-z_][\w]*)\s+as\s*\(/gi)) ctes.add(m[1].toLowerCase());
  const tokens = noStrings.match(/[A-Za-z_][\w.]*|\(|\)|,/g) ?? [];
  const used: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].toLowerCase();
    if (t !== "from" && t !== "join") continue;
    let j = i + 1;
    while (j < tokens.length) {
      const name = tokens[j];
      if (name === "(") break; // subquery
      used.push(name.toLowerCase());
      // skip optional alias
      let k = j + 1;
      if (tokens[k]?.toLowerCase() === "as") k++;
      if (tokens[k] && /^[a-z_]/i.test(tokens[k]) && !/^(where|group|order|limit|join|inner|left|right|full|cross|on|using|union|having|natural|outer|offset|except|intersect)$/i.test(tokens[k]))
        k++;
      if (t === "from" && tokens[k] === ",") {
        j = k + 1;
        continue;
      }
      break;
    }
  }
  for (const u of used) {
    const name = u.split(".").pop() as string;
    if (!ctes.has(name) && !QUERYABLE_TABLES.includes(name) && !SIDE_TABLE.test(name))
      throw new Error(`Table "${u}" is not in the allow-list: ${QUERYABLE_TABLES.join(", ")} and extra sheets x_*.`);
  }
  if (!used.length) throw new Error("Query must read FROM an allowed table.");
  return sql;
}

// ---------------------------------------------------------------------------
export interface ToolOutput {
  result: unknown;
  proposal?: Proposal;
}

export async function runTool(name: string, args: Row, ctx: ToolContext): Promise<ToolOutput> {
  const data = await loadData();
  switch (name) {
    case "get_overview": {
      const d = pickDate(args, ctx);
      const s = computeSnapshot(data, d);
      const p = computeProjection(data, d);
      const t = s.targets;
      return {
        result: roundDeep({
          snapshot_date: d,
          cutoff: s.cutoff,
          phase: s.phase,
          totals: s.totals,
          rates: s.rates,
          targets_in_effect: t,
          progress_vs_goal: t
            ? {
                identified: { actual: s.totals.identified_external, goal: t.identified_external_people_goal, pct: s.totals.identified_external / t.identified_external_people_goal },
                registered: { actual: s.totals.registered_external, goal: t.registration_goal, pct: s.totals.registered_external / t.registration_goal },
                verified_visitors: { actual: s.totals.verified_visitors, goal: t.unique_external_visitors_goal, pct: s.totals.verified_visitors / t.unique_external_visitors_goal },
                spend_vs_budget: { spend: s.totals.marketing_spend_inr, budget: t.marketing_budget_inr, pct: s.totals.marketing_spend_inr / t.marketing_budget_inr },
              }
            : null,
          projection: {
            method: p.method,
            note: p.method_note,
            visitors: p.projected,
            goal: p.goal,
            per_campaign_build_up: p.per_campaign_total,
            per_campaign: p.per_campaign.map((r) => ({ campaign_id: r.campaign_id, projected_visitors: r.projected_visitors, show_up_used: r.show_up_rate })),
            per_campaign_note: p.per_campaign_note,
          },
          show_up_note:
            s.phase === "pre_event" ? "Event not held yet (12-13 Apr): show-up rates are 0 by definition, not a performance signal." : null,
          unattributed_walkins: s.unattributed,
          definitions:
            "External people only; dedup by stable IDs; verified visitor = admitted+verified check-in <= D; spend net of credits; targets = latest version <= D.",
        }),
      };
    }
    case "get_funnel": {
      const d = pickDate(args, ctx);
      const f = funnelFromSnapshot(computeSnapshot(data, d), (args.campaign_id as string) || null);
      return { result: roundDeep({ snapshot_date: d, ...f, rate_labels: STAGE_LABELS }) };
    }
    case "compare_campaigns": {
      const d = pickDate(args, ctx);
      const metric = String(args.metric);
      if (!(COMPARE_METRICS as readonly string[]).includes(metric))
        throw new Error(`metric must be one of ${COMPARE_METRICS.join(", ")}`);
      const s = computeSnapshot(data, d);
      const rows = Object.values(s.by_campaign).map((c) => {
        const rates = stageRates({
          impressions: c.impressions,
          clicks: c.clicks,
          sessions: c.landing_page_sessions,
          starts: c.registration_starts,
          identified: c.identified_external,
          registered: c.registered_external,
          confirmed: c.status_counts.confirmed,
          visitors_registered: c.verified_visitors,
        });
        const v = metric in rates ? rates[metric] : (c as unknown as Record<string, number | null>)[metric];
        return {
          campaign_id: c.campaign_id,
          campaign_name: c.campaign_name,
          owner_name: c.owner_name,
          status: c.status,
          value: v,
          spend_inr: c.spend_inr,
          registered_external: c.registered_external,
          verified_visitors: c.verified_visitors,
        };
      });
      const med = median(rows.map((r) => r.value));
      const lowerIsBetter = metric.startsWith("cac") || metric === "spend_inr";
      rows.sort((a, b) => {
        if (a.value === null) return 1;
        if (b.value === null) return -1;
        return lowerIsBetter ? a.value - b.value : b.value - a.value;
      });
      return {
        result: roundDeep({
          snapshot_date: d,
          metric,
          ordering: lowerIsBetter ? "ascending (lower is better)" : "descending (higher is better)",
          median: med,
          campaigns: rows.map((r, i) => ({ rank: i + 1, ...r, ratio_to_median: r.value !== null && med ? r.value / med : null })),
          note: "Walk-ins have no campaign and are excluded from campaign attribution.",
        }),
      };
    }
    case "get_trend": {
      const metric = String(args.metric) as TrendMetric;
      if (!TREND_METRICS.includes(metric)) throw new Error(`metric must be one of ${TREND_METRICS.join(", ")}`);
      const from = assertDate(String(args.from ?? data.event.history_start), "from");
      const to = assertDate(String(args.to ?? ctx.date), "to");
      const pts = computeTrend(data, from, to, (args.campaign_id as string) || null);
      const weekly = args.granularity === "week" || (args.granularity !== "day" && pts.length > 35);
      let series: { period: string; value: number; cumulative: number }[];
      if (weekly) {
        series = [];
        for (let i = 0; i < pts.length; i += 7) {
          const chunk = pts.slice(i, i + 7);
          series.push({
            period: `${chunk[0].date}..${chunk[chunk.length - 1].date}`,
            value: metric === "confirmed" ? chunk[chunk.length - 1].cumulative[metric] : chunk.reduce((a, p) => a + p.daily[metric], 0),
            cumulative: chunk[chunk.length - 1].cumulative[metric],
          });
        }
      } else {
        series = pts.map((p) => ({ period: p.date, value: metric === "confirmed" ? p.cumulative[metric] : p.daily[metric], cumulative: p.cumulative[metric] }));
      }
      return {
        result: roundDeep({
          metric,
          campaign_id: args.campaign_id ?? null,
          from,
          to,
          granularity: weekly ? "week" : "day",
          note: metric === "confirmed" ? "confirmed is a stock: value = confirmed count at end of period." : "value = sum within period; cumulative = running total since history start.",
          series,
        }),
      };
    }
    case "get_targets": {
      const d = pickDate(args, ctx);
      const s = computeSnapshot(data, d);
      const p = computeProjection(data, d);
      const t = s.targets;
      if (!t) return { result: { snapshot_date: d, targets: null, note: "No target version in effect at this date." } };
      const row = (actual: number, goal: number) => ({ actual, goal, gap: goal - actual, pct_achieved: actual / goal });
      return {
        result: roundDeep({
          snapshot_date: d,
          target_version: t.version,
          effective_at: t.effective_at,
          all_versions: data.targets.map((x) => ({ version: x.target_version, effective_at: x.effective_at })),
          identified_external: row(s.totals.identified_external, t.identified_external_people_goal),
          registered_external: row(s.totals.registered_external, t.registration_goal),
          verified_visitors: row(s.totals.verified_visitors, t.unique_external_visitors_goal),
          marketing_spend_inr: row(s.totals.marketing_spend_inr, t.marketing_budget_inr),
          projection: p,
        }),
      };
    }
    case "get_budget":
      return { result: roundDeep(computeBudget(data, pickDate(args, ctx))) };
    case "diagnose": {
      const dg = computeDiagnosis(computeSnapshot(data, pickDate(args, ctx)));
      return {
        result: roundDeep({
          ...dg,
          campaigns: dg.campaigns.map((c) => ({ ...c, stages: c.stages.map((s) => ({ ...s, label: undefined })) })),
          stage_labels: STAGE_LABELS,
        }),
      };
    }
    case "get_recommendations": {
      const d = pickDate(args, ctx);
      const dg = computeDiagnosis(computeSnapshot(data, d));
      return {
        result: roundDeep({
          snapshot_date: d,
          thresholds: data.settings.thresholds,
          cac_basis: dg.cac_basis,
          median_cac: dg.median_cac,
          median_show_up: dg.median_show_up,
          recommendations: computeRecommendations(dg, data.settings.thresholds).map((r) => ({ ...r, suggested_task: { title: r.suggested_task.title, priority: r.suggested_task.priority, owner_name: r.suggested_task.owner_name } })),
        }),
      };
    }
    case "simulate_reallocation": {
      const res = await simulateReallocation({
        date: pickDate(args, ctx),
        from_campaign_id: String(args.from_campaign_id ?? ""),
        to_campaign_id: String(args.to_campaign_id ?? ""),
        pct: typeof args.pct === "number" ? (args.pct > 1 ? args.pct / 100 : args.pct) : undefined,
        amount_inr: typeof args.amount_inr === "number" ? args.amount_inr : undefined,
        base: args.base === "planned_budget" ? "planned_budget" : "spend_to_date",
      });
      return { result: roundDeep(res) };
    }
    case "what_changed":
      return { result: roundDeep(computeChanges(data, assertDate(String(args.from), "from"), assertDate(String(args.to), "to"))) };
    case "list_campaigns":
      return { result: await listCampaigns() };
    case "list_tasks": {
      const tasks = await listTasks({
        status: args.status as string,
        campaign_id: args.campaign_id as string,
        owner_name: args.owner_name as string,
        source: args.source as string,
      });
      return { result: { tasks, action_items: await listActions() } };
    }
    case "propose_task": {
      const title = String(args.title ?? "").trim();
      if (!title) throw new Error("title is required.");
      const cid = args.campaign_id ? String(args.campaign_id) : null;
      const camp = cid ? data.campaigns.find((c) => c.campaign_id === cid) : null;
      if (cid && !camp) throw new Error(`Unknown campaign_id "${cid}".`);
      const owner = (args.owner_name as string) || (cid ? data.meta.get(cid)?.owner_name || camp?.owner_name : null) || null;
      if (args.due_date) assertDate(String(args.due_date), "due_date");
      const priority = PRIORITIES.includes(args.priority as (typeof PRIORITIES)[number]) ? args.priority : "medium";
      const draft = {
        title,
        description: args.description ?? null,
        campaign_id: cid,
        campaign_name: camp?.campaign_name ?? null,
        owner_name: owner,
        due_date: args.due_date ?? null,
        priority,
        source: "copilot",
      };
      return {
        result: { status: "DRAFT_PENDING_USER_CONFIRMATION", draft, note: "Not created. The user sees a confirm card; tell them to click Confirm." },
        proposal: { kind: "task", draft, summary: `Task: ${title}${owner ? ` (owner ${owner})` : ""}` },
      };
    }
    case "propose_campaign_update": {
      const cid = String(args.campaign_id ?? "");
      const camp = data.campaigns.find((c) => c.campaign_id === cid);
      if (!camp) throw new Error(`Unknown campaign_id "${cid}".`);
      const changes: Record<string, unknown> = {};
      if (args.status !== undefined) {
        if (!CAMPAIGN_STATUSES.includes(args.status as (typeof CAMPAIGN_STATUSES)[number])) throw new Error(`status must be ${CAMPAIGN_STATUSES.join("/")}`);
        changes.status = args.status;
      }
      if (args.owner_name !== undefined) changes.owner_name = args.owner_name;
      if (args.planned_budget_inr !== undefined) changes.planned_budget_inr = Number(args.planned_budget_inr);
      if (args.notes !== undefined) changes.notes = args.notes;
      if (!Object.keys(changes).length) throw new Error("No changes proposed.");
      const current = data.meta.get(cid);
      const draft = { campaign_id: cid, campaign_name: camp.campaign_name, changes, current: current ?? null, reason: args.reason ?? null };
      return {
        result: { status: "DRAFT_PENDING_USER_CONFIRMATION", draft, note: "Not applied. The user must click Confirm." },
        proposal: {
          kind: "campaign_update",
          draft,
          summary: `Update ${camp.campaign_name}: ${Object.entries(changes).map(([k, v]) => `${k} -> ${v}`).join(", ")}`,
        },
      };
    }
    case "query_data": {
      const sql = guardSql(String(args.sql ?? ""));
      const rows = await getDb().readOnlyAll(`SELECT * FROM (${sql}) AS q LIMIT 201`);
      return {
        result: roundDeep({
          row_count: Math.min(rows.length, 200),
          truncated: rows.length > 200,
          rows: rows.slice(0, 200),
          reminder: "Raw tables include import duplicates and non-external people; v_* views are deduplicated by stable ID.",
        }),
      };
    }
    case "calculate": {
      const expr = String(args.expression ?? "");
      const value = evaluate(expr);
      return { result: { expression: expr, label: args.label ?? null, value, rounded: r2(value, 4) } };
    }
    case "get_engagement":
      return { result: roundDeep(await getEngagement(pickDate(args, ctx), (args.campaign_id as string) || null)) };
    case "get_data_quality":
      return { result: await getDataQuality(pickDate(args, ctx)) };
    default:
      throw new Error(`Unknown tool "${name}".`);
  }
}

/** Run a tool and always return a JSON-serialisable payload (errors become {error}). */
export async function safeRunTool(name: string, args: Row, ctx: ToolContext): Promise<ToolOutput & { error?: string }> {
  try {
    return await runTool(name, args, ctx);
  } catch (e) {
    return { result: { error: (e as Error).message }, error: (e as Error).message };
  }
}
