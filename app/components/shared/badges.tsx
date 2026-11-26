/** Chips (server-safe). Decision badges are soft tinted pills; every other chip is a dot plus text. */
import { cn } from "@/lib/utils";

export type Decision = "scale" | "change" | "stop" | "maintain";

const DECISION: Record<Decision, { label: string; cls: string }> = {
  scale: { label: "Scale", cls: "bg-success-tint text-success" },
  change: { label: "Change", cls: "bg-warning-tint text-warning" },
  stop: { label: "Stop", cls: "bg-danger-tint text-danger" },
  maintain: { label: "Keep", cls: "bg-muted text-muted-foreground" },
};

const chip = "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium whitespace-nowrap";

/** The only place the success / warning / danger colours mean scale / change / stop. */
export function DecisionBadge({ action, className, title }: { action: Decision | string; className?: string; title?: string }) {
  const d = DECISION[(action in DECISION ? action : "maintain") as Decision];
  return (
    <span className={cn(chip, d.cls, className)} title={title}>
      {d.label}
    </span>
  );
}

export type ChipTone = "neutral" | "strong" | "info" | "success" | "warning" | "danger";

/** Dot colour per tone. The text stays neutral: colour never carries the meaning alone. */
const DOT: Record<ChipTone, string> = {
  neutral: "bg-chart-3",
  strong: "bg-foreground",
  info: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

/** Status, priority, source, verdict: neutral text with a small dot, no box. */
export function StatusChip({ children, tone = "neutral", className, title }: { children: React.ReactNode; tone?: ChipTone; className?: string; title?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap", tone === "strong" ? "text-foreground" : "text-muted-foreground", className)} title={title}>
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}

/** Campaign status → chip tone. Paused and stopped need attention; active is quiet. */
export function campaignStatusTone(status: string): ChipTone {
  return status === "stopped" ? "danger" : status === "paused" ? "warning" : "neutral";
}
