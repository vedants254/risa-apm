import Link from "next/link";
import { InfoTip, TrendExplorer } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { DataTable, PageContainer, PageHeader, PageSection, PageToolbar, type DataColumn, type DataRow } from "@/components/shared";
import { n, pct, ratio, shortDate } from "@/lib/format";
import { STAGE_LABELS, computeSnapshot, computeTrend, funnelFromSnapshot, loadData, snapshotDate, type FunnelStage } from "@/lib/metrics";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Which population a stage-to-stage rate is measured on. */
const RATE_BASIS: Record<string, string> = {
  ctr: "Events",
  click_to_session: "Events",
  session_to_start: "Events",
  start_to_registration_proxy: "Events to people",
};

/** Stage labels read "A → B"; tables show them as plain sentences. The basis column carries the proxy detail. */
const sentence = (label: string) => label.replace(/\s*→\s*/g, " to ").replace(/\(proxy:[^)]*\)/, "(proxy)");

/**
 * One funnel as stacked steps: label, the count, the conversion from the previous stage as a
 * compact number, and a round-ended bar scaled to the first stage (no track behind it).
 * People are violet (--chart-1); anonymous event counts are near-black (--foreground), so both read as data.
 */
function FunnelSteps({ stages, tone, notHeld }: { stages: FunnelStage[]; tone: "events" | "people"; notHeld?: string[] }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <ol className="space-y-5">
      {stages.map((s, i) => {
        const pending = notHeld?.includes(s.key);
        return (
          <li key={s.key}>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_5.5rem] items-baseline gap-x-4 text-[13px]">
              <span className="truncate text-foreground">{s.label}</span>
              <span className="text-sm font-semibold text-foreground tabular">{n(s.value)}</span>
              <span className="text-right text-muted-foreground tabular" title={i > 0 ? "Share of the previous stage" : undefined}>
                {i === 0 ? "" : pending ? "Not held yet" : pct(s.rate_from_prev)}
              </span>
            </div>
            <div
              className={cn("mt-2 h-2 min-w-2 rounded-full", tone === "events" ? "bg-foreground" : "bg-chart-1", s.value <= 0 && "hidden")}
              style={{ width: `${(s.value / max) * 100}%` }}
            />
          </li>
        );
      })}
    </ol>
  );
}

