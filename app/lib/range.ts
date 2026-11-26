/**
 * The active dataset's date range, as read from the event table (lib/metrics.ts getDataRange).
 * Pure and client-safe: the shell, the timeline and every page resolve the ?d= snapshot date
 * against it, so a date from a previous dataset is clamped into the current one.
 */
export interface DataRange {
  /** First and last day the data covers. */
  start: string;
  end: string;
  /** Event days (YYYY-MM-DD). */
  eventStart: string;
  eventEnd: string;
  /** Snapshot date used when the URL has none: the last event day, or the last data day. */
  defaultDate: string;
  eventName: string;
  /** Active dataset (dataset_versions.id): client state tied to the data resets when it changes. */
  datasetId: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (d: string | null | undefined): d is string => !!d && DATE_RE.test(d) && !Number.isNaN(Date.parse(d));

export function clampToRange(d: string, r: Pick<DataRange, "start" | "end">): string {
  return d < r.start ? r.start : d > r.end ? r.end : d;
}

/** A valid ?d= clamped into the range, else the range's default date. */
export function resolveDate(d: string | null | undefined, r: DataRange): string {
  return isIsoDate(d) ? clampToRange(d, r) : r.defaultDate;
}
