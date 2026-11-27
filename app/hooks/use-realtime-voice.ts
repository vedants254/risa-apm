"use client";

/**
 * Browser side of voice mode: microphone, WebRTC peer connection and data channel to the OpenAI
 * Realtime API, and the event loop that runs the model's function calls through this app.
 *
 * Connection (https://developers.openai.com/api/docs/guides/realtime-webrtc):
 *   1. POST /api/voice/session            -> { client_secret: "ek_...", ... }  (our server)
 *   2. RTCPeerConnection + mic track + data channel "oai-events", createOffer
 *   3. POST https://api.openai.com/v1/realtime/calls  (Bearer ek_..., Content-Type application/sdp)
 *      -> SDP answer, setRemoteDescription
 * Function calls (https://developers.openai.com/api/docs/guides/realtime-mcp, function tools):
 *   response.done with output[].type === "function_call" -> POST /api/tools for each call ->
 *   conversation.item.create { type: "function_call_output", call_id, output } for each ->
 *   one response.create.
 *
 * Every async step checks a generation number, so a hangup, reconnect or unmount drops late
 * results instead of acting on a dead connection. Nothing calls setState after unmount.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Card, Trace } from "@/components/analyst/types";
import { findUngroundedNumbers } from "@/lib/grounding";
import {
  HttpError,
  PROPOSAL_TOOLS,
  TOOL_CAP_INSTRUCTIONS,
  TOOL_CAP_OUTPUT,
  USAGE_LIMIT_MESSAGE,
  VOICE_MAX_SESSION_MS,
  VOICE_TOOL_TIMEOUT_MS,
  apiToolRunner,
  greetingInstructions,
  functionOutputEvents,
  isRetryable,
  isUsageLimitError,
  runToolCalls,
  systemMessageEvent,
  VoiceTurns,
  withRetry,
  type FunctionCallItem,
  type ToolRunResult,
} from "@/lib/voice";

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
/** Give up on a handshake (SDP answer applied but data channel never opens) after this long. */
const CONNECT_TIMEOUT_MS = 15_000;
/** ICE "disconnected" often recovers by itself; treat it as lost only if it lasts this long. */
const DISCONNECT_GRACE_MS = 5_000;
const MAX_AUTO_RECONNECTS = 2;

export type VoiceStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "reconnecting" | "lost" | "ended" | "error";

export type VoiceEntry =
  | { kind: "user"; id: string; text: string; final: boolean }
  | { kind: "assistant"; id: string; text: string; final: boolean; ungrounded?: string[]; interrupted?: boolean }
  | { kind: "tool"; id: string; trace: Trace; pending: boolean }
  | { kind: "card"; id: string; messageId: string; index: number; card: Card }
  | { kind: "notice"; id: string; text: string };

interface Conn {
  gen: number;
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  stream: MediaStream;
  audio: HTMLAudioElement;
  abort: AbortController;
  timers: Set<ReturnType<typeof setTimeout>>;
  audioCtx?: AudioContext;
  raf?: number;
  closed: boolean;
  /** Turn / response bookkeeping: one response at a time, superseded turns never answered. */
  turns: VoiceTurns;
}

/** Earlier text-chat turns (active dataset) returned by /api/voice/session to seed the session. */
export interface SeedTurn {
  role: "user" | "assistant";
  text: string;
}

function micErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError")
    return "Microphone access is blocked. Allow the microphone for this site in the browser's address bar, then try again.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError")
    return "No microphone was found. Connect one and try again, or use chat.";
  if (name === "NotReadableError" || name === "TrackStartError") return "The microphone is in use by another app. Close it and try again.";
  return `Could not open the microphone: ${(e as Error)?.message ?? "unknown error"}`;
}

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function useRealtimeVoice({ date, meterRef }: { date: string; meterRef?: React.RefObject<HTMLElement | null> }) {
  const [status, setStatusState] = useState<VoiceStatus>("idle");
  const [entries, setEntriesState] = useState<VoiceEntry[]>([]);
  const [error, setErrorState] = useState<string | null>(null);
  const [remainingMs, setRemainingState] = useState(VOICE_MAX_SESSION_MS);
  const [muted, setMutedState] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  /** True while the browser is asking for (or opening) the microphone. */
  const [micPending, setMicPending] = useState(false);

  const mounted = useRef(false);
  const genRef = useRef(0);
  const connRef = useRef<Conn | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoReconnects = useRef(0);
  const evidence = useRef<string[]>([]);
  const userText = useRef<string[]>([]);
  const toolsInFlight = useRef(0);
  const statusRef = useRef<VoiceStatus>("idle");
  const dateRef = useRef(date);
  const mutedRef = useRef(false);
  const entriesRef = useRef<VoiceEntry[]>([]);
  const limitNoticeShown = useRef(false);
  /** Set when a fresh session connects; the spoken introduction is sent once the session is ready. */
  const greetPending = useRef(false);
  const eventName = useRef<string | null>(null);
  const seed = useRef<SeedTurn[]>([]);
  useEffect(() => {
    dateRef.current = date;
  }, [date]);

  // Guarded setters: a late event or fetch after unmount is a no-op.
  const setStatus = useCallback((s: VoiceStatus) => {
    statusRef.current = s;
    if (mounted.current) setStatusState(s);
  }, []);
  const setError = useCallback((e: string | null) => {
    if (mounted.current) setErrorState(e);
  }, []);
  const setEntries = useCallback((fn: (prev: VoiceEntry[]) => VoiceEntry[]) => {
    entriesRef.current = fn(entriesRef.current);
    if (mounted.current) setEntriesState(entriesRef.current);
  }, []);
  const notice = useCallback((text: string) => setEntries((p) => [...p, { kind: "notice", id: uid("n"), text }]), [setEntries]);

  const stopCountdown = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
  };

  /** Close one connection completely: timers, fetches, meter, data channel, peer, mic, audio. */
  const teardown = useCallback((c: Conn | null) => {
    if (!c || c.closed) return;
    c.closed = true;
    c.abort.abort();
    c.timers.forEach((t) => clearTimeout(t));
    c.timers.clear();
    if (c.raf !== undefined) cancelAnimationFrame(c.raf);
    c.audioCtx?.close().catch(() => {});
    try {
      c.dc.close();
    } catch {
      /* already closed */
    }
    c.pc.getSenders().forEach((s) => s.track?.stop());
    try {
      c.pc.close();
    } catch {
      /* already closed */
    }
    c.stream.getTracks().forEach((t) => t.stop());
    c.audio.pause();
    c.audio.srcObject = null;
    c.audio.remove();
    if (connRef.current === c) connRef.current = null;
  }, []);

  /** End the call. `reason` adds a visible notice (time limit, date change, error). */
  const stop = useCallback(
    (reason?: string, next: VoiceStatus = "ended") => {
      genRef.current++;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
      stopCountdown();
      teardown(connRef.current);
      toolsInFlight.current = 0;
      deadlineRef.current = null;
      if (meterRef?.current) meterRef.current.style.setProperty("--level", "0");
      if (reason) notice(reason);
      if (statusRef.current !== "idle" || next !== "ended") setStatus(next);
    },
    [meterRef, notice, setStatus, teardown],
  );

  const send = (c: Conn, event: unknown): boolean => {
    if (c.closed || c.dc.readyState !== "open") return false;
    try {
      c.dc.send(JSON.stringify(event));
      return true;
    } catch {
      return false;
    }
  };

  // ---- transcript helpers ---------------------------------------------------------------
  const upsertText = useCallback(
    (kind: "user" | "assistant", id: string, update: (prev: string) => string, final: boolean, extra?: { ungrounded?: string[] }) =>
      setEntries((p) => {
        const i = p.findIndex((e) => e.kind === kind && e.id === id);
        if (i < 0) return [...p, { kind, id, text: update(""), final, ...(extra ?? {}) } as VoiceEntry];
        const cur = p[i] as Extract<VoiceEntry, { kind: "user" | "assistant" }>;
        const nextE = { ...cur, text: update(cur.text), final: final || cur.final, ...(extra ?? {}) } as VoiceEntry;
        return [...p.slice(0, i), nextE, ...p.slice(i + 1)];
      }),
    [setEntries],
  );

  const failFatal = useCallback(
    (message: string) => {
      setError(message);
      stop(undefined, "error");
    },
    [setError, stop],
  );

  // ---- function calls ---------------------------------------------------------------------
  const handleToolCalls = useCallback(
    async (c: Conn, done: { turn: number; status: string; calls: FunctionCallItem[]; current: boolean }) => {
      const { calls, turn } = done;
      if (!calls.length) return;
      // The cap counts rounds of the latest turn; a superseded turn's calls still get outputs.
      const round = done.current ? c.turns.guard.next() : { allowed: true, round: 0 };
      if (!round.allowed) {
        // Cap reached: answer every call with an error, then one closing response without tools.
        functionOutputEvents(calls.map((call) => ({ call, output: JSON.stringify(TOOL_CAP_OUTPUT) }))).forEach((ev) => send(c, ev));
        notice(`Stopped after ${c.turns.guard.max} rounds of data lookups for one question. Try a narrower question.`);
        send(c, systemMessageEvent(TOOL_CAP_INSTRUCTIONS));
        c.turns.requestResponse(turn, { tool_choice: "none" });
        return;
      }
      const ids = calls.map(() => uid("t"));
      setEntries((p) => [
        ...p,
        ...calls.map((call, i) => {
          let args: unknown = {};
          try {
            args = call.arguments ? JSON.parse(call.arguments) : {};
          } catch {
            args = { raw: call.arguments };
          }
          return { kind: "tool" as const, id: ids[i], pending: true, trace: { name: call.name, args, ok: true } };
        }),
      ]);
      if (done.current) setStatus("thinking");
      toolsInFlight.current++;
      const runner = apiToolRunner("", dateRef.current);
      let results: ToolRunResult[];
      try {
        results = await runToolCalls(calls, runner, { timeoutMs: VOICE_TOOL_TIMEOUT_MS, signal: c.abort.signal });
      } finally {
        toolsInFlight.current = Math.max(0, toolsInFlight.current - 1);
      }
      if (c.closed || c.gen !== genRef.current) return;

      // Drafts: record them server-side so the confirm endpoint can resolve the card.
      for (const r of results) {
        if (!r.ok || !PROPOSAL_TOOLS.has(r.call.name) || !r.proposal) continue;
        try {
          const res = await fetch("/api/voice/proposal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: r.call.name, args: r.args, date: dateRef.current }),
            signal: typeof AbortSignal.any === "function" ? AbortSignal.any([c.abort.signal, AbortSignal.timeout(VOICE_TOOL_TIMEOUT_MS)]) : c.abort.signal,
          });
          const j = await res.json();
          if (!res.ok || j.error) throw new Error(j.error ?? `HTTP ${res.status}`);
          if (c.closed) return;
          setEntries((p) => [...p, { kind: "card", id: uid("c"), messageId: j.message_id, index: j.index ?? 0, card: j.card as Card }]);
        } catch (e) {
          if (c.closed) return;
          const msg = `The draft could not be shown on screen: ${(e as Error).message}`;
          r.ok = false;
          r.error = msg;
          r.output = JSON.stringify({ error: `${msg} Tell the user the draft could not be created and nothing was changed.` });
        }
      }

      results.forEach((r, i) => {
        evidence.current.push(r.output);
        const trace: Trace = { name: r.call.name, args: r.args, ok: r.ok, error: r.error, preview: r.output.slice(0, 600) };
        setEntries((p) => p.map((e) => (e.kind === "tool" && e.id === ids[i] ? { ...e, pending: false, trace } : e)));
      });

      // Always append the outputs: the conversation stays complete, and a newer turn can reuse
      // the data. Only the latest turn gets a spoken follow-up (VoiceTurns skips superseded turns
      // and waits for any running response to finish first).
      functionOutputEvents(results).forEach((ev) => send(c, ev));
      if (done.status !== "failed") c.turns.requestResponse(turn);
      if (!c.turns.busy && statusRef.current === "thinking" && !toolsInFlight.current) setStatus("listening");
    },
    [notice, setEntries, setStatus],
  );

  /** Mark the answer in progress as interrupted (its unplayed audio is cut, its text kept). */
  const markInterrupted = useCallback(() => {
    setEntries((p) => {
      for (let i = p.length - 1; i >= 0; i--) {
        const e = p[i];
        if (e.kind === "user") break;
        if (e.kind === "assistant" && (!e.final || statusRef.current === "speaking")) {
          return [...p.slice(0, i), { ...e, interrupted: true, final: true }, ...p.slice(i + 1)];
        }
      }
      return p;
    });
  }, [setEntries]);

  /** The model introduces itself first (fresh sessions only, once). Server VAD then listens. */
  const greet = useCallback((c: Conn) => {
    if (!greetPending.current || c.closed || c.gen !== genRef.current) return;
    greetPending.current = false;
    // Earlier text chat for this dataset, so a switch from chat to voice keeps its context.
    if (seed.current.length) {
      const lines = seed.current.map((t) => `${t.role === "user" ? "User" : "Analyst"}: ${t.text}`).join("\n");
      send(c, systemMessageEvent(`Earlier text chat with this user in the same workspace (context for follow-ups; do not repeat or summarise it unless asked):\n${lines}`));
    }
    c.turns.requestResponse(c.turns.turn, { instructions: greetingInstructions(eventName.current), tool_choice: "none" });
  }, []);

  // ---- server events ----------------------------------------------------------------------
  const onEvent = useCallback(
    (c: Conn, ev: Record<string, unknown> & { type?: string }) => {
      if (c.closed || c.gen !== genRef.current) return;
      switch (ev.type) {
        case "session.created":
          greet(c);
          break;
        case "input_audio_buffer.speech_started":
          // Barge-in: the server cancels the response and cuts unplayed audio (WebRTC); the UI
          // stops showing "Speaking" at once and keeps the cut-off answer, marked interrupted.
          if (statusRef.current === "speaking" || c.turns.busy) markInterrupted();
          setStatus("listening");
          break;
        case "input_audio_buffer.committed": {
          // A new user turn: earlier tool rounds are superseded and the cap resets.
          c.turns.userSpoke();
          upsertText("user", String(ev.item_id), (t) => t, false);
          break;
        }
        case "conversation.item.input_audio_transcription.delta":
          upsertText("user", String(ev.item_id), (t) => t + String(ev.delta ?? ""), false);
          break;
        case "conversation.item.input_audio_transcription.completed": {
          const text = String(ev.transcript ?? "").trim();
          userText.current.push(text);
          upsertText("user", String(ev.item_id), () => text, true);
          break;
        }
        case "conversation.item.input_audio_transcription.failed":
          upsertText("user", String(ev.item_id), (t) => t || "(could not transcribe this part)", true);
          break;
        case "response.created":
          c.turns.responseCreated(String((ev.response as { id?: string } | undefined)?.id ?? ""));
          if (statusRef.current !== "speaking") setStatus("thinking");
          break;
        case "response.output_audio_transcript.delta":
        case "response.output_text.delta":
          upsertText("assistant", String(ev.item_id), (t) => t + String(ev.delta ?? ""), false);
          break;
        case "response.output_audio_transcript.done":
        case "response.output_text.done": {
          const text = String(ev.transcript ?? ev.text ?? "");
          const id = String(ev.item_id);
          const interrupted = entriesRef.current.some((e) => e.kind === "assistant" && e.id === id && e.interrupted);
          // Speech cannot be blocked, so unbacked figures are flagged, not removed. An interrupted
          // answer was not heard in full, so it is not checked.
          const ungrounded = text && !interrupted ? findUngroundedNumbers(text, evidence.current, userText.current.join("\n")) : [];
          upsertText("assistant", id, (t) => text || t, true, { ungrounded });
          break;
        }
        case "output_audio_buffer.started":
          c.turns.audioPlaying = true;
          setStatus("speaking");
          break;
        case "output_audio_buffer.stopped":
        case "output_audio_buffer.cleared":
          c.turns.audioPlaying = false;
          if (statusRef.current === "speaking") setStatus(c.turns.busy || toolsInFlight.current ? "thinking" : "listening");
          break;
        case "response.done": {
          const response = (ev.response ?? {}) as {
            id?: string;
            status?: string;
            status_details?: { error?: { code?: string; type?: string; message?: string } };
            output?: unknown[];
          };
          const done = c.turns.responseDone(response);
          if (response.status === "failed") {
            const err = response.status_details?.error;
            if (isUsageLimitError(err)) return failFatal(USAGE_LIMIT_MESSAGE);
            notice(`The voice analyst could not answer: ${err?.message ?? "the response failed"}.`);
          }
          if (done.calls.length) void handleToolCalls(c, done);
          else if (statusRef.current === "thinking" && !toolsInFlight.current && !c.turns.busy) setStatus("listening");
          break;
        }
        case "rate_limits.updated": {
          const limits = (ev.rate_limits ?? []) as { name?: string; remaining?: number }[];
          if (!limitNoticeShown.current && limits.some((l) => l.remaining === 0)) {
            limitNoticeShown.current = true;
            notice("The voice analyst is close to its usage limit, so answers may stop soon.");
          }
          break;
        }
        case "error": {
          const err = (ev.error ?? {}) as { code?: string; type?: string; message?: string };
          if (isUsageLimitError(err)) return failFatal(USAGE_LIMIT_MESSAGE);
          // Harmless race: a response.create while VAD already started one.
          if (err.code === "conversation_already_has_active_response") return c.turns.createRejected();
          if (err.code === "session_expired") return failFatal("The voice session expired. Start a new voice session.");
          // Most Realtime errors are recoverable and the session stays open.
          notice(`The voice service reported a problem: ${err.message ?? err.code ?? "unknown error"}`);
          break;
        }
      }
    },
    [failFatal, greet, handleToolCalls, markInterrupted, notice, setStatus, upsertText],
  );

  // ---- connect ------------------------------------------------------------------------------
  const startMeter = (c: Conn) => {
    const el = meterRef?.current;
    if (!el || typeof AudioContext === "undefined") return;
    try {
      const ctx = new AudioContext();
      c.audioCtx = ctx;
      const src = ctx.createMediaStreamSource(c.stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      let last = 0;
      const tick = (t: number) => {
        if (c.closed) return;
        if (t - last > 50) {
          last = t;
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += ((v - 128) / 128) ** 2;
          const rms = Math.sqrt(sum / buf.length);
          const level = mutedRef.current ? 0 : Math.min(1, rms * 4);
          meterRef?.current?.style.setProperty("--level", level.toFixed(3));
        }
        c.raf = requestAnimationFrame(tick);
      };
      c.raf = requestAnimationFrame(tick);
    } catch {
      /* the meter is decoration; the call works without it */
    }
  };

  const connect = useCallback(
    async (mode: "fresh" | "reconnect") => {
      const gen = ++genRef.current;
      const alive = () => mounted.current && gen === genRef.current;
      greetPending.current = mode === "fresh";
      setError(null);
      setStatus(mode === "fresh" ? "connecting" : "reconnecting");
      const abort = new AbortController();

      // 1. Microphone.
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        return failFatal("This browser cannot use the microphone here. Voice needs a secure page (HTTPS or localhost) and a browser with microphone support.");
      }
      if (typeof RTCPeerConnection === "undefined") return failFatal("This browser does not support WebRTC, which voice mode needs. Use chat instead.");
      let stream: MediaStream;
      if (mounted.current) setMicPending(true);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (e) {
        if (alive()) failFatal(micErrorMessage(e));
        return;
      } finally {
        if (mounted.current && gen === genRef.current) setMicPending(false);
      }
      if (!alive()) return stream.getTracks().forEach((t) => t.stop());

      const pc = new RTCPeerConnection();
      const audio = document.createElement("audio");
      audio.autoplay = true;
      const dc = pc.createDataChannel("oai-events");
      const c = { gen, pc, dc, stream, audio, abort, timers: new Set(), closed: false } as Conn;
      c.turns = new VoiceTurns((event) => send(c, event), { webrtc: true });
      connRef.current = c;
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !mutedRef.current;
        pc.addTrack(t, stream);
      });
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
        audio.play().catch(() => {});
      };

      const later = (fn: () => void, ms: number) => {
        const t = setTimeout(() => {
          c.timers.delete(t);
          fn();
        }, ms);
        c.timers.add(t);
        return t;
      };

      // A dropped connection mid-call: retry a couple of times, then offer a Reconnect button.
      const dropped = (why: string) => {
        if (c.closed || gen !== genRef.current) return;
        teardown(c);
        const left = (deadlineRef.current ?? Date.now()) - Date.now();
        if (autoReconnects.current < MAX_AUTO_RECONNECTS && left > 10_000) {
          const n = autoReconnects.current++;
          setStatus("reconnecting");
          if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
          reconnectTimer.current = setTimeout(() => {
            reconnectTimer.current = null;
            if (mounted.current && gen === genRef.current) void connect("reconnect");
          }, 1000 * 2 ** n);
          return;
        }
        genRef.current++;
        stopCountdown();
        setError(`Connection lost (${why}).`);
        setStatus("lost");
      };

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === "failed") dropped("the network connection failed");
        else if (s === "disconnected") later(() => pc.connectionState === "disconnected" && dropped("the network dropped"), DISCONNECT_GRACE_MS);
      };
      let opened = false;
      dc.onopen = () => {
        if (c.closed || gen !== genRef.current) return;
        opened = true;
        startMeter(c);
        if (deadlineRef.current === null) deadlineRef.current = Date.now() + VOICE_MAX_SESSION_MS;
        stopCountdown();
        const tick = () => {
          const left = (deadlineRef.current ?? 0) - Date.now();
          if (mounted.current) setRemainingState(Math.max(0, left));
          if (left <= 0) stop("Session limit reached (5 minutes). Start a new voice session to keep going.");
        };
        tick();
        countdownRef.current = setInterval(tick, 500);
        if (mode === "reconnect") {
          // The new session has no memory of the dropped one: give it the recent transcript.
          const recent = entriesRef.current
            .filter((e): e is Extract<VoiceEntry, { kind: "user" | "assistant" }> => (e.kind === "user" || e.kind === "assistant") && e.final && !!e.text)
            .slice(-6)
            .map((e) => `${e.kind === "user" ? "User" : "You"}: ${e.text}`)
            .join("\n");
          if (recent) send(c, systemMessageEvent(`The connection dropped and was restored. Recent conversation for context (do not repeat it):\n${recent}`));
          notice("Reconnected.");
        }
        setStatus("listening");
        // session.created normally triggers the introduction; this covers a missed event.
        later(() => greet(c), 2500);
      };
      dc.onclose = () => dropped("the data channel closed");
      dc.onmessage = (m) => {
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(typeof m.data === "string" ? m.data : "");
        } catch {
          return;
        }
        onEvent(c, ev);
      };

      try {
        // 2. Ephemeral key from our server (retries network errors and 5xx, not 4xx/429).
        const minted = await withRetry(
          async () => {
            const r = await fetch("/api/voice/session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ date: dateRef.current }),
              signal: abort.signal,
              cache: "no-store",
            });
            let j: { client_secret?: string; model?: string; event_name?: string | null; history?: SeedTurn[]; error?: string; code?: string } = {};
            try {
              j = await r.json();
            } catch {
              /* non-JSON */
            }
            if (!r.ok || !j.client_secret) throw new HttpError(j.error ?? `Could not start the voice session (HTTP ${r.status}).`, r.status || 500, j.code);
            return j as { client_secret: string; model?: string; event_name?: string | null; history?: SeedTurn[] };
          },
          // A missing or rejected server key is a 5xx that no retry will fix.
          { retries: 2, retryable: (e) => isRetryable(e) && !(e instanceof HttpError && (e.code === "missing_key" || e.code === "auth")), signal: abort.signal },
        );
        if (!alive() || c.closed) return teardown(c);
        if (mounted.current) setModel(minted.model ?? null);
        eventName.current = minted.event_name ?? null;
        if (mode === "fresh") {
          seed.current = Array.isArray(minted.history) ? minted.history : [];
          // The user's own earlier words also back figures they quote back (grounding check).
          userText.current.push(...seed.current.filter((t) => t.role === "user").map((t) => t.text));
        } else seed.current = [];

        // 3. SDP offer/answer with OpenAI, authenticated by the ephemeral key.
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const answer = await withRetry(
          async () => {
            const r = await fetch(REALTIME_CALLS_URL, {
              method: "POST",
              body: offer.sdp,
              headers: { Authorization: `Bearer ${minted.client_secret}`, "Content-Type": "application/sdp" },
              signal: abort.signal,
            });
            const text = await r.text();
            if (!r.ok) {
              let msg = text.slice(0, 200);
              let code: string | undefined;
              try {
                const j = JSON.parse(text) as { error?: { message?: string; code?: string; type?: string } };
                msg = j.error?.message ?? msg;
                code = j.error?.code ?? j.error?.type;
                if (isUsageLimitError({ ...j.error, status: r.status })) throw new HttpError(USAGE_LIMIT_MESSAGE, 429, "usage_limit");
              } catch (e) {
                if (e instanceof HttpError) throw e;
              }
              if (r.status === 429) throw new HttpError(USAGE_LIMIT_MESSAGE, 429, "usage_limit");
              throw new HttpError(`OpenAI did not accept the voice session (HTTP ${r.status}): ${msg}`, r.status, code);
            }
            return text;
          },
          { retries: 2, retryable: isRetryable, signal: abort.signal },
        );
        if (!alive() || c.closed) return teardown(c);
        await pc.setRemoteDescription({ type: "answer", sdp: answer });
        later(() => {
          if (!opened && !c.closed && gen === genRef.current) {
            if (mode === "reconnect") dropped("the connection could not be restored");
            else failFatal("Could not connect to the voice service in time. Check your network and try again.");
          }
        }, CONNECT_TIMEOUT_MS);
      } catch (e) {
        if (!alive() || (e instanceof DOMException && e.name === "AbortError")) return teardown(c);
        teardown(c);
        const msg = e instanceof HttpError ? e.message : `Could not connect the voice session: ${(e as Error).message}`;
        if (mode === "reconnect" && isRetryable(e)) {
          genRef.current++;
          stopCountdown();
          setError(`Connection lost (${msg}).`);
          setStatus("lost");
          return;
        }
        failFatal(msg);
      }
    },
    // startMeter only reads refs, so it is not a dependency.
    [failFatal, greet, notice, onEvent, setError, setStatus, stop, teardown],
  );

  const start = useCallback(() => {
    const s = statusRef.current;
    if (s === "connecting" || s === "reconnecting" || s === "listening" || s === "thinking" || s === "speaking") return;
    // A fresh call: new transcript, new evidence, full 5 minutes.
    entriesRef.current = [];
    setEntries(() => []);
    evidence.current = [];
    userText.current = [];
    deadlineRef.current = null;
    autoReconnects.current = 0;
    limitNoticeShown.current = false;
    setRemainingState(VOICE_MAX_SESSION_MS);
    void connect("fresh");
  }, [connect, setEntries]);

  /** Manual reconnect after "Connection lost": keeps the transcript and the remaining time. */
  const reconnect = useCallback(() => {
    if (statusRef.current !== "lost") return;
    if (deadlineRef.current !== null && deadlineRef.current - Date.now() <= 0) return stop("Session limit reached (5 minutes). Start a new voice session to keep going.");
    autoReconnects.current = MAX_AUTO_RECONNECTS; // a manual retry does not restart the automatic ones
    void connect("reconnect");
  }, [connect, stop]);

  const hangup = useCallback(() => stop(), [stop]);

  /**
   * A tapped starter question, sent as user text into the live session and answered aloud. It
   * interrupts an answer in progress (response.cancel, then output_audio_buffer.clear if audio is
   * playing); the earlier request stays in the conversation for the model to weigh.
   */
  const sendText = useCallback(
    (text: string): boolean => {
      const c = connRef.current;
      const t = text.trim();
      const s = statusRef.current;
      if (!c || c.closed || !t || !(s === "listening" || s === "thinking" || s === "speaking") || c.dc.readyState !== "open") return false;
      if (s === "speaking" || c.turns.busy) markInterrupted();
      c.turns.userText(t);
      userText.current.push(t);
      setEntries((p) => [...p, { kind: "user", id: uid("u"), text: t, final: true }]);
      setStatus("thinking");
      return true;
    },
    [markInterrupted, setEntries, setStatus],
  );

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    connRef.current?.stream.getAudioTracks().forEach((t) => (t.enabled = !mutedRef.current));
    if (mounted.current) setMutedState(mutedRef.current);
  }, []);

  /** Update a card after the user confirmed or dismissed it; tell the model what happened. */
  const updateCard = useCallback(
    (id: string, card: Card) => {
      setEntries((p) => p.map((e) => (e.kind === "card" && e.id === id ? { ...e, card } : e)));
      const c = connRef.current;
      if (c && card.state !== "pending") send(c, systemMessageEvent(`[Card "${card.summary}": ${card.state} by the user${card.result ? `; result ${JSON.stringify(card.result)}` : ""}]`));
    },
    [setEntries],
  );

  useEffect(() => {
    mounted.current = true;
    const onHide = () => stop();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      // Unmount (panel closed, back to chat, route change): release everything, no setState.
      mounted.current = false;
      genRef.current++;
      // So a remount (React Strict Mode runs effects twice in dev) can start a fresh call.
      statusRef.current = "idle";
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      stopCountdown();
      teardown(connRef.current);
    };
  }, [stop, teardown]);

  return { status, entries, error, remainingMs, muted, model, micPending: micPending && status === "connecting", start, hangup, stop, reconnect, sendText, toggleMute, updateCard, clearError: () => setError(null) };
}
