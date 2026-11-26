"use client";

/**
 * Charts (Recharts 3 inside the shadcn ChartContainer).
 * - Brand palette through tokens only: --chart-1 (violet) for actuals, --chart-2 (orange, dashed) only for a
 *   target or pace line, CHART.projection (light violet) for the projection band, the neutral event shade for event
 *   days and grey (--chart-3) for anonymous event counts. No hex values here.
 * - Muted horizontal gridlines only, no axis lines, 12px muted tabular ticks, 2px lines, rounded bar ends.
 * - Animate on first mount only (400ms ease-out); data updates swap instantly; reduced motion is honoured.
 */
import { Info } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CHART, inr, n, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const AXIS_TICK = { fontSize: 12, fill: CHART.axis };
const CONTAINER = "aspect-auto w-full min-w-0 [&_.recharts-responsive-container]:min-w-0 [&_.recharts-text]:tabular-nums [&_.recharts-surface]:overflow-visible";
const ANIM_MS = 400;
/** Gridlines sit well behind the data. */
const GRID = { stroke: CHART.grid, strokeOpacity: 0.6, vertical: false } as const;
/** The projection band is already a light violet token, so it is drawn nearly opaque. */
const BAND_OPACITY = 0.85;
/**
 * Event days and hover cursors use the neutral surface tokens, not CHART.tint (--event-shade is now light
 * orange, which would read as part of the orange pace line).
 */
const EVENT_DAYS = "var(--muted)";
const CURSOR = "var(--accent)";

/** True only during the first mount (and never under reduced motion), so later data changes swap instantly. */
function useMountAnimation() {
  const reduced = useReducedMotion();
  const [first, setFirst] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setFirst(false), ANIM_MS + 100);
    return () => clearTimeout(t);
  }, []);
  return first && !reduced;
}

/**
 * A 14px info icon whose tooltip carries an explanation that would otherwise be a caption.
 * Safe to use from server components.
 */
export function InfoTip({ children, label = "More information", className }: { children: React.ReactNode; label?: string; className?: string }) {
  return (
    <UiTooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded-sm align-middle text-muted-foreground transition-colors duration-(--dur-1) hover:text-foreground",
            className,
          )}
        >
          <Info className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72 leading-relaxed font-normal">
        {children}
      </TooltipContent>
    </UiTooltip>
  );
}

export interface TrendRow {
  date: string;
  daily: Record<string, number>;
  cumulative: Record<string, number>;
}

/* ---------------------------------------------------------------- tooltip and legend */

type Swatch = "line" | "dash" | "band" | "bar" | "shade";

function SwatchMark({ kind, color }: { kind: Swatch; color: string }) {
  if (kind === "shade") return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-[2px] bg-muted ring-1 ring-border ring-inset" />;
  if (kind === "band" || kind === "bar")
    return (
      <span
        aria-hidden
        className="inline-block size-2.5 shrink-0 rounded-[2px]"
        style={{ background: color, opacity: kind === "band" ? BAND_OPACITY : 1 }}
      />
    );
  return (
    <svg width="14" height="6" aria-hidden className="shrink-0">
      <line x1="0" y1="3" x2="14" y2="3" stroke={color} strokeWidth="2" strokeDasharray={kind === "dash" ? "3 2" : undefined} />
    </svg>
  );
}

