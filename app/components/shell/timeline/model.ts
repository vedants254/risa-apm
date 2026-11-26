import type { DataRange } from "@/lib/range";

/* Dates, milestones and label layout for the countdown timeline. Pure functions, no React.
 * The range (data start/end, event days) comes from the active dataset via createTimeline(). */

/** The team's countdown checkpoints (T-x is counted to the event start). */
export const CHECKPOINTS = [30, 14, 7];

export type Version = { date: string; label: string };

const DAY = 86_400_000;
export const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => toIso(toMs(d) + n * DAY);
export const diffDays = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY);

const formatter = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" });
const FMT_DAY = formatter({ day: "numeric", month: "short" });
const FMT_FULL = formatter({ day: "numeric", month: "short", year: "numeric" });
const FMT_WEEKDAY = formatter({ weekday: "short", day: "numeric", month: "short", year: "numeric" });
const FMT_MONTH = formatter({ month: "short" });
/** "29 Mar", "29 Mar 2025", "Sat 29 Mar 2025", "Mar". */
export const fmtDay = (d: string) => FMT_DAY.format(toMs(d));
export const fmtFull = (d: string) => FMT_FULL.format(toMs(d));
export const fmtWeekday = (d: string) => FMT_WEEKDAY.format(toMs(d)).replace(",", "");
export const fmtMonth = (d: string) => FMT_MONTH.format(toMs(d));

export function versionLabel(name: string): string {
  const s = name.replace(/^attendee\s+/i, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Everything on the timeline that depends on the dataset's dates. */
export function createTimeline(range: Pick<DataRange, "start" | "end" | "eventStart" | "eventEnd">) {
  const HISTORY_START = range.start;
  const HISTORY_END = range.end >= range.start ? range.end : range.start;
  const EVENT_START = range.eventStart;
  const EVENT_END = range.eventEnd >= range.eventStart ? range.eventEnd : range.eventStart;

  const clampDate = (d: string) => (d < HISTORY_START ? HISTORY_START : d > HISTORY_END ? HISTORY_END : d);
  /** Each day is a slot; marks sit at the slot centre. Fractions are 0..1 of the track. */
  const SLOTS = diffDays(HISTORY_START, HISTORY_END) + 1;
  const centre = (d: string) => (diffDays(HISTORY_START, d) + 0.5) / SLOTS;
  const slotStart = (d: string) => diffDays(HISTORY_START, d) / SLOTS;
  const dateAtFraction = (f: number) => addDays(HISTORY_START, Math.max(0, Math.min(SLOTS - 1, Math.floor(f * SLOTS))));

  /** First day of every month strictly inside the range. */
  const MONTH_STARTS: string[] = (() => {
    const out: string[] = [];
    const [y, m] = HISTORY_START.split("-").map(Number);
    for (let i = 1; i < 60; i++) {
      const d = toIso(Date.UTC(y, m - 1 + i, 1));
      if (d > HISTORY_END) break;
      out.push(d);
    }
    return out;
  })();

  /** "T-30", "T-0", "T+1" relative to the event start. */
  const countdownLabel = (d: string): string => {
    const x = diffDays(EVENT_START, d);
    return x <= 0 ? `T-${-x}` : `T+${x}`;
  };

  /** The headline phrase: "14 days to go", "Fest day 2", "7 days after fest". */
  const countdownPhrase = (d: string): string => {
    const toGo = diffDays(d, EVENT_START);
    if (toGo > 0) return `${plural(toGo, "day")} to go`;
    if (d <= EVENT_END) return `Fest day ${diffDays(EVENT_START, d) + 1}`;
    return `${plural(diffDays(EVENT_END, d), "day")} after fest`;
  };

  const checkpointDate = (x: number) => addDays(EVENT_START, -x);
  const isEventDay = (d: string) => d >= EVENT_START && d <= EVENT_END;
  /** Checkpoints that fall inside the data range. */
  const checkpoints = CHECKPOINTS.filter((x) => checkpointDate(x) >= HISTORY_START && checkpointDate(x) <= HISTORY_END);

  /** What happens on a day, for the hover tooltip. */
  const dayNotes = (d: string, versions: Version[]): string[] => {
    const notes: string[] = [];
    for (const v of versions) if (v.date === d) notes.push(`${v.label} takes effect`);
    for (const x of checkpoints) if (checkpointDate(x) === d) notes.push(`T-${x} checkpoint`);
    if (isEventDay(d)) notes.push(`Fest day ${diffDays(EVENT_START, d) + 1}`);
    if (d === HISTORY_START) notes.push("First day of data");
    if (d === HISTORY_END) notes.push("Latest data");
    return notes;
  };

  /** Quick jumps offered next to the typed-date input. */
  const JUMPS: { label: string; date: string }[] = [
    ...checkpoints.map((x) => ({ label: `T-${x}`, date: checkpointDate(x) })),
    ...(EVENT_START >= HISTORY_START && EVENT_START <= HISTORY_END ? [{ label: "Fest day 1", date: EVENT_START }] : []),
    { label: "Latest", date: HISTORY_END },
  ];

  return {
    HISTORY_START,
    HISTORY_END,
    EVENT_START,
    EVENT_END,
    SLOTS,
    MONTH_STARTS,
    JUMPS,
    checkpoints,
    clampDate,
    centre,
    slotStart,
    dateAtFraction,
    countdownLabel,
    countdownPhrase,
    checkpointDate,
    isEventDay,
    dayNotes,
  };
}
export type TimelineModel = ReturnType<typeof createTimeline>;

/* ---------------------------------------------------------------- label layout */

export type Align = "center" | "start" | "end";
export type Row = "top" | "bottom";
export type Anchor = { row: Row; x: number; align?: Align };
/** A label tries its anchors in order and takes the first free one. */
export type LabelSpec = { id: string; w: number; priority: number; anchors: Anchor[]; /** Only shown when this other label is hidden (a short form). */ unless?: string };
export type Placed = { left: number; row: Row; visible: boolean };

/** Left edge of a label anchored at x, kept inside [0, width]. */
export function labelLeft(x: number, w: number, width: number, align: Align = "center"): number {
  const raw = align === "start" ? x : align === "end" ? x - w : x - w / 2;
  return Math.max(0, Math.min(width - w, raw));
}

/**
 * Greedy collision avoidance: labels are placed in priority order (lower first), each at the
 * first of its anchors that keeps `gap` px clear of everything already placed in that row;
 * a label with no free anchor is hidden. `blocked` reserves spans per row (the snapshot pill).
 */
export function placeLabels(
  specs: LabelSpec[],
  width: number,
  blocked: Partial<Record<Row, [number, number][]>> = {},
  gap = 10,
): Record<string, Placed> {
  const taken: Record<Row, [number, number][]> = { top: [...(blocked.top ?? [])], bottom: [...(blocked.bottom ?? [])] };
  const out: Record<string, Placed> = {};
  for (const s of [...specs].sort((a, b) => a.priority - b.priority)) {
    let placed: Placed | null = null;
    const anchors = s.unless && out[s.unless]?.visible ? [] : s.anchors;
    for (const a of anchors) {
      const left = labelLeft(a.x, s.w, width, a.align);
      const right = left + s.w;
      if (s.w > 0 && taken[a.row].every(([l, r]) => right + gap <= l || left >= r + gap)) {
        taken[a.row].push([left, right]);
        placed = { left, row: a.row, visible: true };
        break;
      }
    }
    const first = s.anchors[0];
    out[s.id] = placed ?? { left: labelLeft(first.x, s.w, width, first.align), row: first.row, visible: false };
  }
  return out;
}
