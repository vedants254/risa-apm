import Link from "next/link";
import { CampaignBars } from "@/components/charts";
import { CampaignRowActions, NewCampaignButton, type CampaignRowData } from "@/components/CampaignManager";
import {
  DataTable,
  PageContainer,
  PageHeader,
  PageSection,
  type DataColumn,
  type DataRow,
} from "@/components/shared";
import { StatusDot, TitleWithInfo } from "@/components/manage/info";
import { inr, n, pct, shortDate } from "@/lib/format";
import { computeProjection, computeSnapshot, loadData, median, snapshotDate } from "@/lib/metrics";
import { listCampaigns, listOwners, listTasks } from "@/lib/repo";

export const dynamic = "force-dynamic";

const muted = (text: string) => <span className="text-muted-foreground">{text}</span>;
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const d = await snapshotDate((await searchParams).d);
  const data = await loadData();
  const s = computeSnapshot(data, d);
  const rows = Object.values(s.by_campaign);
  const tasks = (await listTasks()) as { campaign_id: string | null; status: string }[];
  const openByC = new Map<string, number>();
  for (const t of tasks) if (t.campaign_id && t.status !== "done") openByC.set(t.campaign_id, (openByC.get(t.campaign_id) ?? 0) + 1);
  const post = s.totals.verified_visitors > 0;
  const metricKey = post ? "cac_per_visitor_inr" : "cac_per_registration_inr";
  const med = median(rows.map((r) => r[metricKey]));
  const owners = Array.from(new Set((await listOwners()).map((o) => o.owner_name))).filter(Boolean);
  const campaigns = (await listCampaigns()) as unknown as CampaignRowData[];
  const metaById = new Map(campaigns.map((c) => [c.campaign_id, c]));
  const t = s.targets;
  const proj = computeProjection(data, d);
  const day = shortDate(d);
  const notHeld = muted("Not held yet");

  // The table shows what a weekly decision needs. Funnel volumes live on the Funnel page; channel, planned
  // budget and notes live in the edit panel. Visitor columns appear only once check-ins exist.
  const shown = new Set([
    "campaign", "status", "owner", "spend", "pct_planned", "registered", "cac_r", "goal_r", "tasks",
    ...(post ? ["visitors", "cac_v", "show_up", "goal_v"] : []),
  ]);
  const allColumns: DataColumn[] = [
    { id: "campaign", header: "Campaign", sortable: true, className: "min-w-[200px]" },
    { id: "channel", header: "Channel", sortable: true, className: "text-muted-foreground" },
    { id: "status", header: "Status", sortable: true },
    { id: "owner", header: "Owner", sortable: true },
    { id: "spend", header: "Spend", numeric: true, sortable: true, title: "Net of credits, to the end of the snapshot day" },
    { id: "planned", header: "Planned", numeric: true, sortable: true, title: "Planned budget, set in Edit campaign" },
    { id: "pct_planned", header: "% of planned", numeric: true, sortable: true, title: "Spend divided by the planned budget (edit the plan in the campaign panel)" },
    { id: "registered", header: "Registered", numeric: true, sortable: true, title: "External people credited to their registration campaign" },
    { id: "visitors", header: "Visitors", numeric: true, sortable: true, title: "Verified external check-ins" },
    { id: "cac_v", header: "CAC / visitor", numeric: true, sortable: true, title: "Spend divided by verified visitors" },
    { id: "cac_r", header: "CAC / reg.", numeric: true, sortable: true, title: "Spend divided by registrations" },
    { id: "show_up", header: "Show-up", numeric: true, sortable: true },
    { id: "goal_v", header: "Share of visitor goal", numeric: true, sortable: true, title: `Visitors divided by the goal in effect on ${day}` },
    { id: "goal_r", header: "Share of reg. goal", numeric: true, sortable: true, title: `Registrations divided by the goal in effect on ${day}` },
    { id: "tasks", header: "Open tasks", numeric: true, sortable: true },
    { id: "identified", header: "Identified", numeric: true, sortable: true, title: "External people credited to their first-touch campaign" },
    { id: "impressions", header: "Impr.", numeric: true, sortable: true },
    { id: "clicks", header: "Clicks", numeric: true, sortable: true },
    { id: "sessions", header: "Sessions", numeric: true, sortable: true },
    { id: "reg_starts", header: "Reg. starts", numeric: true, sortable: true },
    { id: "notes", header: "Notes", className: "max-w-[240px] text-muted-foreground" },
  ];
  const columns = allColumns.filter((c) => shown.has(c.id));

  const tableRows: DataRow[] = rows.map((c) => {
    const meta = metaById.get(c.campaign_id);
    const rowData: CampaignRowData = meta ?? {
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      channel: c.channel,
      status: c.status,
      owner_name: c.owner_name,
      planned_budget_inr: c.planned_budget_inr,
      notes: null,
      updated_at: null,
    };
    const open = openByC.get(c.campaign_id) ?? 0;
    const pctPlanned = c.planned_budget_inr ? c.spend_inr / c.planned_budget_inr : null;
    return {
      id: c.campaign_id,
      cells: {
        campaign: (
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium text-foreground">{c.campaign_name}</span>
            <CampaignRowActions campaign={{ ...rowData, status: c.status }} owners={owners} />
          </div>
        ),
        channel: c.channel,
        status: <StatusDot status={c.status} />,
        owner: c.owner_name || muted("Unassigned"),
        spend: inr(c.spend_inr),
        planned: inr(c.planned_budget_inr),
        pct_planned: pctPlanned === null ? "—" : pct(pctPlanned, 0),
        registered: n(c.registered_external),
        visitors: n(c.verified_visitors),
        cac_v: inr(c.cac_per_visitor_inr),
        cac_r: inr(c.cac_per_registration_inr),
        show_up: post ? pct(c.show_up_rate) : notHeld,
        goal_v: pct(c.share_of_visitor_goal),
        goal_r: pct(c.share_of_registration_goal),
        tasks: open ? (
          <Link
            href={`/tasks?d=${d}&campaign=${encodeURIComponent(c.campaign_id)}`}
            className="rounded-sm text-foreground underline-offset-4 transition-colors duration-(--dur-1) hover:text-primary hover:underline"
          >
            {open}
          </Link>
        ) : (
          muted("0")
        ),
        identified: n(c.identified_external),
        impressions: n(c.impressions),
        clicks: n(c.clicks),
        sessions: n(c.landing_page_sessions),
        reg_starts: n(c.registration_starts),
        notes: rowData.notes ? (
          <span className="block truncate" title={rowData.notes}>
            {rowData.notes}
          </span>
        ) : null,
      },
      sort: {
        campaign: c.campaign_name,
        channel: c.channel,
        status: c.status,
        owner: c.owner_name,
        spend: c.spend_inr,
        planned: c.planned_budget_inr,
        pct_planned: pctPlanned,
        registered: c.registered_external,
        visitors: c.verified_visitors,
        cac_v: c.cac_per_visitor_inr,
        cac_r: c.cac_per_registration_inr,
        show_up: post ? c.show_up_rate : null,
        goal_v: c.share_of_visitor_goal,
        goal_r: c.share_of_registration_goal,
        tasks: open,
        identified: c.identified_external,
        impressions: c.impressions,
        clicks: c.clicks,
        sessions: c.landing_page_sessions,
        reg_starts: c.registration_starts,
      },
    };
  });

  const footerRows: DataRow[] = [
    {
      id: "unattributed",
      state: "muted",
      cells: {
        campaign: "Unattributed and walk-ins",
        registered: n(s.unattributed.registered_external),
        visitors: n(s.unattributed.verified_visitors),
        goal_v: t ? pct(s.unattributed.verified_visitors / t.unique_external_visitors_goal) : "—",
        identified: n(s.unattributed.identified_external),
      },
    },
    {
      id: "total",
      state: "total",
      cells: {
        campaign: "Total",
        spend: inr(s.totals.marketing_spend_inr),
        registered: n(s.totals.registered_external),
        visitors: n(s.totals.verified_visitors),
        cac_v: inr(s.totals.cac_per_visitor_inr),
        cac_r: inr(s.totals.cac_per_registration_inr),
        show_up: post ? pct(s.totals.show_up_rate) : notHeld,
        goal_v: t ? pct(s.totals.verified_visitors / t.unique_external_visitors_goal) : "—",
        goal_r: t ? pct(s.totals.registered_external / t.registration_goal) : "—",
        identified: n(s.totals.identified_external),
        impressions: n(s.totals.impressions),
        clicks: n(s.totals.clicks),
        sessions: n(s.totals.landing_page_sessions),
        reg_starts: n(s.totals.registration_starts),
      },
    },
  ];

  const projColumns: DataColumn[] = [
    { id: "campaign", header: "Campaign", sortable: true, className: "min-w-[180px] font-medium" },
    { id: "reg", header: "Registered to date", numeric: true, sortable: true },
    { id: "proj_reg", header: "Projected registrations", numeric: true, sortable: true },
    { id: "method", header: "Method", className: "text-muted-foreground" },
    { id: "show_up", header: "Show-up used", numeric: true, sortable: true },
    { id: "source", header: "Show-up source", className: "text-muted-foreground" },
    { id: "proj_v", header: "Projected visitors", numeric: true, sortable: true },
    { id: "actual_v", header: "Actual visitors to date", numeric: true, sortable: true },
  ];
  const projRows: DataRow[] = proj.per_campaign.map((r) => ({
    id: r.campaign_id,
    cells: {
      campaign: r.campaign_name,
      reg: n(r.registrations_to_date),
      proj_reg: n(r.projected_registrations),
      method: cap(r.registration_method.replace(/_/g, " ")),
      show_up: pct(r.show_up_rate),
      source: r.show_up_source,
      proj_v: n(r.projected_visitors),
      actual_v: n(r.actual_visitors),
    },
    sort: {
      campaign: r.campaign_name,
      reg: r.registrations_to_date,
      proj_reg: r.projected_registrations,
      show_up: r.show_up_rate,
      proj_v: r.projected_visitors,
      actual_v: r.actual_visitors,
    },
  }));
  const barRows = (value: (c: (typeof rows)[number]) => number | null) => rows.map((c) => ({ id: c.campaign_id, name: c.campaign_name, value: value(c) }));

  return (
    <PageContainer>
      <PageHeader title="Campaigns" description={`As of ${day} ${d.slice(0, 4)}`} actions={<NewCampaignButton owners={owners} />} />

      <PageSection
        id="results"
        title={
          <TitleWithInfo title="Results">
            <p>Spend is net of credits.</p>
            <p>Registrations count toward the registration campaign; identified people toward their first-touch campaign.</p>
            <p>Share of goal uses the goals in effect on {day}.</p>
          </TitleWithInfo>
        }
      >
        <DataTable
          columns={columns}
          rows={tableRows}
          footerRows={footerRows}
          caption={`Campaign results as of ${day}`}
          className="rounded-none border-0"
          empty={{ title: "No campaigns yet", action: <NewCampaignButton owners={owners} /> }}
        />
      </PageSection>

      <PageSection
        id="compare"
        title={
          <TitleWithInfo title="Compare">
            <p>Attributed volume only; walk-ins are excluded. The dashed line is the median across campaigns.</p>
            <p>For cost per {post ? "verified visitor" : "registration"}, lower is better.</p>
          </TitleWithInfo>
        }
      >
        <div className="@container">
          <div className="grid grid-cols-1 gap-x-12 gap-y-8 @2xl:grid-cols-2">
            <figure className="min-w-0 overflow-hidden">
              <figcaption className="mb-1 text-[13px] font-medium text-foreground">
                {post ? "CAC per verified visitor" : "CAC per registration"}
              </figcaption>
              <CampaignBars rows={barRows((c) => c[metricKey])} median={med} money label={post ? "CAC / visitor" : "CAC / registration"} />
            </figure>
            <figure className="min-w-0 overflow-hidden">
              <figcaption className="mb-1 text-[13px] font-medium text-foreground">{post ? "Verified visitors" : "Registrations"}</figcaption>
              <CampaignBars rows={barRows((c) => (post ? c.verified_visitors : c.registered_external))} label={post ? "Visitors" : "Registrations"} />
            </figure>
          </div>
        </div>
      </PageSection>

      <PageSection
        id="projection"
        title={
          <TitleWithInfo title="Projected attendees">
            <p>Projected registrations times each campaign&apos;s show-up rate, plus walk-ins.</p>
            <p>{proj.per_campaign_note}</p>
          </TitleWithInfo>
        }
        action={
          <span className="text-muted-foreground tabular" title={`${pct(proj.per_campaign_total.vs_goal)} of goal`}>
            <span className="font-medium text-foreground">{n(proj.per_campaign_total.total)}</span> of {n(proj.goal)} goal
          </span>
        }
      >
        <DataTable
          columns={projColumns}
          rows={projRows}
          caption="Projected attendees by campaign"
          className="rounded-none border-0"
          footerRows={[
            {
              id: "walkins",
              state: "muted",
              cells: { campaign: "Walk-ins (unattributed)", proj_v: n(proj.per_campaign_total.walkins), actual_v: n(s.totals.verified_walkins) },
            },
          ]}
        />
      </PageSection>
    </PageContainer>
  );
}
