"use client";

import NumberFlow, { type Format } from "@number-flow/react";
import Link from "next/link";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** How a numeric value is displayed. Strings are shown as-is (use them for "—" or pre-formatted text). */
export type StatFormat = "number" | "inr" | "percent" | "ratio";

const FORMATS: Record<StatFormat, { format: Format; suffix?: string }> = {
  number: { format: { maximumFractionDigits: 0 } },
  inr: { format: { style: "currency", currency: "INR", maximumFractionDigits: 0 } },
  percent: { format: { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 } },
  ratio: { format: { minimumFractionDigits: 2, maximumFractionDigits: 2 }, suffix: "×" },
};

/** Animated on data change only (not first paint); honours reduced motion. */
export function Num({ value, format = "number", className }: { value: number | null | undefined; format?: StatFormat; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={cn("tabular", className)}>—</span>;
  const f = FORMATS[format];
  return (
    <NumberFlow
      value={value}
      locales="en-IN"
      format={f.format}
      suffix={f.suffix}
      className={cn("tabular", className)}
      transformTiming={{ duration: 500, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
    />
  );
}

/** 24px sparkline in --chart-1. */
export function Sparkline({ values, className, label }: { values: number[]; className?: string; label?: string }) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * 100},${22 - ((x - min) / span) * 20}`).join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={cn("h-6 w-full", className)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <polyline points={pts} fill="none" stroke="var(--chart-1)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export interface StatDelta {
  /** Pre-formatted, with its sign: "+120", "−3.2%". */
  text: string;
  direction: "up" | "down" | "flat";
  /** Whether the movement is good. Arrow, sign and colour always appear together. */
  tone?: "good" | "bad" | "neutral";
  /** What it is compared with: "vs 7 days ago". */
  label?: string;
}

/**
 * One metric: 13px muted label, a 28/600 tabular value (40px for the single hero),
 * the denominator or goal beside it, an optional thin progress bar, delta and sparkline.
 * No icon beside the number.
 */
export function StatBlock({
  label,
  value,
  format = "number",
  goal,
  progress,
  delta,
  sparkline,
  sub,
  size = "default",
  selected,
  href,
  hint,
  className,
}: {
  label: React.ReactNode;
  value: number | string | null | undefined;
  format?: StatFormat;
  /** Denominator text beside the value: "of 2,200 goal". */
  goal?: React.ReactNode;
  /** Thin bar: value / goal. */
  progress?: { value: number; goal: number | null | undefined };
  delta?: StatDelta;
  sparkline?: number[];
  /** Avoid: a short line under the value, in body text (no tiny grey helper lines). Prefer a tooltip. */
  sub?: React.ReactNode;
  size?: "default" | "hero";
  /** Selected KPI in a strip that drives a chart: the label turns violet. No underline. */
  selected?: boolean;
  /** Makes the whole block a link (e.g. ?metric=...). */
  href?: string;
  /** Shown in a tooltip on hover or focus, e.g. the count behind a percentage: "2,243 of 3,200 goal". */
  hint?: React.ReactNode;
  className?: string;
}) {
  const p = progress && progress.goal ? Math.min(1, Math.max(0, progress.value / progress.goal)) : null;
  const DeltaIcon = delta?.direction === "up" ? TrendingUp : delta?.direction === "down" ? TrendingDown : Minus;
  const body = (
    <>
      <div className={cn("text-[13px] transition-colors duration-(--dur-1)", selected ? "font-medium text-primary" : "text-muted-foreground")}>{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
        <span className={cn("leading-[1.15] font-semibold text-foreground", size === "hero" ? "text-[40px]" : "text-[28px]")}>
          {typeof value === "string" ? <span className="tabular">{value}</span> : <Num value={value} format={format} />}
        </span>
        {goal && <span className="text-[13px] text-muted-foreground tabular">{goal}</span>}
      </div>
      {p !== null && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
          <div className="h-full rounded-full bg-primary" style={{ width: `${p * 100}%` }} />
        </div>
      )}
      {delta && (
        <div
          className={cn(
            "mt-1.5 inline-flex items-center gap-1 text-xs tabular",
            delta.tone === "good" ? "text-success" : delta.tone === "bad" ? "text-danger" : "text-muted-foreground",
          )}
        >
          <DeltaIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span>{delta.text}</span>
          {delta.label && <span className="text-muted-foreground">{delta.label}</span>}
        </div>
      )}
      {sub && <div className="mt-1.5 text-[13px] text-foreground">{sub}</div>}
      {sparkline && <Sparkline values={sparkline} className="mt-2" />}
    </>
  );
  const cls = cn("block min-w-0", className);
  const el = href ? (
    <Link href={href} scroll={false} aria-current={selected ? "true" : undefined} className={cn(cls, "rounded-lg transition-colors duration-(--dur-1) hover:bg-accent")}>
      {body}
    </Link>
  ) : (
    <div className={cls} tabIndex={hint ? 0 : undefined}>
      {body}
    </div>
  );
  if (!hint) return el;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{el}</TooltipTrigger>
      <TooltipContent className="tabular">{hint}</TooltipContent>
    </Tooltip>
  );
}

/** KPI strip: metrics in one row separated by space only, no boxes or lines. Stacks on narrow screens. */
export function KpiStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none", className)}>
      {children}
    </div>
  );
}
