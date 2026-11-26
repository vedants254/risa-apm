import { ComparePicker, Simulator, ThresholdSheet } from "@/components/DecideTools";
import { BottleneckLegend, BottleneckTable } from "@/components/decide/BottleneckTable";
import { RecommendationList } from "@/components/decide/RecommendationList";
import { TitleWithTip } from "@/components/decide/InfoTip";
import { DataTable, PageContainer, PageHeader, PageSection, StatusChip, campaignStatusTone, type DataRow } from "@/components/shared";
import { inr, n, pct, ratio, shortDate, validDate } from "@/lib/format";
import { computeDiagnosis, computeMarginal, computeRecommendations, type CampaignDiagnosis } from "@/lib/insights";
import { addDays, computeChanges, computeSnapshot, loadData, snapshotDate } from "@/lib/metrics";

export const dynamic = "force-dynamic";

const METRIC_LABEL: Record<string, string> = {
  identified_external: "Identified external",
  registered_external: "Registered external",
  confirmed: "Confirmed (status)",
  cancelled: "Cancelled (status)",
  waitlisted: "Waitlisted (status)",
  verified_visitors: "Verified visitors",
  marketing_spend_inr: "Net spend",
  impressions: "Impressions",
  clicks: "Clicks",
  landing_page_sessions: "Landing sessions",
  registration_starts: "Registration starts",
  cac_per_registration_inr: "CAC / registration",
  registration_goal: "Registration goal",
  unique_external_visitors_goal: "Visitor goal",
  marketing_budget_inr: "Budget",
};

const VERDICT: Record<CampaignDiagnosis["verdict"], string> = {
  "over-performing": "Over-performing",
  "on par": "On par",
  "under-performing": "Under-performing",
  "insufficient data": "Insufficient data",
};

/** Signed number for deltas: "+1,204", "−₹3,500", "0". */
function signed(x: number | null, money: boolean) {
  if (x === null) return "—";
  const abs = money ? inr(Math.abs(x)) : n(Math.abs(x));
  return x > 0 ? `+${abs}` : x < 0 ? `−${abs}` : abs;
}

