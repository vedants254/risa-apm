/**
 * Voice mode helpers shared by the session route (server), the browser hook and the tests.
 * Pure: no server-only imports, so the client bundle can use it.
 *
 * The voice analyst is one OpenAI Realtime speech-to-speech model (default gpt-realtime-2.1-mini)
 * with function calling. It never runs tools itself: every function call is executed by this app
 * through POST /api/tools (safeRunTool), and the result goes back as a function_call_output item.
 */
import type { ToolDef } from "./llm";

/** Hard cap on one voice call, enforced in the browser with a visible countdown and auto-hangup. */
export const VOICE_MAX_SESSION_MS = 5 * 60 * 1000;
/** Lifetime of the minted client secret (OpenAI allows 10 to 7200 s). It only gates starting a
 *  session, so it is kept short: enough to finish the WebRTC handshake with retries. */
export const VOICE_CLIENT_SECRET_TTL_S = 60;
/** A tool call that takes longer than this is answered with an error output instead of hanging. */
export const VOICE_TOOL_TIMEOUT_MS = 20_000;
/** Most tool rounds (responses that end in function calls) allowed for one user turn. */
export const VOICE_MAX_TOOL_ROUNDS = 6;
/** Session mints allowed per client IP per window (in-memory, best effort; see the route). */
export const VOICE_SESSIONS_PER_WINDOW = 5;
export const VOICE_RATE_WINDOW_MS = 10 * 60 * 1000;

/** Realtime function tool: flat, unlike the chat-completions `{type, function: {...}}` shape. */
export interface RealtimeFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** TOOL_DEFS (chat-completions format) to the Realtime session `tools` format. */
export function toRealtimeTools(defs: ToolDef[]): RealtimeFunctionTool[] {
  const seen = new Set<string>();
  return defs.map((d) => {
    const fn = d?.function;
    if (d?.type !== "function" || !fn?.name) throw new Error("Every tool definition needs type \"function\" and a name.");
    if (seen.has(fn.name)) throw new Error(`Duplicate tool name "${fn.name}".`);
    seen.add(fn.name);
    const parameters = fn.parameters && typeof fn.parameters === "object" ? fn.parameters : { type: "object", properties: {} };
    return { type: "function", name: fn.name, description: fn.description ?? "", parameters };
  });
}

/** Tools whose output is a draft the user must confirm on a card (nothing is written by the tool). */
export const PROPOSAL_TOOLS = new Set(["propose_task", "propose_campaign_update"]);

/**
 * Counts tool rounds within one user turn so a model that keeps calling tools cannot loop.
 * `startTurn()` when the user speaks (or types); `next()` before executing a round of calls.
 */
export class ToolRoundGuard {
  private rounds = 0;
  constructor(public readonly max = VOICE_MAX_TOOL_ROUNDS) {}
  startTurn() {
    this.rounds = 0;
  }
  /** Registers one more round. `allowed` is false once the cap is exceeded. */
  next(): { allowed: boolean; round: number } {
    this.rounds += 1;
    return { allowed: this.rounds <= this.max, round: this.rounds };
  }
  get count() {
    return this.rounds;
  }
}

/** A completed function call from a Realtime `response.done` output. */
export interface FunctionCallItem {
  call_id: string;
  name: string;
  arguments: string;
}

/** Function calls in a `response.done` event's `response.output` (all of them, in order). */
export function functionCallsOf(response: unknown): FunctionCallItem[] {
  const output = (response as { output?: unknown[] } | null)?.output;
  if (!Array.isArray(output)) return [];
  return output
    .filter((o): o is { type: string; call_id: string; name: string; arguments?: string } => {
      const it = o as { type?: string; call_id?: unknown; name?: unknown; status?: string };
      // A call cut off by a cancel has partial arguments: not run (the model re-asks if needed).
      if (it?.status === "incomplete" || it?.status === "in_progress") return false;
      return it?.type === "function_call" && typeof it.call_id === "string" && typeof it.name === "string";
    })
    .map((o) => ({ call_id: o.call_id, name: o.name, arguments: o.arguments ?? "" }));
}

