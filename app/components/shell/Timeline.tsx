"use client";

import { CalendarDays } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DataRange } from "@/lib/range";
import {
  addDays,
  createTimeline,
  diffDays,
  fmtDay,
  fmtFull,
  fmtMonth,
  fmtWeekday,
  labelLeft,
  placeLabels,
  versionLabel,
  type LabelSpec,
  type TimelineModel,
  type Version,
} from "./timeline/model";

/*
 * The signature element: the countdown from launch to the fest, and the snapshot date every
 * metric is computed "as of". One track: violet up to the snapshot, neutral after it, the fest
 * days in the orange accent. Milestone labels sit above (plan versions, the fest) and below
 * (T-30 / T-14 / T-7, months) the track and are hidden, lowest priority first, when they would
 * touch another label or the snapshot pill.
 */

const COMMIT_DELAY_MS = 350;
/** Vertical layout of the 68px strip, in px from the top. */
const TRACK_Y = 34;
const PILL_FALLBACK_W = 132;

const pct = (f: number) => `${(f * 100).toFixed(4)}%`;

type Label = LabelSpec & { text: string; tone: "strong" | "muted" | "fest" };

function buildLabels(tl: TimelineModel, versions: Version[], widths: Record<string, number>, width: number): Label[] {
  const { HISTORY_START, HISTORY_END, EVENT_START, EVENT_END, MONTH_STARTS, centre, slotStart, checkpoints, checkpointDate } = tl;
  const at = (d: string) => centre(d) * width;
  const w = (id: string) => widths[id] ?? 0;
  const labels: Label[] = [];

  // The fest: above the track, or below it when the snapshot pill sits on top.
  const festX = ((slotStart(EVENT_START) + slotStart(addDays(EVENT_END, 1))) / 2) * width;
  labels.push({
    id: "fest",
    text: `Fest ${fmtDay(EVENT_START).split(" ")[0]}–${fmtDay(EVENT_END)}`,
    tone: "fest",
    priority: 1.5,
    w: w("fest"),
    anchors: [
      { row: "top", x: festX },
      { row: "bottom", x: festX },
    ],
  });
  labels.push({ id: "fest-short", text: "Fest", tone: "fest", priority: 1.6, w: w("fest-short"), unless: "fest", anchors: [{ row: "bottom", x: festX }] });
  // Above the track: plan versions.
  for (const v of versions) {
    if (v.date > HISTORY_END) continue;
    const onStart = v.date <= HISTORY_START;
    const id = `v-${v.date}`;
    labels.push({ id, text: v.label, tone: "muted", priority: 2, w: w(id), anchors: [{ row: "top", x: onStart ? 0 : at(v.date), align: onStart ? "start" : "center" }] });
  }

  // Below the track: countdown checkpoints first, then the range ends, then month starts.
  for (const x of checkpoints) {
    const id = `t-${x}`;
    labels.push({ id, text: `T-${x}`, tone: "strong", priority: 1, w: w(id), anchors: [{ row: "bottom", x: at(checkpointDate(x)) }] });
  }
  labels.push({ id: "start", text: fmtDay(HISTORY_START), tone: "muted", priority: 2, w: w("start"), anchors: [{ row: "bottom", x: 0, align: "start" }] });
  labels.push({ id: "end", text: fmtDay(HISTORY_END), tone: "muted", priority: 2, w: w("end"), anchors: [{ row: "bottom", x: width, align: "end" }] });
  for (const m of MONTH_STARTS) {
    const id = `m-${m}`;
    labels.push({ id, text: fmtMonth(m), tone: "muted", priority: 3, w: w(id), anchors: [{ row: "bottom", x: at(m) }] });
  }
  return labels;
}