export default async function DiagnosePage({ searchParams }: { searchParams: Promise<{ d?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const d = await snapshotDate(sp.d);
  const data = await loadData();
  const snap = computeSnapshot(data, d);
  const diag = computeDiagnosis(snap);
  const th = data.settings.thresholds;
  const recs = computeRecommendations(diag, th);
  const marginal = computeMarginal(data, snap);
  // Marginal CAC exists on every date: actual show-up after the event, the channel prior before it.
  const marginalReady = marginal.some((m) => m.marginal_cac_per_visitor !== null);
  const from = validDate(sp.from, addDays(d, -7));
  const to = validDate(sp.to, d);
  const changes = computeChanges(data, from <= to ? from : to, from <= to ? to : from);
  const unit = diag.cac_basis === "visitor" ? "visitor" : "registration";
  const showUp = diag.cac_basis === "visitor";
  const best = [...diag.campaigns].filter((c) => c.cac !== null).sort((a, b) => (a.cac as number) - (b.cac as number))[0];
  const worst = [...diag.campaigns].filter((c) => c.efficiency_index !== null).pop();
  const money = (m: string) => m.includes("inr") || m.includes("budget") || m.includes("spend");
  // Before the event there are no verified visitors, so show-up and anything per visitor is not known yet.
  const AFTER = "Available after the event";
  const later = (x: React.ReactNode) => (showUp ? x : null);
  const sources = [...new Set(marginal.map((m) => m.show_up_source))].map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join("; ");

  const changeRows: DataRow[] = changes.totals
    .filter((x) => x.delta !== 0)
    .map((x) => ({
      id: x.metric,
      cells: {
        metric: METRIC_LABEL[x.metric] ?? x.metric,
        from: money(x.metric) ? inr(x.from) : n(x.from),
        to: money(x.metric) ? inr(x.to) : n(x.to),
        delta: <span className="font-medium">{signed(x.delta, money(x.metric))}</span>,
      },
    }));
  const campaignChangeRows: DataRow[] = changes.by_campaign.map((c) => ({
    id: c.campaign_id,
    cells: {
      campaign: <span className="font-medium">{c.campaign_name}</span>,
      spend: signed(c.spend_delta, true),
      regs: signed(c.registered_delta, false),
      visitors: later(signed(c.visitors_delta, false)),
      share: pct(c.share_of_registration_change, 0),
      cac: inr(c.cac_per_registration_to),
    },
    sort: {
      campaign: c.campaign_name,
      spend: c.spend_delta,
      regs: c.registered_delta,
      visitors: showUp ? c.visitors_delta : null,
      share: c.share_of_registration_change,
      cac: c.cac_per_registration_to,
    },
  }));

  const marginalRows: DataRow[] = marginal.map((m) => ({
    id: m.campaign_id,
    cells: {
      campaign: <span className="font-medium">{m.campaign_name}</span>,
      spend: inr(m.window_spend_inr),
      regs: n(m.window_registrations),
      show: pct(m.show_up_used),
      marginal: <span className="font-medium">{inr(m.marginal_cac_per_visitor)}</span>,
      average: inr(m.average_cac_per_visitor),
    },
    sort: {
      campaign: m.campaign_name,
      spend: m.window_spend_inr,
      regs: m.window_registrations,
      show: m.show_up_used,
      marginal: m.marginal_cac_per_visitor,
      average: m.average_cac_per_visitor,
    },
  }));

  return (
    <PageContainer>
      <PageHeader title="Diagnose & decide" description="Which campaigns to scale, change or stop, and why" />

      <PageSection
        id="recommendations"
        title={
          <TitleWithTip title="Recommendations">
            Median CAC per {unit} {inr(diag.median_cac)}
            {diag.median_show_up !== null ? `, median show-up ${pct(diag.median_show_up)}` : ""}. {diag.cac_basis_note} {diag.method[1]}
          </TitleWithTip>
        }
        action={
          <ThresholdSheet
            keyName="thresholds"
            values={th as unknown as Record<string, number>}
            fields={[
              { k: "stop_cac_ratio", label: "Stop: CAC above (× median)" },
              { k: "stop_showup_ratio", label: "Stop: show-up below (× median)", hint: "Applies after the event." },
              { k: "scale_cac_ratio", label: "Scale: CAC below (× median)" },
              { k: "min_volume", label: "Scale: minimum volume", step: 10, hint: `Attributed ${unit}s.` },
              { k: "bad_stage_ratio", label: "Change: stage below (× overall)" },
            ]}
          />
        }
      >
        <RecommendationList recs={recs} campaigns={diag.campaigns} thresholds={th} unit={unit} showUp={showUp} date={d} />
      </PageSection>

      <PageSection
        id="bottlenecks"
        title={
          <TitleWithTip title="Bottleneck by stage">
            Each cell is the campaign&apos;s stage conversion divided by the overall rate. Hover a cell for the two rates.
          </TitleWithTip>
        }
        action={<BottleneckLegend />}
      >
        <BottleneckTable diag={diag} />
      </PageSection>

      <PageSection id="changes" title="What changed" action={<ComparePicker from={from} to={to} />}>
        {changes.highlights.length > 0 && (
          <ul className="mb-5 space-y-1 text-[13px] text-foreground">
            {changes.highlights.map((h) => (
              <li key={h}>{h.replace(/INR (\d[\d,]*)/g, "₹$1")}</li>
            ))}
          </ul>
        )}
        <div className="grid gap-6 2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <DataTable
            caption="Total metrics that changed"
            compact
            maxHeight="none"
            columns={[
              { id: "metric", header: "Metric" },
              { id: "from", header: shortDate(changes.from), numeric: true },
              { id: "to", header: shortDate(changes.to), numeric: true },
              { id: "delta", header: "Change", numeric: true },
            ]}
            rows={changeRows}
            empty={{ title: "Nothing changed in this window", description: "Pick an earlier start date." }}
          />
          <DataTable
            caption="Change by campaign"
            compact
            maxHeight="none"
            defaultSort={{ id: "regs", desc: true }}
            columns={[
              { id: "campaign", header: "Campaign", sortable: true },
              { id: "spend", header: "Spend", numeric: true, sortable: true },
              { id: "regs", header: "Registrations", numeric: true, sortable: true },
              { id: "visitors", header: "Visitors", numeric: true, sortable: showUp, title: showUp ? undefined : AFTER },
              { id: "share", header: "Share", numeric: true, sortable: true, title: "Share of the change in registrations" },
              { id: "cac", header: "CAC / reg.", numeric: true, sortable: true, title: `CAC per registration on ${shortDate(changes.to)}` },
            ]}
            rows={campaignChangeRows}
          />
        </div>
      </PageSection>

      <PageSection
        id="simulator"
        title={
          <TitleWithTip title="Budget reallocation">
            Moves budget using each campaign&apos;s marginal CAC per visitor over the last {data.settings.simulator.window_days} days (
            {shortDate(marginal[0]?.window_from ?? d)} to {shortDate(marginal[0]?.window_to ?? d)}), with diminishing returns on the receiving side
            (k = {data.settings.simulator.diminishing_k}). The result is an estimate, not a forecast.
          </TitleWithTip>
        }
      >
        <Simulator
          date={d}
          available={marginalReady}
          campaigns={Object.values(snap.by_campaign).map((c) => ({ id: c.campaign_id, name: c.campaign_name }))}
          defaultFrom={worst?.campaign_id ?? "C03"}
          defaultTo={best?.campaign_id ?? "C05"}
        />
        <h3 className="mt-8 mb-2 text-[13px] font-medium text-foreground">Marginal CAC by campaign</h3>
        <DataTable
          caption="Marginal CAC per campaign"
          compact
          maxHeight="none"
          defaultSort={marginalReady ? { id: "marginal" } : { id: "spend", desc: true }}
          columns={[
            { id: "campaign", header: "Campaign", sortable: true },
            { id: "spend", header: "Spend", numeric: true, sortable: true, title: "Spend in the window" },
            { id: "regs", header: "Registrations", numeric: true, sortable: true, title: "Registrations in the window" },
            // Before the event, show-up is each channel's observed rate in this data (the projection's prior); the tooltip names the source.
            { id: "show", header: showUp ? "Show-up" : "Show-up (prior)", numeric: true, sortable: true, title: sources },
            { id: "marginal", header: "Marginal CAC", numeric: true, sortable: true, title: showUp ? "Marginal CAC per visitor" : "Marginal CAC per expected visitor (uses the show-up prior)" },
            { id: "average", header: "Average CAC", numeric: true, sortable: true, title: showUp ? "Average CAC per visitor" : "Average CAC per expected visitor (uses the show-up prior)" },
          ]}
          rows={marginalRows}
        />
      </PageSection>
    </PageContainer>
  );
}