export default async function FunnelPage({ searchParams }: { searchParams: Promise<{ d?: string; c?: string }> }) {
  const sp = await searchParams;
  const d = await snapshotDate(sp.d);
  const data = await loadData();
  const snap = computeSnapshot(data, d);
  const c = sp.c && snap.by_campaign[sp.c] ? sp.c : null;
  const f = funnelFromSnapshot(snap, c);
  const overall = funnelFromSnapshot(snap, null);
  const trend = computeTrend(data, data.event.history_start, d, c);
  const pre = snap.phase === "pre_event";
  const campaigns = Object.values(snap.by_campaign);

  // Campaign filters are ghost Buttons; the current one gets the quiet pressed fill.
  const filter = (on: boolean) => cn("text-[13px]", on ? "bg-accent font-medium text-foreground" : "font-normal");
  const notHeld = <span className="text-muted-foreground">Not held yet</span>;

  // ---- Stage conversion: the selected campaign against all campaigns ----
  const rateColumns: DataColumn[] = [
    { id: "stage", header: "Stage" },
    { id: "basis", header: "Measured on", className: "text-muted-foreground" },
    { id: "rate", header: c ? f.campaign_name : "Rate", numeric: true },
    ...(c
      ? [
          { id: "overall", header: "All campaigns", numeric: true },
          { id: "vs", header: "Ratio", numeric: true, title: "Campaign rate divided by the all-campaign rate" },
        ]
      : []),
  ];
  const rateRows: DataRow[] = Object.keys(STAGE_LABELS).map((k) => {
    const v = f.rates[k];
    const o = overall.rates[k];
    const r = v !== null && o ? v / o : null;
    const hide = k === "show_up" && pre;
    const low = r !== null && r < 0.75;
    return {
      id: k,
      cells: {
        stage: sentence(STAGE_LABELS[k]),
        basis: RATE_BASIS[k] ?? "People",
        rate: hide ? notHeld : pct(v),
        overall: hide ? notHeld : pct(o),
        vs: hide ? <span className="text-muted-foreground">—</span> : <span className={low ? "font-semibold text-foreground" : "text-muted-foreground"}>{ratio(r)}</span>,
      },
    };
  });

  // ---- Per-campaign breakdown ----
  const campColumns: DataColumn[] = [
    { id: "campaign", header: "Campaign" },
    { id: "clicks", header: "Clicks", numeric: true, className: "text-muted-foreground", title: "Platform event count, not people" },
    { id: "starts", header: "Reg. starts", numeric: true, className: "text-muted-foreground", title: "Form-start events, not people" },
    { id: "identified", header: "Identified", numeric: true, title: "Distinct external people, first-touch campaign" },
    { id: "registered", header: "Registered", numeric: true, title: "Distinct external people, registration campaign" },
    { id: "confirmed", header: "Confirmed", numeric: true, title: "Status as of the snapshot date" },
    { id: "visitors", header: "Visitors", numeric: true, title: pre ? "The event has not been held yet" : "Verified visitors; the total includes walk-ins" },
    // Before the event, show-up is undefined; the visitors column already says so.
    ...(pre ? [] : [{ id: "showup", header: "Show-up", numeric: true }]),
  ];
  const campRows: DataRow[] = campaigns.map((x) => ({
    id: x.campaign_id,
    state: c === x.campaign_id ? "selected" : undefined,
    cells: {
      campaign: (
        <Link
          href={`/funnel?d=${d}&c=${x.campaign_id}`}
          scroll={false}
          className="font-medium text-foreground underline-offset-4 hover:underline"
          aria-current={c === x.campaign_id ? "true" : undefined}
        >
          {x.campaign_name}
        </Link>
      ),
      clicks: n(x.clicks),
      starts: n(x.registration_starts),
      identified: n(x.identified_external),
      registered: n(x.registered_external),
      confirmed: n(x.status_counts.confirmed),
      visitors: pre ? notHeld : n(x.verified_visitors),
      showup: pct(x.show_up_rate),
    },
  }));
  const t = snap.totals;
  const totalRow: DataRow = {
    id: "total",
    state: "total",
    cells: {
      campaign: "Total",
      clicks: n(t.clicks),
      starts: n(t.registration_starts),
      identified: n(t.identified_external),
      registered: n(t.registered_external),
      confirmed: n(t.status_counts.confirmed),
      visitors: pre ? notHeld : n(t.verified_visitors),
      showup: pct(overall.rates.show_up),
    },
  };

  return (
    <PageContainer>
      <PageHeader
        title="Funnel"
        description={
          <span className="tabular">
            {f.campaign_name}, as of {shortDate(d)} {d.slice(0, 4)}
          </span>
        }
      />

      <PageToolbar>
        <Button asChild variant="ghost" size="sm" className={filter(!c)}>
          <Link href={`/funnel?d=${d}`} scroll={false} aria-current={!c ? "page" : undefined}>
            All campaigns
          </Link>
        </Button>
        {campaigns.map((x) => (
          <Button key={x.campaign_id} asChild variant="ghost" size="sm" className={filter(c === x.campaign_id)}>
            <Link href={`/funnel?d=${d}&c=${x.campaign_id}`} scroll={false} aria-current={c === x.campaign_id ? "page" : undefined}>
              {x.campaign_name}
            </Link>
          </Button>
        ))}
      </PageToolbar>

      <PageSection
        id="stages"
        title={
          <span className="inline-flex items-center gap-1">
            Stage by stage
            <InfoTip label="How the two funnels relate">
              Anonymous activity and people are counted differently and never joined at person level. Form starts are events and registrations are
              people, so starts to registrations is a proxy ratio. Stages are not strictly nested: a visitor may be cancelled or waitlisted as of the
              snapshot date.
            </InfoTip>
          </span>
        }
        className="@container"
      >
        <div className="grid grid-cols-1 gap-x-16 gap-y-12 @min-[720px]:grid-cols-2">
          <div className="min-w-0">
            <h3 className="mb-5 inline-flex items-center gap-1 text-[13px] font-medium text-foreground">
              Anonymous activity
              <InfoTip label="About anonymous counts">
                Event counts, not people. Impressions, clicks, sessions and form starts are platform events. Reach is never summed into unique people.
              </InfoTip>
            </h3>
            <FunnelSteps stages={f.anonymous} tone="events" />
          </div>
          <div className="min-w-0">
            <h3 className="mb-5 inline-flex items-center gap-1 text-[13px] font-medium text-foreground">
              People
              <InfoTip label="About attribution">
                Distinct external people.{" "}
                {c ? "Attributed by registration campaign; identified by first-touch campaign." : "Verified visitors include walk-ins, who have no registration."}
              </InfoTip>
            </h3>
            <FunnelSteps stages={f.people} tone="people" notHeld={pre ? ["verified_visitors"] : undefined} />
          </div>
        </div>
      </PageSection>

      <PageSection
        id="conversion"
        title={
          c ? (
            <span className="inline-flex items-center gap-1">
              Conversion between stages
              <InfoTip label="How to read the ratio">
                {f.campaign_name} against all campaigns. Ratios in bold are below 0.75× the overall rate.
              </InfoTip>
            </span>
          ) : (
            "Conversion between stages"
          )
        }
      >
        <DataTable columns={rateColumns} rows={rateRows} compact className="rounded-none border-0" caption="Stage conversion rates" />
      </PageSection>

      <PageSection
        id="by-campaign"
        title={
          <span className="inline-flex items-center gap-1">
            By campaign
            <InfoTip label="About these counts">Clicks and registration starts are event counts, not people.</InfoTip>
          </span>
        }
      >
        <DataTable columns={campColumns} rows={campRows} footerRows={[totalRow]} compact className="rounded-none border-0" caption="Funnel stages by campaign" />
      </PageSection>

      <PageSection id="trends" title="Trends">
        <TrendExplorer data={trend} />
      </PageSection>
    </PageContainer>
  );
}