/** What a tool runner returns (the /api/tools response shape: safeRunTool's output). */
export interface ToolRunnerOutput {
  result: unknown;
  error?: string;
  proposal?: unknown;
}
export type ToolRunner = (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<ToolRunnerOutput>;

export interface ToolRunResult {
  call: FunctionCallItem;
  args: Record<string, unknown>;
  ok: boolean;
  /** JSON string sent back as the function_call_output (an `{error}` object on failure). */
  output: string;
  result?: unknown;
  error?: string;
  proposal?: unknown;
  ms: number;
}

/** Same cap as the chat analyst puts on one tool message. */
const MAX_OUTPUT_CHARS = 24_000;

function clip(json: string) {
  return json.length > MAX_OUTPUT_CHARS ? `${json.slice(0, MAX_OUTPUT_CHARS)}..."[truncated]"` : json;
}

/**
 * Run every call of one response in parallel. Never throws: a bad argument string, a tool error,
 * a network failure or a timeout each becomes an `{error}` output so the model can say it could
 * not get the data, and no call is left without an output.
 */
export async function runToolCalls(
  calls: FunctionCallItem[],
  run: ToolRunner,
  { timeoutMs = VOICE_TOOL_TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ToolRunResult[]> {
  return Promise.all(
    calls.map(async (call) => {
      const t0 = Date.now();
      let args: Record<string, unknown> = {};
      try {
        const parsed = call.arguments.trim() ? JSON.parse(call.arguments) : {};
        args = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        const error = "The function arguments were not valid JSON.";
        return { call, args, ok: false, output: JSON.stringify({ error }), error, ms: 0 };
      }
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            ctrl.abort();
            reject(new Error(`The ${call.name} lookup took longer than ${Math.round(timeoutMs / 1000)} seconds.`));
          }, timeoutMs);
        });
        const out = await Promise.race([run(call.name, args, ctrl.signal), timeout]);
        if (out.error) return { call, args, ok: false, output: clip(JSON.stringify({ error: out.error })), error: out.error, result: out.result, ms: Date.now() - t0 };
        return { call, args, ok: true, output: clip(JSON.stringify(out.result ?? null)), result: out.result, proposal: out.proposal, ms: Date.now() - t0 };
      } catch (e) {
        const error = signal?.aborted ? "The session ended before the lookup finished." : (e as Error).message || "The lookup failed.";
        return { call, args, ok: false, output: JSON.stringify({ error }), error, ms: Date.now() - t0 };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    }),
  );
}

/** Client events that hand one round of outputs back to the model (one item per call). */
export function functionOutputEvents(results: { call: FunctionCallItem; output: string }[]) {
  return results.map((r) => ({ type: "conversation.item.create", item: { type: "function_call_output", call_id: r.call.call_id, output: r.output } }));
}

/**
 * A listening-friendly view of a few long tool results for the voice model. Same values, nothing
 * computed or added: only ordering and dropping detail. The chat analyst still gets the full
 * result. diagnose: campaigns weakest first (the realtime mini model tends to stop at the first
 * "under-performing" row), per-stage tables dropped (each campaign keeps its bottleneck).
 */
export function voiceView(name: string, result: unknown): unknown {
  if (name !== "diagnose" || !result || typeof result !== "object") return result;
  const r = result as { campaigns?: Record<string, unknown>[]; stage_labels?: unknown };
  if (!Array.isArray(r.campaigns)) return result;
  const campaigns = [...r.campaigns]
    .sort((a, b) => Number(b.rank ?? 0) - Number(a.rank ?? 0))
    .map((c) => {
      const { stages: _stages, ...rest } = c;
      void _stages;
      return rest;
    });
  const { stage_labels: _labels, ...rest } = r;
  void _labels;
  return { ...rest, order: "campaigns listed weakest first (the first one is the weakest)", campaigns };
}

