import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CreateTaskButton } from "@/components/actions";
import AnalyzeWithAI from "@/components/shell/AnalyzeWithAI";
import { ProjectionInfo } from "@/components/ProjectionInfo";
import { InfoTip, PaceChart, type PaceRow } from "@/components/charts";
import {
  DataTable,
  DecisionBadge,
  KpiStrip,
  PageContainer,
  PageHeader,
  PageSection,
  StatBlock,
  type DataColumn,
  type DataRow,
} from "@/components/shared";
import { inr, n, pct, ratio, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { computeDiagnosis, computeRecommendations } from "@/lib/insights";
import { addDays, computeProjection, computeSnapshot, computeTrend, dateRange, daysBetween, loadData, snapshotDate, targetsAt, type Snapshot, type TargetRow, type TrendMetric } from "@/lib/metrics";
import { listTasks } from "@/lib/repo";

export const dynamic = "force-dynamic";

const planName = (v: string | null | undefined) => (v ? v.replace(/^attendee\s+/i, "").toLowerCase() : "no plan");

type TaskRow = { id: string; title: string; status: string; priority: string; owner_name: string | null; campaign_name: string | null; source: string; due_date: string | null };

/** The KPIs that can re-plot the main chart (Plausible-style), keyed by the `metric` query param. */
type MetricKey = "registrations" | "identified" | "spend";
const METRICS: Record<
  MetricKey,
  { trendKey: TrendMetric; total: (s: Snapshot) => number; goal: (t: TargetRow | null) => number | null; title: string; actualLabel: string; targetLabel: string; money?: boolean }
> = {
  registrations: {
    trendKey: "registered_external",
    total: (s) => s.totals.registered_external,
    goal: (t) => t?.registration_goal ?? null,
    title: "Registrations against the target pace",
    actualLabel: "Registrations to date",
    targetLabel: "Target pace",
  },
  identified: {
    trendKey: "identified_external",
    total: (s) => s.totals.identified_external,
    goal: (t) => t?.identified_external_people_goal ?? null,
    title: "Identified people against the target pace",
    actualLabel: "Identified people to date",
    targetLabel: "Target pace",
  },
  spend: {
    trendKey: "spend_inr",
    total: (s) => s.totals.marketing_spend_inr,
    goal: (t) => t?.marketing_budget_inr ?? null,
    title: "Net spend against the budget pace",
    actualLabel: "Net spend to date",
    targetLabel: "Budget pace",
    money: true,
  },
};

const link = "text-primary underline-offset-4 transition-colors duration-(--dur-1) hover:underline";

/**
 * KPI chrome. In the strip that re-plots the chart, the selected KPI is marked only by StatBlock's violet label
 * (no fill); the padding gives the shared hover background room around the text.
 */
const kpi = () => "rounded-2xl border border-border/70 bg-card px-5 pt-4 pb-5 hover:border-border";

/** Section cards on Home: one soft hairline and rounded corners, no shadow, so the page reads as clear sections. */
const CARD = "rounded-2xl border border-border/70 bg-card p-5";

/** Share of goal as a fraction (formatted as a percentage by StatBlock), or null when there is no goal. */
const ofGoal = (v: number, goal: number | null | undefined) => (goal ? v / goal : null);

export default async function Home({ searchParams }: { searchParams: Promise<{ d?: string; metric?: string }> }) {
  const sp = await searchParams;
  const d = await snapshotDate(sp.d);
  const metric: MetricKey = sp.metric && sp.metric in METRICS ? (sp.metric as MetricKey) : "registrations";
  const m = METRICS[metric];
  const data = await loadData();
  const s = computeSnapshot(data, d);
  const t = s.targets;
  const proj = computeProjection(data, d);
  const trend = computeTrend(data, data.event.history_start, d, null);
  const diag = computeDiagnosis(s);
  const recs = computeRecommendations(diag, data.settings.thresholds);
  const tasks = (await listTasks()) as TaskRow[];
  const q = `?d=${d}`;
  const metricHref = (k: MetricKey) => (k === "registrations" ? `/?d=${d}` : `/?d=${d}&metric=${k}`);

  // ---- Main chart: the selected metric against its pace (presentation only; inputs are existing computed values) ----
  const start = data.event.history_start;
  const eventStart = data.event.event_starts_at.slice(0, 10);
  const eventEnd = data.event.event_ends_at.slice(0, 10);
  const chartEnd = d > eventEnd ? d : eventEnd;
  const cum = new Map(trend.map((r) => [r.date, r.cumulative[m.trendKey]]));
  // People goals are paced to the event start; the budget is paced to the last event day, as in computeBudget.
  const span = Math.max(1, daysBetween(start, eventStart));
  const budgetDays = Math.max(1, daysBetween(start, eventEnd) + 1);
  const share = (x: string) => (m.money ? Math.min(1, Math.max(0, daysBetween(start, x) + 1) / budgetDays) : Math.min(1, daysBetween(start, x) / span));
  const bandEnd = addDays(eventStart, -1);
  const projecting = metric === "registrations" && proj.method !== "actual" && d < bandEnd;
  const reg = proj.registrations;
  const bandDays = Math.max(1, daysBetween(d, bandEnd));
  const paceRows: PaceRow[] = dateRange(start, chartEnd).map((x) => {
    // Goal in effect at x, but never a version published after the snapshot date.
    const goal = m.goal(targetsAt(data, x <= d ? x : d));
    let band: [number, number] | null = null;
    if (projecting && x >= d && x <= bandEnd) {
      const k = daysBetween(d, x) / bandDays;
      band = [Math.round(reg.to_date + (reg.projected_low - reg.to_date) * k), Math.round(reg.to_date + (reg.projected_high - reg.to_date) * k)];
    }
    return { date: x, registered: x <= d ? (cum.get(x) ?? null) : null, pace: goal !== null ? Math.round(goal * share(x)) : null, band };
  });
  const paceToday = paceRows.find((r) => r.date === d)?.pace ?? null;
  // Headline figures come from the snapshot, exactly as the KPIs below show them.
  const actualToday = m.total(s);
  const vsPace = paceToday ? actualToday / paceToday : null;
  const fmt = (v: number | null | undefined) => (m.money ? inr(v) : n(v));

  // ---- Campaigns, sorted by rupees per verified visitor (per registration before check-ins exist) ----
  const perVisitor = diag.cac_basis === "visitor";
  const recBy = new Map(recs.map((r) => [r.campaign_id, r]));
  const campaigns = Object.values(s.by_campaign);

  // ---- Tasks due this week ----
  // "Due this week" and "overdue" are judged against the snapshot date, like the Tasks page.
  const today = d;
  const weekEnd = addDays(today, 7);
  const open = tasks.filter((x) => x.status !== "done");
  const due = open.filter((x) => x.due_date && x.due_date <= weekEnd).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));

  const visitors = s.totals.verified_visitors;
  const visitorGoal = t?.unique_external_visitors_goal ?? null;
  const pre = s.phase === "pre_event";

  // Columns follow the cost basis so the table fits beside the analyst: before check-ins every visitor
  // count is 0 (the caption says so), and after them the cost basis is visitors, not registrations.
  const columns: DataColumn[] = [
    { id: "campaign", header: "Campaign" },
    { id: "owner", header: "Owner", className: "text-muted-foreground" },
    { id: "spend", header: "Spend", numeric: true },
    perVisitor ? { id: "visitors", header: "Visitors", numeric: true, title: "Verified visitors" } : { id: "registered", header: "Registered", numeric: true },
    {
      id: "cost",
      header: perVisitor ? "₹ / visitor" : "₹ / registration",
      numeric: true,
      title: perVisitor ? "Net spend per verified visitor" : "Net spend per registration (no check-ins yet)",
    },
    ...(perVisitor ? [{ id: "showup", header: "Show-up", numeric: true }] : []),
    { id: "decision", header: "Decision" },
  ];
  const rank = (c: (typeof campaigns)[number]) => (perVisitor ? c.cac_per_visitor_inr : c.cac_per_registration_inr) ?? Infinity;
  const rows: DataRow[] = [...campaigns].sort((a, b) => rank(a) - rank(b)).map((c) => {
    const r = recBy.get(c.campaign_id);
    const cost = perVisitor ? c.cac_per_visitor_inr : c.cac_per_registration_inr;
    return {
      id: c.campaign_id,
      cells: {
        campaign: (
          <span className="inline-flex items-center gap-2">
            <Link href={`/funnel?d=${d}&c=${c.campaign_id}`} className="font-medium text-foreground underline-offset-4 hover:underline">
              {c.campaign_name}
            </Link>
            {c.status !== "active" && <span className="text-xs text-muted-foreground capitalize">{c.status}</span>}
          </span>
        ),
        owner: c.owner_name,
        spend: inr(c.spend_inr),
        registered: n(c.registered_external),
        visitors: n(c.verified_visitors),
        cost: inr(cost),
        showup: pct(c.show_up_rate),
        decision: r ? (
          <span className="flex items-center justify-between gap-3">
            <DecisionBadge action={r.action} title={r.rule} />
            {r.action !== "maintain" && (
              // Secondary row action: plain text, shown on row hover or keyboard focus (always on touch screens).
              <span className="opacity-0 transition-opacity duration-(--dur-1) group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                <CreateTaskButton draft={r.suggested_task} small variant="ghost" />
              </span>
            )}
          </span>
        ) : null,
      },
    };
  });

  return (
    <PageContainer>
      <PageHeader
        title="Home"
        actions={<AnalyzeWithAI />}
        description={
          t ? (
            <>
              Pace against the <span className="text-foreground">{planName(t.version)}</span>, in effect since {shortDate(t.effective_at)}
            </>
          ) : (
            "No target version is in effect on this date"
          )
        }
      />

      {/* 1. Pace: the hero, the main chart and the KPIs that re-plot it */}
      <PageSection id="pace" className="@container pb-6">
        <div className="grid grid-cols-1 gap-5 @min-[720px]:grid-cols-[minmax(240px,280px)_minmax(0,1fr)]">
          <div className={cn("min-w-0 space-y-8", CARD)}>
            <StatBlock
              size="hero"
              label="Verified unique visitors"
              value={visitors}
              goal={visitorGoal !== null ? <>of {n(visitorGoal)} goal</> : undefined}
              progress={{ value: visitors, goal: visitorGoal }}
            />

            <div>
              {proj.method !== "actual" && (
                <StatBlock
                  label="Projected event visitors"
                  value={proj.projected.mid}
                  goal={proj.goal ? <>of {n(proj.goal)} goal</> : undefined}
                />
              )}

              {/* Method notes open in a small card beside the link (hover or click), not as captions under the numbers. */}
              <div className={cn(proj.method !== "actual" && "mt-3")}>
                <ProjectionInfo
                  label={proj.method !== "actual" ? "How this is projected" : "How these are counted"}
                  lines={
                    proj.method !== "actual"
                      ? [
                          `Likely range ${n(proj.projected.low)} to ${n(proj.projected.high)} visitors.${proj.goal ? ` The mid case, ${n(proj.projected.mid)}, is ${pct(proj.projected_vs_goal.mid)} of the ${n(proj.goal)} goal.` : ""}`,
                          proj.method === "pace_curve"
                            ? "Registrations so far are scaled up by the share usually in by this point (a 2025 benchmark pace curve), then turned into visitors at the benchmark show-up rate."
                            : "Registrations are extended at the current daily pace to the event, then turned into visitors at the assumed show-up rate.",
                          ...(proj.cross_check ? [`A simple pace check gives ${n(proj.cross_check.low)} to ${n(proj.cross_check.high)}.`] : []),
                          `Built up by campaign: ${n(proj.per_campaign_total.total)}, that is ${n(proj.per_campaign_total.registered_visitors)} through campaigns at each channel's show-up plus ${n(proj.per_campaign_total.walkins)} walk-ins.`,
                          ...(proj.method === "pace_curve" ? ["Assumption: the curve is a 2025 benchmark, so read the range, not the mid case, as the uncertainty."] : []),
                        ]
                      : [
                          "The event is over, so these are actual counts, not a projection.",
                          `Verified visitors: ${n(s.totals.verified_visitors_registered)} registered and ${n(s.totals.verified_walkins)} walk-ins, each person counted once.`,
                        ]
                  }
                  link={proj.method !== "actual" ? { href: `/campaigns${q}`, text: "See it by campaign" } : undefined}
                />
              </div>
            </div>
          </div>

          <div className={cn("min-w-0", CARD)}>
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                {m.title}
                <InfoTip label="How the pace line is drawn">
                  {m.money
                    ? `Budget pace is a straight line from ${shortDate(start)} to the full budget on the last event day.`
                    : `Target pace is a straight line from ${shortDate(start)} to the goal at the event start, using the goal in effect on each date.`}
                  {projecting && " The shaded band is the projected final registrations (p10 to p90)."}
                </InfoTip>
              </h2>
              {/* One figure beside the title: where the actual stands against the pace today (before the event only). */}
              {vsPace !== null && d < eventStart && (
                <span className="text-[13px] text-muted-foreground tabular" title={`${fmt(actualToday)} against a pace of ${fmt(paceToday)} today`}>
                  <span className="font-medium text-foreground">{ratio(vsPace)}</span> of pace
                </span>
              )}
            </div>
            <PaceChart
              rows={paceRows}
              snapshot={d}
              eventStart={eventStart}
              eventEnd={eventEnd}
              actualLabel={m.actualLabel}
              targetLabel={m.targetLabel}
              money={m.money}
            />
          </div>
        </div>

        {/* Selecting a KPI re-plots the chart above (Plausible-style). Each number carries its goal and a meter, nothing else. */}
        <KpiStrip className="mt-5 gap-x-5 gap-y-5">
          <StatBlock
            label="Registered external people"
            value={t ? ofGoal(s.totals.registered_external, t.registration_goal) : s.totals.registered_external}
            format={t ? "percent" : "number"}
            goal={t ? "of goal" : undefined}
            hint={t ? `${n(s.totals.registered_external)} of ${n(t.registration_goal)} goal` : undefined}
            progress={{ value: s.totals.registered_external, goal: t?.registration_goal }}
            href={metricHref("registrations")}
            selected={metric === "registrations"}
            className={kpi()}
          />
          <StatBlock
            label="Identified external people"
            value={t ? ofGoal(s.totals.identified_external, t.identified_external_people_goal) : s.totals.identified_external}
            format={t ? "percent" : "number"}
            goal={t ? "of goal" : undefined}
            hint={t ? `${n(s.totals.identified_external)} of ${n(t.identified_external_people_goal)} goal` : undefined}
            progress={{ value: s.totals.identified_external, goal: t?.identified_external_people_goal }}
            href={metricHref("identified")}
            selected={metric === "identified"}
            className={kpi()}
          />
          <StatBlock
            label="Net spend against budget"
            value={t ? ofGoal(s.totals.marketing_spend_inr, t.marketing_budget_inr) : s.totals.marketing_spend_inr}
            format={t ? "percent" : "inr"}
            goal={t ? "of budget" : undefined}
            hint={t ? `${inr(s.totals.marketing_spend_inr)} of ${inr(t.marketing_budget_inr)} budget` : undefined}
            progress={{ value: s.totals.marketing_spend_inr, goal: t?.marketing_budget_inr }}
            href={metricHref("spend")}
            selected={metric === "spend"}
            className={kpi()}
          />
        </KpiStrip>
      </PageSection>

      {/* 2. Which campaigns need a decision */}
      <PageSection
        id="campaigns"
        className={cn(CARD, "mb-6 pb-5 last:pb-5")}
        title={
          <span className="inline-flex items-center gap-1">
            Which campaigns need a decision
            <InfoTip label="How decisions are made">
              Ranked by {perVisitor ? "₹ per verified visitor" : "₹ per registration"}, cheapest first; the median is {inr(diag.median_cac)}. Rules compare
              each campaign with the median on cost and show-up.
              {!perVisitor && " Visitors and show-up appear once the event is held."}
            </InfoTip>
          </span>
        }
        action={
          <Link className={link} href={`/diagnose${q}`}>
            Review evidence
          </Link>
        }
      >
        <DataTable
          columns={columns}
          rows={rows}
          compact
          className="rounded-none border-0"
          caption="Campaigns ranked by cost, with the recommended decision"
          empty={{ title: "No campaigns yet", description: "Add a campaign to see its cost and decision here." }}
        />
      </PageSection>

      {/* 3. What is due */}
      <PageSection
        id="due"
        className={cn(CARD, "pb-5 last:pb-5")}
        title={
          <span className="inline-flex items-center gap-1">
            {due.length} {due.length === 1 ? "task" : "tasks"} due this week
            <InfoTip label="What counts as due">
              Open tasks due by {shortDate(weekEnd)}, overdue included. {open.length} {open.length === 1 ? "task is" : "tasks are"} open in all.
            </InfoTip>
          </span>
        }
        action={
          <Link className={link} href={`/tasks${q}`}>
            Open all tasks
          </Link>
        }
      >
        {due.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nothing is due this week.</p>
        ) : (
          <ul className="divide-y text-[13px]">
            {due.slice(0, 6).map((x) => {
              const overdue = !!x.due_date && x.due_date < today;
              return (
                <li key={x.id} className="grid min-h-10 grid-cols-[minmax(0,1fr)_minmax(0,9rem)_minmax(0,8rem)_6.5rem] items-center gap-x-6 py-2">
                  <span className="min-w-0 truncate font-medium text-foreground" title={x.title}>
                    {x.title}
                    {x.priority === "high" && <span className="ml-2 font-normal text-muted-foreground">High</span>}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground" title={x.campaign_name ?? undefined}>
                    {x.campaign_name ?? "No campaign"}
                  </span>
                  <span className={cn("min-w-0 truncate", x.owner_name ? "text-foreground" : "text-muted-foreground")}>{x.owner_name ?? "Unassigned"}</span>
                  <span className={cn("text-right tabular", overdue ? "font-medium text-foreground" : "text-muted-foreground")}>
                    {x.due_date ? `${overdue ? "Overdue " : ""}${shortDate(x.due_date)}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </PageSection>
    </PageContainer>
  );
}
