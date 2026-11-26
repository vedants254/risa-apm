/** Display formatting shared by server and client components. Dates come from the active
 *  dataset (lib/range.ts), never from constants. */

export function inr(x: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  if (opts.compact && Math.abs(x) >= 100000) return `₹${(x / 100000).toFixed(2)}L`;
  if (opts.compact && Math.abs(x) >= 1000) return `₹${(x / 1000).toFixed(1)}k`;
  return `₹${Math.round(x).toLocaleString("en-IN")}`;
}
export function n(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return x.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
export function pct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}
export function ratio(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${x.toFixed(2)}×`;
}
export function shortDate(d: string): string {
  const dt = new Date(d.slice(0, 10) + "T00:00:00Z");
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}
export function validDate(d: string | undefined | null, fallback: string): string {
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : fallback;
}

/**
 * Chart colours as CSS variables, so app/globals.css stays the single source of truth.
 * Recharts accepts var() in stroke/fill.
 */
export const CHART = {
  actual: "var(--chart-1)", // violet: the main series
  target: "var(--chart-2)", // orange: target / pace only, dashed
  other: "var(--chart-3)", // neutral grey: every non-primary series
  third: "var(--chart-3)",
  graphite: "var(--chart-4)",
  baseline: "var(--chart-5)",
  projection: "var(--chart-projection)", // light violet: projected range bands
  grid: "var(--border)",
  axis: "var(--muted-foreground)",
  tint: "var(--event-shade)",
  grey: "var(--chart-5)",
  rule: "var(--border)",
} as const;

/** Decision chips: the only place scale/change/stop colours appear. */
