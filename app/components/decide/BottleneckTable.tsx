/**
 * Stage conversion of each campaign relative to the overall rate (server-safe).
 * A custom table rather than DataTable because each cell carries its own shade.
 * One neutral ramp: the further below the overall rate, the darker the cell.
 */
import { pct, ratio } from "@/lib/format";
import type { Diagnosis } from "@/lib/insights";
import { STAGE_LABELS } from "@/lib/metrics";
import { cn } from "@/lib/utils";

/** Short stage names for headers and one-line rules. */
export const SHORT_STAGE: Record<string, string> = {
  ctr: "CTR",
  click_to_session: "Click to session",
  session_to_start: "Session to start",
  start_to_registration_proxy: "Start to reg.",
  identified_to_registered: "Identified to reg.",
  registered_to_confirmed: "Reg. to confirmed",
  show_up: "Show-up",
};

/** "Clicks → landing sessions (proxy …)" becomes "Clicks to landing sessions". */
export function stageName(label: string) {
  return label.split(" (")[0].replace(/\s*→\s*/g, " to ");
}

function shade(r: number | null) {
  if (r === null) return "text-muted-foreground";
  if (r < 0.75) return "bg-foreground/[0.09]";
  if (r < 0.9) return "bg-foreground/[0.045]";
  return "";
}

export function BottleneckLegend() {
  const sw = "inline-block size-3 rounded-[2px]";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className={cn(sw, "bg-foreground/[0.045]")} aria-hidden /> Below 0.9×
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className={cn(sw, "bg-foreground/[0.09]")} aria-hidden /> Below 0.75×
      </span>
      <span>
        <span className="font-semibold text-foreground">Bold</span> biggest drop-off
      </span>
    </div>
  );
}

export function BottleneckTable({ diag }: { diag: Diagnosis }) {
  const stages = Object.keys(STAGE_LABELS).filter((k) => k !== "show_up" || diag.cac_basis === "visitor");
  const th = "h-9 border-b px-3 pb-1.5 align-bottom text-xs font-medium text-muted-foreground";
  const td = "h-9 border-b border-border/60 px-3 whitespace-nowrap";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            <th scope="col" className={cn(th, "sticky left-0 z-[1] bg-card pl-0 text-left")}>
              Campaign
            </th>
            {stages.map((k) => (
              <th key={k} scope="col" title={stageName(STAGE_LABELS[k])} className={cn(th, "min-w-16 text-right leading-tight")}>
                {SHORT_STAGE[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="text-muted-foreground">
            <th scope="row" className={cn(td, "sticky left-0 z-[1] bg-card pl-0 text-left font-normal")}>
              Overall rate
            </th>
            {stages.map((k) => (
              <td key={k} className={cn(td, "text-right tabular")}>
                {pct(diag.overall_rates[k])}
              </td>
            ))}
          </tr>
          {diag.campaigns.map((c) => (
            <tr key={c.campaign_id} className="[&:last-child>*]:border-b-0">
              <th scope="row" className={cn(td, "sticky left-0 z-[1] bg-card pl-0 text-left font-medium text-foreground")}>
                {c.campaign_name}
              </th>
              {c.stages
                .filter((s) => stages.includes(s.stage))
                .map((s) => (
                  <td
                    key={s.stage}
                    className={cn(td, "text-right tabular", shade(s.ratio_to_overall), c.bottleneck?.stage === s.stage && "font-semibold")}
                    title={`${stageName(s.label)}: ${pct(s.campaign_rate)} vs ${pct(s.overall_rate)} overall`}
                  >
                    {ratio(s.ratio_to_overall)}
                  </td>
                ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
