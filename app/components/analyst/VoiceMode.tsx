"use client";

import { AlertCircle, Loader2, MessageSquare, Mic, MicOff, PhoneOff, RotateCw, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useShell } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { useRealtimeVoice, type VoiceEntry, type VoiceStatus } from "@/hooks/use-realtime-voice";
import { formatCountdown } from "@/lib/voice";
import { cn } from "@/lib/utils";
import { ConfirmCard } from "./ConfirmCard";
import { SUGGESTIONS } from "./suggestions";
import { ToolCalls } from "./ToolCalls";
import type { Card, Trace } from "./types";

const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: "Ready",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Checking the data",
  speaking: "Speaking",
  reconnecting: "Reconnecting",
  lost: "Connection lost",
  ended: "Session ended",
  error: "Could not start the session",
};

const LIVE: VoiceStatus[] = ["listening", "thinking", "speaking"];

/** Consecutive finished tool calls render as one ToolCalls block, like the chat view. */
type Row = { kind: "tools"; id: string; traces: Trace[] } | Exclude<VoiceEntry, { kind: "tool" }> | { kind: "pending-tool"; id: string; trace: Trace };

function groupRows(entries: VoiceEntry[]): Row[] {
  const out: Row[] = [];
  for (const e of entries) {
    if (e.kind !== "tool") {
      out.push(e);
      continue;
    }
    if (e.pending) {
      out.push({ kind: "pending-tool", id: e.id, trace: e.trace });
      continue;
    }
    const last = out[out.length - 1];
    if (last?.kind === "tools") last.traces.push(e.trace);
    else out.push({ kind: "tools", id: e.id, traces: [e.trace] });
  }
  return out;
}