export default function Timeline({
  date,
  onChange,
  pending,
  range,
}: {
  date: string;
  onChange: (d: string) => void;
  pending?: boolean;
  /** The active dataset's dates: the track spans them, so it follows every import. */
  range: DataRange;
}) {
  const tl = useMemo(
    () => createTimeline(range),
    [range.start, range.end, range.eventStart, range.eventEnd],
  );
  const { HISTORY_START, HISTORY_END, EVENT_START, EVENT_END, SLOTS, JUMPS, checkpoints, clampDate, centre, slotStart, dateAtFraction, countdownLabel, countdownPhrase, checkpointDate, dayNotes } = tl;
  const [preview, setPreview] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [focusVisible, setFocusVisible] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [width, setWidth] = useState(0);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [pillW, setPillW] = useState(PILL_FALLBACK_W);
  const [tipW, setTipW] = useState(0);
  const [fontsReady, setFontsReady] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);

  const trackRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef(new Map<string, HTMLSpanElement>());
  const draggingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = preview ?? date;

  // Target versions come from the existing tools API (same data the copilot reads); reloaded per dataset.
  useEffect(() => {
    let live = true;
    setVersions([]);
    fetch(`/api/tools?name=get_targets&date=${HISTORY_END}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const all = j?.result?.all_versions as { version: string; effective_at: string }[] | undefined;
        if (live && all?.length) setVersions(all.map((v) => ({ date: v.effective_at.slice(0, 10), label: versionLabel(v.version) })));
      })
      .catch(() => {
        /* no plan markers */
      });
    return () => {
      live = false;
    };
  }, [HISTORY_END, range.datasetId]);

  // Track width drives label collision; webfont swaps change label widths.
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    document.fonts?.ready.then(() => setFontsReady((n) => n + 1)).catch(() => {});
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const next: Record<string, number> = {};
    labelRefs.current.forEach((el, id) => (next[id] = el.offsetWidth));
    setWidths((prev) => (Object.keys(next).length === Object.keys(prev).length && Object.entries(next).every(([k, v]) => prev[k] === v) ? prev : next));
  }, [versions, fontsReady, width > 0]);

  useLayoutEffect(() => {
    if (pillRef.current) setPillW(pillRef.current.offsetWidth);
  }, [shown, fontsReady]);

  // Drop the local preview once the URL has caught up with it.
  useEffect(() => {
    if (preview && preview === date) setPreview(null);
  }, [date, preview]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const commit = (d: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (d !== date) onChange(d);
    else setPreview(null);
  };
  const commitSoon = (d: string) => {
    setPreview(d);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(d), COMMIT_DELAY_MS);
  };

  const dateAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return shown;
    const r = el.getBoundingClientRect();
    return dateAtFraction((clientX - r.left) / r.width);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -7, PageUp: 7 };
    let next: string | null = null;
    if (e.key in step) next = clampDate(addDays(shown, step[e.key]));
    else if (e.key === "Home") next = HISTORY_START;
    else if (e.key === "End") next = HISTORY_END;
    if (!next) return;
    e.preventDefault();
    setHover(null);
    setFocusVisible(true);
    commitSoon(next);
  };

  const sel = centre(shown);
  const evLeft = slotStart(EVENT_START);
  const evWidth = slotStart(addDays(EVENT_END, 1)) - evLeft;
  const tLabel = countdownLabel(shown);
  const pillText = `${fmtFull(shown)} · ${tLabel}`;
  const measured = width > 0 && Object.keys(widths).length > 0;

  // Label layout: the pill owns its span of the top row, then labels by priority.
  const pillLeft = labelLeft(sel * width, pillW, width);
  const labels = buildLabels(tl, versions, widths, width);
  const placed = placeLabels(labels, width, { top: [[pillLeft, pillLeft + pillW]] });

  const markers = versions.filter((v) => v.date >= HISTORY_START && v.date <= HISTORY_END);
  const tipDate = hover ?? (focusVisible ? shown : null);
  const tipNotes = tipDate ? dayNotes(tipDate, versions) : [];
  const tipLeft = tipDate ? labelLeft(centre(tipDate) * width, tipW, width) : 0;
  const motion = dragging ? "" : "transition-[left,width,opacity] duration-(--dur-2) ease-(--ease-out)";

  useLayoutEffect(() => {
    if (tipRef.current) setTipW(tipRef.current.offsetWidth);
  }, [tipDate, tipNotes.length]);

  return (
    <div className="relative z-20 flex h-[68px] shrink-0 items-center bg-card" aria-busy={pending}>
      {/* Lead: the countdown in words; opens the typed-date picker. */}
      <div className="flex w-[196px] shrink-0 items-center pr-4 pl-4 max-sm:w-auto">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Choose the snapshot date. Now ${fmtFull(shown)}, ${tLabel}`}
              className="group/lead flex h-10 items-center gap-2.5 rounded-md pr-2.5 pl-2 text-left transition-colors duration-(--dur-1) hover:bg-accent aria-expanded:bg-accent"
            >
              <span className="grid size-7 place-items-center rounded-md bg-primary/10 text-primary">
                <CalendarDays className="size-4" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="text-[15px] leading-tight font-semibold tracking-[-0.01em] whitespace-nowrap text-foreground tabular">{countdownPhrase(shown)}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-[300px] gap-3 p-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="snapshot-date" className="text-sm font-medium">
                Snapshot date
              </label>
              <Input
                id="snapshot-date"
                type="date"
                className="tabular"
                min={HISTORY_START}
                max={HISTORY_END}
                value={shown}
                onChange={(e) => e.target.value && commit(clampDate(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">Metrics use data up to 23:59 IST on this day.</p>
            </div>
            <div className="flex flex-wrap gap-1">
              {JUMPS.map((j) => (
                <Button
                  key={j.label}
                  variant="outline"
                  size="xs"
                  aria-pressed={shown === j.date}
                  className="tabular ring-1 ring-border"
                  onClick={() => {
                    commit(j.date);
                    setPickerOpen(false);
                  }}
                >
                  {j.label}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="relative h-full min-w-0 flex-1 pr-7 pl-2 max-sm:hidden">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Snapshot date"
          aria-valuemin={0}
          aria-valuemax={SLOTS - 1}
          aria-valuenow={diffDays(HISTORY_START, shown)}
          aria-valuetext={`${fmtFull(shown)}, ${tLabel}`}
          aria-describedby="timeline-help"
          className="group/track relative h-full cursor-pointer touch-none select-none outline-none"
          onKeyDown={onKeyDown}
          onFocus={(e) => setFocusVisible(e.currentTarget.matches(":focus-visible"))}
          onBlur={() => setFocusVisible(false)}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            draggingRef.current = true;
            setDragging(true);
            setFocusVisible(false);
            e.currentTarget.setPointerCapture(e.pointerId);
            const d = dateAt(e.clientX);
            setPreview(d);
            setHover(d);
          }}
          onPointerMove={(e) => {
            const d = dateAt(e.clientX);
            if (draggingRef.current) setPreview(d);
            if (e.pointerType === "mouse" || draggingRef.current) setHover(d);
          }}
          onPointerLeave={() => {
            if (!draggingRef.current) setHover(null);
          }}
          onPointerUp={(e) => {
            if (!draggingRef.current) return;
            draggingRef.current = false;
            setDragging(false);
            if (e.pointerType !== "mouse") setHover(null);
            commit(dateAt(e.clientX));
          }}
          onPointerCancel={() => {
            draggingRef.current = false;
            setDragging(false);
            setHover(null);
            setPreview(null);
          }}
        >
          <span id="timeline-help" className="sr-only">
            Left and right arrow keys move one day, Page up and Page down move a week. Data is as of 23:59 IST on the chosen day.
          </span>

          {/* Fest days: a soft orange column behind the track. */}
          <div
            aria-hidden
            className="absolute rounded-[4px] bg-event-shade"
            style={{ left: pct(evLeft), width: pct(evWidth), top: TRACK_Y - 10, height: 20 }}
          />

          {/* Track: neutral, violet up to the snapshot, the fest days in orange. */}
          <div aria-hidden className="absolute inset-x-0 h-1.5 overflow-hidden rounded-full bg-muted" style={{ top: TRACK_Y - 3 }}>
            <div className={`absolute inset-y-0 left-0 rounded-r-full bg-primary ${motion}`} style={{ width: pct(sel) }} />
            {/* Countdown checkpoints notch the track into phases. */}
            {checkpoints.map((x) => (
              <div key={x} className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-card" style={{ left: pct(centre(checkpointDate(x))) }} />
            ))}
          </div>
          {/* The fest days stand slightly proud of the track. */}
          <div
            aria-hidden
            className="absolute h-2.5 rounded-[3px] bg-highlight ring-2 ring-card"
            style={{ left: pct(evLeft), width: pct(evWidth), top: TRACK_Y - 5 }}
          />

          {/* Plan versions: small diamonds on the track. */}
          {markers.map((v) => (
            <div
              key={v.date}
              aria-hidden
              className="absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border-[1.5px] border-foreground bg-card"
              style={{ left: v.date <= HISTORY_START ? 4.5 : pct(centre(v.date)), top: TRACK_Y }}
            />
          ))}

          {/* Milestone labels, above and below the track. */}
          {labels.map((l) => {
            const p = placed[l.id];
            const show = measured && p?.visible;
            return (
              <span
                key={l.id}
                ref={(el) => {
                  if (el) labelRefs.current.set(l.id, el);
                  else labelRefs.current.delete(l.id);
                }}
                aria-hidden
                className={`pointer-events-none absolute flex items-center gap-1.5 text-xs leading-[18px] whitespace-nowrap tabular transition-opacity duration-(--dur-2) ${
                  l.tone === "muted" ? "text-muted-foreground" : l.tone === "fest" ? "font-semibold text-highlight-ink" : "font-semibold text-foreground"
                } ${show ? "opacity-100" : "opacity-0"}`}
                style={{ left: p?.left ?? 0, top: (p?.row ?? l.anchors[0].row) === "top" ? 5 : TRACK_Y + 11 }}
              >
                {l.tone === "fest" && <span className="size-1.5 rounded-full bg-highlight" />}
                {l.text}
              </span>
            );
          })}

          {/* Hovered day: a ghost dot on the track. */}
          {hover && hover !== shown && (
            <div
              aria-hidden
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/25"
              style={{ left: pct(centre(hover)), top: TRACK_Y }}
            />
          )}

          {/* The snapshot: pill above, round handle on the track. */}
          <div
            ref={pillRef}
            aria-hidden
            className={`pointer-events-none absolute flex h-[22px] items-center rounded-full bg-primary px-2.5 text-xs leading-none font-semibold whitespace-nowrap text-primary-foreground shadow-sm tabular ${motion} ${pending ? "opacity-80" : ""}`}
            style={{ top: 3, left: width ? pillLeft : `calc(${pct(sel)} - ${PILL_FALLBACK_W / 2}px)` }}
          >
            {fmtFull(shown)}
            <span className="mx-1.5 opacity-60">·</span>
            {tLabel}
          </div>
          <div
            aria-hidden
            className={`pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-primary bg-card shadow-sm ${motion} group-hover/track:ring-4 group-hover/track:ring-primary/15 group-focus-visible/track:ring-2 group-focus-visible/track:ring-ring group-focus-visible/track:ring-offset-2 group-focus-visible/track:ring-offset-card ${
              dragging ? "ring-4 ring-primary/20" : ""
            }`}
            style={{ left: pct(sel), top: TRACK_Y }}
          />

          {/* Tooltip for the hovered (or keyboard-focused) day. */}
          {tipDate && measured && (
            <div
              ref={tipRef}
              role="presentation"
              className="pointer-events-none absolute z-30 flex flex-col gap-0.5 rounded-md bg-foreground px-2.5 py-1.5 text-xs whitespace-nowrap text-background shadow-md"
              style={{ left: tipLeft, top: TRACK_Y + 30, opacity: tipW ? 1 : 0 }}
            >
              <span className="font-medium tabular">
                {fmtWeekday(tipDate)} · {countdownLabel(tipDate)}
              </span>
              {tipNotes.length > 0 && <span className="opacity-75">{tipNotes.join(" · ")}</span>}
              {tipDate === shown && <span className="opacity-75">Snapshot: data as of 23:59 IST</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