/**
 * Runs tools through this app's POST /api/tools (safeRunTool at the given snapshot date).
 * `base` is "" in the browser and the dev server origin in scripts. One retry on network or 5xx.
 */
export function apiToolRunner(base: string, date: string): ToolRunner {
  return (name, args, signal) =>
    withRetry(
      async () => {
        const r = await fetch(`${base}/api/tools`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, args, date }),
          signal,
          cache: "no-store",
        });
        let j: (ToolRunnerOutput & { error?: string }) | null = null;
        try {
          j = await r.json();
        } catch {
          /* handled below */
        }
        if (r.status >= 500) throw new HttpError(j?.error ?? `The data service returned HTTP ${r.status}.`, r.status);
        if (!j) throw new HttpError(`The data service returned HTTP ${r.status} with no JSON.`, r.status);
        if (!r.ok) return { result: { error: j.error }, error: j.error ?? `HTTP ${r.status}` };
        return j.error ? j : { ...j, result: voiceView(name, j.result) };
      },
      { retries: 1, retryable: isRetryable, signal },
    );
}

/** A system message item (extra context mid-call, e.g. a confirmed card or the tool cap). */
export function systemMessageEvent(text: string) {
  return { type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text }] } };
}

/**
 * Per-response instructions for the spoken introduction sent as soon as the session is ready,
 * before the user says anything (event name from the active dataset).
 */
export function greetingInstructions(eventName?: string | null): string {
  const event = eventName?.trim() ? eventName.trim() : "this event";
  return `Greet the user now, before they speak. Say this, warmly and naturally, keeping these words and the event name: "Hi, I'm the AI analyst for ${event}. I'm ready to help analyse attendee growth. What would you like to explore?" Say nothing else, do not call tools, then stop and listen.`;
}

/** What the model receives for a call that was not run because the round cap was hit. */
export const TOOL_CAP_OUTPUT = {
  error: "Tool limit reached for this question. Do not call more tools. Tell the user in one short sentence what you found so far and ask them to narrow the question.",
};

/** Instructions for the closing response after the cap (sent with tool_choice "none"). */
export const TOOL_CAP_INSTRUCTIONS =
  "You hit the tool limit for this question. Without calling tools, say in one or two short sentences what you found so far, and ask the user to narrow the question.";

/** True for errors that mean the account is out of quota or rate limited (OpenAI codes and types). */
export function isUsageLimitError(e: { code?: string | null; type?: string | null; message?: string | null; status?: number } | null | undefined): boolean {
  if (!e) return false;
  const s = `${e.code ?? ""} ${e.type ?? ""}`.toLowerCase();
  if (/insufficient_quota|rate_limit|billing|quota/.test(s)) return true;
  if (e.status === 429) return true;
  return /exceeded your current quota|rate limit/i.test(e.message ?? "");
}

export const USAGE_LIMIT_MESSAGE = "The voice analyst has reached its usage limit. Try again later, or use chat.";

/** mm:ss for the countdown. */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Retry with exponential backoff. `retryable` decides which errors are worth another attempt. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  { retries = 2, baseMs = 400, retryable, signal }: { retries?: number; baseMs?: number; retryable: (e: unknown) => boolean; signal?: AbortSignal },
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (signal?.aborted || attempt >= retries || !retryable(e)) throw e;
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, baseMs * 2 ** attempt);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    }
  }
}

/** An HTTP failure with its status, so retry logic can tell 5xx (retry) from 4xx (do not). */
export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

/** Network errors (TypeError from fetch) and 5xx are retryable; aborts and 4xx are not. */
export function isRetryable(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return false;
  if (e instanceof HttpError) return e.status >= 500;
  return e instanceof TypeError;
}