/** Popover-style tooltip: date header, then label and tabular value per row. */
function ChartTip({ title, rows }: { title: React.ReactNode; rows: { key: string; label: string; value: React.ReactNode; kind: Swatch; color: string }[] }) {
  return (
    <div className="min-w-40 rounded-xl border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1.5 font-medium text-foreground">{title}</div>
      <div className="grid gap-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2">
            <SwatchMark kind={r.kind} color={r.color} />
            <span className="text-muted-foreground">{r.label}</span>
            <span className="ml-auto pl-3 font-medium tabular-nums text-foreground">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Inline legend above the chart. */
function Legend({ items, className }: { items: { label: string; kind: Swatch; color: string }[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <SwatchMark kind={i.kind} color={i.color} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- pace chart */

export interface PaceRow {
  date: string;
  registered: number | null;
  pace: number | null;
  band: [number, number] | null;
}

const paceConfig = {
  registered: { label: "Actual", color: CHART.actual },
  pace: { label: "Target pace", color: CHART.target },
  band: { label: "Projected range", color: CHART.projection },
} satisfies ChartConfig;

/**
 * Cumulative actuals (violet) against the target pace (orange, dashed), the projection band (light violet)
 * and the shaded event days (light neutral). The `registered` field holds whichever actual series is plotted.
 */
export function PaceChart({
  rows,
  snapshot,
  eventStart,
  eventEnd,
  height = 248,
  actualLabel = "Registrations to date",
  targetLabel = "Target pace",
  bandLabel = "Projected range",
  money = false,
}: {
  rows: PaceRow[];
  snapshot: string;
  eventStart: string;
  eventEnd: string;
  height?: number;
  /** Legend and tooltip label for the actual series. */
  actualLabel?: string;
  targetLabel?: string;
  bandLabel?: string;
  /** Format values as rupees. */
  money?: boolean;
}) {
  const animate = useMountAnimation();
  const hasBand = rows.some((r) => r.band);
  const fmt = (v: number) => (money ? inr(v) : n(v));
  const tick = (v: number) => (money ? inr(v, { compact: true }) : n(v));
  return (
    <div>
      <Legend
        className="mb-3"
        items={[
          { label: actualLabel, kind: "line", color: CHART.actual },
          { label: targetLabel, kind: "dash", color: CHART.target },
          ...(hasBand ? [{ label: bandLabel, kind: "band" as const, color: CHART.projection }] : []),
          { label: "Event days", kind: "shade" as const, color: EVENT_DAYS },
        ]}
      />
      <ChartContainer config={paceConfig} className={CONTAINER} style={{ height }}>
        <ComposedChart data={rows} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="date" tick={AXIS_TICK} tickFormatter={shortDate} minTickGap={56} axisLine={false} tickLine={false} tickMargin={8} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={money ? 56 : 44} tickFormatter={tick} />
          <ReferenceArea x1={eventStart} x2={eventEnd} fill={EVENT_DAYS} fillOpacity={1} ifOverflow="extendDomain" />
          <ReferenceLine x={snapshot} stroke={CHART.axis} strokeDasharray="2 3" strokeOpacity={0.7} />
          <Tooltip
            cursor={{ stroke: CHART.grid, strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as PaceRow;
              const rows: Parameters<typeof ChartTip>[0]["rows"] = [];
              if (r.registered !== null) rows.push({ key: "a", label: actualLabel, value: fmt(r.registered), kind: "line", color: CHART.actual });
              if (r.pace !== null) rows.push({ key: "p", label: targetLabel, value: fmt(r.pace), kind: "dash", color: CHART.target });
              if (r.band) rows.push({ key: "b", label: "Projected", value: `${fmt(r.band[0])} to ${fmt(r.band[1])}`, kind: "band", color: CHART.projection });
              return <ChartTip title={`${shortDate(String(label))} ${String(label).slice(0, 4)}`} rows={rows} />;
            }}
          />
          {hasBand && (
            <Area
              type="linear"
              dataKey="band"
              stroke="none"
              fill="var(--color-band)"
              fillOpacity={BAND_OPACITY}
              connectNulls={false}
              isAnimationActive={animate}
              animationDuration={ANIM_MS}
              animationEasing="ease-out"
            />
          )}
          <Line
            type="linear"
            dataKey="pace"
            stroke="var(--color-pace)"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            activeDot={false}
            isAnimationActive={animate}
            animationDuration={ANIM_MS}
            animationEasing="ease-out"
          />
          <Line
            type="monotone"
            dataKey="registered"
            stroke="var(--color-registered)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--card)" }}
            isAnimationActive={animate}
            animationDuration={ANIM_MS}
            animationEasing="ease-out"
          />
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}

/* ---------------------------------------------------------------- trend explorer */

const TREND_OPTIONS: { key: string; label: string; money?: boolean; anonymous?: boolean }[] = [
  { key: "registered_external", label: "Registrations" },
  { key: "identified_external", label: "Identified people" },
  { key: "verified_visitors", label: "Verified visitors" },
  { key: "spend_inr", label: "Net spend", money: true },
  { key: "clicks", label: "Clicks", anonymous: true },
  { key: "landing_page_sessions", label: "Landing sessions", anonymous: true },
  { key: "registration_starts", label: "Registration starts", anonymous: true },
  { key: "impressions", label: "Impressions", anonymous: true },
  { key: "confirmed", label: "Confirmed (stock)" },
];

/** Plain toggles on the shared Button: the pressed one gets the quiet pressed fill. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-0.5 text-[13px]">
      {options.map((o) => {
        const on = value === o.value && !disabled;
        return (
          <Button
            key={o.value}
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn("text-[13px]", on ? "font-medium" : "font-normal")}
          >
            {o.label}
          </Button>
        );
      })}
    </div>
  );
}

/** Daily bars or a cumulative line for one metric, user-selectable. */
export function TrendExplorer({ data, initial = "registered_external", height = 240 }: { data: TrendRow[]; initial?: string; height?: number }) {
  const animate = useMountAnimation();
  const [metric, setMetric] = useState(initial);
  const [mode, setMode] = useState<"daily" | "cumulative">("daily");
  const opt = TREND_OPTIONS.find((o) => o.key === metric) ?? TREND_OPTIONS[0];
  const isStock = metric === "confirmed";
  const daily = mode === "daily" && !isStock;
  const rows = data.map((d) => ({ date: d.date, v: daily ? d.daily[metric] : d.cumulative[metric] }));
  // People and money in the actuals colour; anonymous platform events in neutral grey, as on the funnel.
  const color = opt.anonymous ? CHART.other : CHART.actual;
  const trendConfig = { v: { label: "Value", color } } satisfies ChartConfig;
  const note = isStock ? "Confirmed is a stock: the count at the end of each day." : opt.anonymous ? `${opt.label} are platform event counts, not people.` : null;
  const tick = (v: number) => (opt.money ? inr(v, { compact: true }) : n(v));
  const seriesLabel = `${opt.label}${isStock ? "" : daily ? ", daily" : ", cumulative"}`;
  const tip = ({ active, payload, label }: { active?: boolean; payload?: readonly { value?: unknown }[]; label?: unknown }) =>
    active && payload?.length ? (
      <ChartTip
        title={`${shortDate(String(label))} ${String(label).slice(0, 4)}`}
        rows={[
          {
            key: "v",
            label: seriesLabel,
            value: opt.money ? inr(Number(payload[0].value)) : n(Number(payload[0].value)),
            kind: daily ? "bar" : "line",
            color,
          },
        ]}
      />
    ) : null;
  const axes = (
    <>
      <CartesianGrid {...GRID} />
      <XAxis dataKey="date" tick={AXIS_TICK} tickFormatter={shortDate} minTickGap={48} axisLine={false} tickLine={false} tickMargin={8} />
      <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={opt.money ? 56 : 48} tickFormatter={tick} />
    </>
  );
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-1">
          <Legend items={[{ label: seriesLabel, kind: daily ? "bar" : "line", color }]} />
          {note && <InfoTip label="How to read this series">{note}</InfoTip>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={metric} onValueChange={setMetric}>
            <SelectTrigger size="sm" aria-label="Metric" className="rounded-full border-transparent pr-2 pl-3 text-[13px] font-medium shadow-none hover:bg-accent">
              {/* Explicit label so the value shows before the select content mounts (SSR). */}
              <SelectValue>{opt.anonymous ? `${opt.label} (events)` : opt.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {TREND_OPTIONS.map((o) => (
                <SelectItem key={o.key} value={o.key} className="text-[13px]">
                  {o.anonymous ? `${o.label} (events)` : o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Segmented
            label="View"
            value={mode}
            disabled={isStock}
            onChange={setMode}
            options={[
              { value: "daily", label: "Daily" },
              { value: "cumulative", label: "Cumulative" },
            ]}
          />
        </div>
      </div>
      <ChartContainer config={trendConfig} className={CONTAINER} style={{ height }}>
        {daily ? (
          <BarChart data={rows} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
            {axes}
            <Tooltip cursor={{ fill: CURSOR }} content={tip} isAnimationActive={false} />
            <Bar dataKey="v" name={opt.label} fill="var(--color-v)" radius={[3, 3, 0, 0]} isAnimationActive={animate} animationDuration={ANIM_MS} animationEasing="ease-out" />
          </BarChart>
        ) : (
          <LineChart data={rows} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
            {axes}
            <Tooltip cursor={{ stroke: CHART.grid, strokeWidth: 1 }} content={tip} isAnimationActive={false} />
            <Line
              type="monotone"
              dataKey="v"
              name={opt.label}
              stroke="var(--color-v)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--card)" }}
              isAnimationActive={animate}
              animationDuration={ANIM_MS}
              animationEasing="ease-out"
            />
          </LineChart>
        )}
      </ChartContainer>
    </div>
  );
}

/* ---------------------------------------------------------------- campaign bars */

const barsConfig = { value: { label: "Value", color: CHART.actual } } satisfies ChartConfig;

/** Horizontal bars per campaign for one metric, with rounded ends and an optional median reference (grey, dashed). */
export function CampaignBars({
  rows,
  median,
  money,
  label,
}: {
  rows: { id: string; name: string; value: number | null }[];
  median?: number | null;
  money?: boolean;
  label: string;
}) {
  const animate = useMountAnimation();
  const data = rows.filter((r) => r.value !== null);
  const fmt = (v: number) => (money ? inr(v) : n(v));
  return (
    <ChartContainer config={barsConfig} className={CONTAINER} style={{ height: Math.max(160, data.length * 32 + 32) }}>
      <BarChart data={data} layout="vertical" margin={{ top: 18, right: 64, left: 0, bottom: 0 }} barCategoryGap={8}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fill: "var(--foreground)" }} width={140} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: CURSOR }}
          isAnimationActive={false}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <ChartTip
                title={String(payload[0].payload.name)}
                rows={[{ key: "v", label, value: fmt(Number(payload[0].value)), kind: "bar", color: CHART.actual }]}
              />
            ) : null
          }
        />
        {median ? (
          <ReferenceLine
            x={median}
            stroke={CHART.axis}
            strokeWidth={1}
            strokeOpacity={0.7}
            strokeDasharray="4 3"
            label={{ value: `Median ${fmt(median)}`, position: "top", fontSize: 12, fill: CHART.axis }}
          />
        ) : null}
        <Bar
          dataKey="value"
          name={label}
          fill="var(--color-value)"
          radius={[0, 999, 999, 0]}
          maxBarSize={14}
          isAnimationActive={animate}
          animationDuration={ANIM_MS}
          animationEasing="ease-out"
          label={{ position: "right", fontSize: 12, fill: CHART.axis, formatter: (v: unknown) => fmt(Number(v)) }}
        />
      </BarChart>
    </ChartContainer>
  );
}