function compactArgs(args: unknown) {
  if (!args || typeof args !== "object") return "";
  return Object.entries(args as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
}

/** The call indicator: a mic disc whose halo follows the mic level (--level, set by the hook). */
function Indicator({ status, muted, meterRef }: { status: VoiceStatus; muted: boolean; meterRef: React.RefObject<HTMLDivElement | null> }) {
  const live = LIVE.includes(status);
  const busy = status === "connecting" || status === "reconnecting";
  return (
    <div className="relative grid size-16 place-items-center" aria-hidden>
      <div
        ref={meterRef}
        className={cn(
          "absolute inset-0 rounded-full bg-primary/12 transition-transform duration-100 ease-out [--level:0]",
          status === "speaking" && "motion-safe:animate-pulse",
          !live && "opacity-0",
        )}
        style={{ transform: status === "listening" && !muted ? "scale(calc(1 + var(--level) * 0.35))" : "scale(1)" }}
      />
      <div className={cn("relative grid size-12 place-items-center rounded-full", live ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
        {busy ? (
          <Loader2 className="size-5 animate-spin" strokeWidth={1.75} />
        ) : muted && live ? (
          <MicOff className="size-5" strokeWidth={1.75} />
        ) : (
          <Mic className="size-5" strokeWidth={1.75} />
        )}
      </div>
    </div>
  );
}

/**
 * Voice mode for the analyst panel: a live speech-to-speech call with the same tools, grounding
 * check and confirm cards as chat. The call ends on hangup, on unmount (back to chat, panel
 * closed), on a route or snapshot-date change, and at the 5-minute cap.
 */
export function VoiceMode({ date, onBack }: { date: string; onBack: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { withDate } = useShell();
  const meterRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const v = useRealtimeVoice({ date, meterRef });
  const { start, stop } = v;

  // Entering voice mode is the request to talk: start the call right away.
  useEffect(() => {
    start();
  }, [start]);

  // Navigating away or changing the snapshot date ends the call (the session was set up for it).
  const first = useRef({ pathname, date });
  useEffect(() => {
    if (pathname !== first.current.pathname) {
      first.current.pathname = pathname;
      stop("The session ended because you opened another page.");
    }
  }, [pathname, stop]);
  useEffect(() => {
    if (date !== first.current.date) {
      first.current.date = date;
      stop("The snapshot date changed, so the session ended. Start a new voice session to use the new date.");
    }
  }, [date, stop]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [v.entries, v.status]);

  const live = LIVE.includes(v.status);
  const busy = v.status === "connecting" || v.status === "reconnecting";
  const rows = groupRows(v.entries);
  const lastPending = [...v.entries].reverse().find((e) => e.kind === "card" && e.card.state === "pending")?.id;

  const resolve = async (entryId: string, messageId: string, index: number, card: Card, action: "confirm" | "dismiss") => {
    try {
      const r = await fetch("/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, index, action }),
      });
      const j = await r.json();
      if (j.error) {
        toast.error(action === "confirm" ? "Could not apply the draft" : "Could not dismiss the draft", { description: j.error });
        return;
      }
      v.updateCard(entryId, j as Card);
      if (action === "confirm") {
        const isTask = card.kind === "task";
        const href = withDate(isTask ? "/tasks" : "/campaigns");
        toast.success(isTask ? "Task created" : "Campaign updated", {
          description: isTask ? String((j.result as { title?: string } | undefined)?.title ?? "") || undefined : undefined,
          action: { label: isTask ? "Open tasks" : "Open campaigns", onClick: () => router.push(href) },
        });
        router.refresh();
      }
    } catch (e) {
      toast.error("Could not reach the server", { description: (e as Error).message });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_12px)]" aria-live="polite">
        <div className="space-y-5 px-4 py-4">
          {rows.length === 0 && !v.error && (
            <p className="pt-6 text-center text-sm text-foreground">
              {live
                ? "Ask about pace, campaigns or tasks. I'm listening."
                : v.micPending
                  ? "Allow the microphone if your browser asks."
                  : busy
                    ? "Setting up the session."
                    : "Start a voice session to talk to the analyst."}
            </p>
          )}
          {rows.map((r) => {
            switch (r.kind) {
              case "user":
                return (
                  <div key={r.id} className="flex justify-end">
                    <div className={cn("max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm break-words whitespace-pre-wrap text-foreground", !r.final && "text-muted-foreground")}>
                      {r.text || "…"}
                    </div>
                  </div>
                );
              case "assistant":
                return (
                  <div key={r.id}>
                    <p className={cn("text-sm leading-relaxed break-words whitespace-pre-wrap", r.interrupted ? "text-muted-foreground" : "text-foreground")}>{r.text || "…"}</p>
                    {r.interrupted && <p className="mt-1 text-xs text-muted-foreground">Interrupted</p>}
                    {r.ungrounded?.length ? (
                      <p className="mt-1.5 text-xs text-muted-foreground">Some figures could not be checked against the data: {r.ungrounded.join(", ")}</p>
                    ) : null}
                  </div>
                );
              case "tools":
                return <ToolCalls key={r.id} tools={r.traces} />;
              case "pending-tool":
                return (
                  <div key={r.id} className="flex items-center gap-1.5 py-0.5 font-mono text-[11px] text-muted-foreground/80">
                    <Loader2 className="size-3.5 shrink-0 animate-spin" strokeWidth={1.75} aria-hidden />
                    <span className="shrink-0">{r.trace.name}</span>
                    <span className="min-w-0 truncate">({compactArgs(r.trace.args)})</span>
                  </div>
                );
              case "card":
                return (
                  <ConfirmCard
                    key={r.id}
                    card={r.card}
                    primary={lastPending === r.id}
                    onResolve={(a) => resolve(r.id, r.messageId, r.index, r.card, a)}
                    tasksHref={withDate("/tasks")}
                    campaignsHref={withDate("/campaigns")}
                  />
                );
              case "notice":
                return (
                  <p key={r.id} className="text-[13px] text-muted-foreground">
                    {r.text}
                  </p>
                );
            }
          })}
          {v.error && (
            <div className="flex items-start gap-2 text-[13px] text-foreground" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              <span className="min-w-0 flex-1 break-words">{v.error}</span>
              <button
                type="button"
                onClick={v.clearError}
                aria-label="Dismiss the error"
                className="shrink-0 rounded-sm text-muted-foreground transition-colors duration-(--dur-1) hover:text-foreground"
              >
                <X className="size-4" strokeWidth={1.5} aria-hidden />
              </button>
            </div>
          )}
        </div>
      </div>

      {live && (
        <ul className="flex shrink-0 flex-wrap gap-1.5 px-4 pt-2" aria-label="Suggested questions">
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button
                type="button"
                disabled={!live}
                onClick={() => v.sendText(s)}
                className="rounded-full bg-muted px-3 py-1.5 text-left text-[13px] text-foreground transition-colors duration-(--dur-1) hover:bg-primary-tint hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="shrink-0 px-4 pt-3 pb-4">
        <div className="flex items-center gap-3">
          <Indicator status={v.status} muted={v.muted} meterRef={meterRef} />
          <div className="min-w-0 flex-1" role="status" aria-live="polite">
            <div className="text-sm font-medium text-foreground">
              {v.muted && live ? "Muted" : v.status === "thinking" && !v.entries.some((e) => e.kind === "tool" && e.pending) ? "Thinking" : STATUS_LABEL[v.status]}
            </div>
            {(live || v.status === "reconnecting") && (
              <div className="text-xs text-muted-foreground tabular" aria-label={`${formatCountdown(v.remainingMs)} left in this session`}>
                {formatCountdown(v.remainingMs)} left
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {live || busy ? (
            <>
              <Button variant="ghost" className="rounded-full bg-muted px-3.5 text-foreground" onClick={v.toggleMute} disabled={!live} aria-pressed={v.muted}>
                {v.muted ? <MicOff strokeWidth={1.75} aria-hidden /> : <Mic strokeWidth={1.75} aria-hidden />}
                {v.muted ? "Unmute" : "Mute"}
              </Button>
              <Button variant="ink" className="rounded-full px-3.5" onClick={v.hangup}>
                <PhoneOff strokeWidth={1.75} aria-hidden />
                End session
              </Button>
            </>
          ) : v.status === "lost" ? (
            <>
              <Button className="rounded-full px-3.5" onClick={v.reconnect}>
                <RotateCw strokeWidth={1.75} aria-hidden />
                Reconnect session
              </Button>
              <Button variant="ghost" className="rounded-full px-3.5" onClick={v.hangup}>
                <PhoneOff strokeWidth={1.75} aria-hidden />
                End session
              </Button>
            </>
          ) : (
            <Button className="rounded-full px-3.5" onClick={start}>
              <Mic strokeWidth={1.75} aria-hidden />
              Start voice session
            </Button>
          )}
          <Button variant="ghost" className="ml-auto rounded-full px-3" onClick={onBack}>
            <MessageSquare strokeWidth={1.75} aria-hidden />
            Back to chat
          </Button>
        </div>
      </div>
    </div>
  );
}