/**
 * Turn and response bookkeeping for one Realtime session, shared by the browser hook and the live
 * test. It never lets two responses run at once and never answers a superseded turn:
 *
 * - Every user turn (committed speech or a typed / tapped question) gets a new turn number.
 * - A tapped question while the model is answering cancels that response first (`response.cancel`,
 *   and `output_audio_buffer.clear` if WebRTC audio is still playing); its `response.create` waits
 *   until the cancelled response reports `response.done`.
 * - Tool outputs are always appended (the conversation stays complete and the model can reuse the
 *   data), but a follow-up `response.create` is sent only if that tool round's turn is still the
 *   latest one. Nothing is ever deleted from the conversation.
 * - One `response.create` at a time: while a response is active or one we asked for has not been
 *   created yet, the next request is queued (latest wins) and sent after `response.done`.
 */
export class VoiceTurns {
  private turnNo = 0;
  private active: string | null = null;
  private createInFlight = false;
  private queued: { turn: number; response?: Record<string, unknown> } | null = null;
  private responseTurn = new Map<string, number>();
  /** WebRTC only: true between output_audio_buffer.started and .stopped / .cleared. */
  audioPlaying = false;
  readonly guard: ToolRoundGuard;
  /** Every response.create this controller sent (the live test counts them). */
  creates = 0;

  constructor(
    private send: (event: unknown) => boolean,
    { webrtc = false, maxToolRounds = VOICE_MAX_TOOL_ROUNDS }: { webrtc?: boolean; maxToolRounds?: number } = {},
  ) {
    this.webrtc = webrtc;
    this.guard = new ToolRoundGuard(maxToolRounds);
  }
  private webrtc: boolean;

  get turn() {
    return this.turnNo;
  }
  /** A response is running or about to start. */
  get busy() {
    return this.active !== null || this.createInFlight;
  }

  /** The user finished an utterance (server VAD committed it; the server creates the response). */
  userSpoke(): number {
    this.turnNo++;
    this.guard.startTurn();
    this.queued = null; // the server's own response answers the new turn
    return this.turnNo;
  }

  /** The user typed or tapped a question: interrupt whatever is playing, add it, answer it. */
  userText(text: string): number {
    this.interrupt();
    this.turnNo++;
    this.guard.startTurn();
    this.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    this.requestResponse(this.turnNo);
    return this.turnNo;
  }

  /** Stop the current answer: cancel generation and cut playing audio (kept in the conversation). */
  interrupt() {
    if (this.active) this.send({ type: "response.cancel" });
    if (this.webrtc && this.audioPlaying) this.send({ type: "output_audio_buffer.clear" });
  }

  /** Ask for a response for `turn`; skipped if the turn is superseded, queued if one is running. */
  requestResponse(turn: number, response?: Record<string, unknown>): "sent" | "queued" | "superseded" {
    if (turn !== this.turnNo) return "superseded";
    if (this.busy) {
      this.queued = { turn, response };
      return "queued";
    }
    this.createInFlight = true;
    this.creates++;
    this.send(response ? { type: "response.create", response } : { type: "response.create" });
    return "sent";
  }

  responseCreated(id: string) {
    this.active = id;
    this.createInFlight = false;
    this.responseTurn.set(id, this.turnNo);
  }

  /** Returns the turn the finished response belonged to and its function calls. */
  responseDone(response: { id?: string; status?: string; output?: unknown[] }): { turn: number; status: string; calls: FunctionCallItem[]; current: boolean } {
    const id = response.id ?? "";
    const turn = this.responseTurn.get(id) ?? this.turnNo;
    this.responseTurn.delete(id);
    if (this.active === id || !id) this.active = null;
    const out = { turn, status: response.status ?? "completed", calls: functionCallsOf(response), current: turn === this.turnNo };
    this.flush();
    return out;
  }

  /** A failed send or an API rejection of our response.create: allow the next one. */
  createRejected() {
    this.createInFlight = false;
    this.flush();
  }

  private flush() {
    if (this.busy || !this.queued) return;
    const q = this.queued;
    this.queued = null;
    this.requestResponse(q.turn, q.response);
  }
}
