/** Scale / change / stop recommendations as one sortable table (server-safe). Row actions appear on hover or focus. */
import { CreateTaskButton, LogDecisionButton } from "@/components/actions";
import { DataTable, DecisionBadge, StatusChip, campaignStatusTone, type DataRow } from "@/components/shared";
import { inr, n, pct, ratio } from "@/lib/format";
import type { CampaignDiagnosis, Recommendation } from "@/lib/insights";
import type { Thresholds } from "@/lib/settings";
import { SHORT_STAGE, stageName } from "./BottleneckTable";

const ORDER = ["stop", "scale", "change", "maintain"];

/** The number that triggered the rule, as a short phrase ("Cost 2.20× median"). Keep has no reason. */
function reason(r: Recommendation, c: CampaignDiagnosis | undefined, th: Thresholds) {
  if (!c) return null;
  const cr = c.cac_ratio_to_median;
  switch (r.action) {
    case "stop":
      return cr !== null && cr > th.stop_cac_ratio ? `Cost ${ratio(cr)} median` : `Show-up ${ratio(c.show_up_ratio_to_median)} median`;
    case "scale":
      return `Cost ${ratio(cr)} median`;
    case "change":
      return c.bottleneck ? `${SHORT_STAGE[c.bottleneck.stage] ?? stageName(c.bottleneck.label)} ${ratio(c.bottleneck.ratio_to_overall)}` : null;
    default:
      return null;
  }
}

export function RecommendationList({
  recs,
  campaigns,
  thresholds,
  unit,
  showUp,
  date,
}: {
  recs: Recommendation[];
  campaigns: CampaignDiagnosis[];
  thresholds: Thresholds;
  unit: "visitor" | "registration";
  /** Show-up is only known once check-ins exist (after the event). */
  showUp: boolean;
  date: string;
}) {
  const byId = new Map(campaigns.map((c) => [c.campaign_id, c]));
  const rows: DataRow[] = recs.map((r) => {
    const c = byId.get(r.campaign_id);
    const volume = c ? (unit === "visitor" ? c.verified_visitors : c.registered_external) : null;
    return {
      id: r.campaign_id,
      cells: {
        decision: <DecisionBadge action={r.action} />,
        campaign: (
          <span className="inline-flex items-center gap-2">
            <span className="font-medium text-foreground">{r.campaign_name}</span>
            {r.campaign_status !== "active" && <StatusChip tone={campaignStatusTone(r.campaign_status)}>{r.campaign_status.charAt(0).toUpperCase() + r.campaign_status.slice(1)}</StatusChip>}
          </span>
        ),
        owner: <span className="text-muted-foreground">{r.owner_name}</span>,
        reason: <span className="tabular">{reason(r, c, thresholds)}</span>,
        cac: inr(c?.cac),
        show_up: pct(c?.show_up_rate),
        volume: n(volume),
        actions: (
          <div className="-my-1 flex justify-end gap-0.5 opacity-0 transition-opacity duration-(--dur-1) group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <CreateTaskButton draft={r.suggested_task} icon />
            <LogDecisionButton campaign_id={r.campaign_id} kind={r.action} description={`${r.rule} (snapshot ${date})`} owner_name={r.owner_name} icon />
          </div>
        ),
      },
      sort: {
        decision: ORDER.indexOf(r.action),
        campaign: r.campaign_name,
        owner: r.owner_name,
        cac: c?.cac ?? null,
        show_up: showUp ? (c?.show_up_rate ?? null) : null,
        volume,
      },
    };
  });

  return (
    <DataTable
      caption="Recommendations by campaign"
      defaultSort={{ id: "decision" }}
      maxHeight="none"
      stickyFirstColumn={false}
      columns={[
        { id: "decision", header: "Decision", sortable: true, className: "px-2" },
        { id: "campaign", header: "Campaign", sortable: true, className: "px-2" },
        { id: "owner", header: "Owner", className: "px-2" },
        { id: "reason", header: "Reason", className: "px-2" },
        { id: "cac", header: "CAC", numeric: true, sortable: true, className: "px-2", title: `CAC per ${unit}` },
        ...(showUp ? [{ id: "show_up", header: "Show-up", numeric: true, sortable: true, className: "px-2" }] : []),
        { id: "volume", header: unit === "visitor" ? "Visitors" : "Registrations", numeric: true, sortable: true, className: "px-2" },
        { id: "actions", header: "", className: "w-16 pr-0 pl-1" },
      ]}
      rows={rows}
    />
  );
}
