/**
 * Server side of voice mode: builds the Realtime session config and mints a short-lived client
 * secret with the real OPENAI_API_KEY. The browser only ever sees the ephemeral `ek_...` value.
 *
 * API: POST https://api.openai.com/v1/realtime/client_secrets
 *   { expires_after: { anchor: "created_at", seconds }, session: { type: "realtime", model, ... } }
 *   -> { value, expires_at, session }
 * Docs: https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create
 */
import { chatForUi, voiceInstructions } from "./copilot";
import { loadData } from "./metrics";
import { toolDefs } from "./tools";
import {
  HttpError,
  USAGE_LIMIT_MESSAGE,
  VOICE_CLIENT_SECRET_TTL_S,
  VOICE_MAX_SESSION_MS,
  VOICE_RATE_WINDOW_MS,
  VOICE_SESSIONS_PER_WINDOW,
  isUsageLimitError,
  toRealtimeTools,
} from "./voice";

export const OPENAI_REALTIME_URL = "https://api.openai.com/v1/realtime";

export interface VoiceConfig {
  model: string;
  voice: string;
  transcribeModel: string;
  reasoningEffort?: string;
}

export function voiceConfig(): VoiceConfig {
  return {
    model: process.env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime-2.1-mini",
    // marin and cedar are the voices OpenAI recommends for quality.
    voice: process.env.OPENAI_REALTIME_VOICE?.trim() || "marin",
    transcribeModel: process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL?.trim() || "gpt-4o-mini-transcribe",
    reasoningEffort: process.env.OPENAI_REALTIME_REASONING_EFFORT?.trim() || undefined,
  };
}

/**
 * Extra reading notes appended to a few tool descriptions for the voice model only. Facts about
 * the result shape (not data): the smaller realtime model tends to stop at the first
 * "under-performing" row of a long result.
 */
const VOICE_TOOL_HINTS: Record<string, string> = {
  diagnose:
    "In voice mode the result lists campaigns weakest first: the FIRST campaign (highest rank, lowest efficiency_index) is the weakest. cac is in rupees with a decimal point (180.07 = about 180 rupees).",
  compare_campaigns: "Values are rupees, counts or ratios with a decimal point; read the whole ranking before naming the best or worst.",
};

/** The `session` object for client_secrets (also valid for session.update over a WebSocket). */
export async function buildVoiceSession(date: string, cfg = voiceConfig()) {
  return {
    type: "realtime" as const,
    model: cfg.model,
    instructions: await voiceInstructions(date),
    output_modalities: ["audio"],
    audio: {
      input: {
        // Shows the user's words in the transcript. Runs on a separate ASR model, so it is a guide
        // to what was said, not exactly what the realtime model heard.
        transcription: { model: cfg.transcribeModel, language: "en" },
        noise_reduction: { type: "near_field" },
        // Semantic VAD waits for the user to finish a thought; interrupt_response lets them cut in
        // ("no, tell me about X instead"): the server cancels the answer and, over WebRTC,
        // truncates the unplayed audio itself.
        turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: true, interrupt_response: true },
      },
      output: { voice: cfg.voice },
    },
    tools: toRealtimeTools(await toolDefs()).map((t) => (VOICE_TOOL_HINTS[t.name] ? { ...t, description: `${t.description} ${VOICE_TOOL_HINTS[t.name]}` } : t)),
    tool_choice: "auto",
    ...(cfg.reasoningEffort ? { reasoning: { effort: cfg.reasoningEffort } } : {}),
  };
}

/** Caps for seeding a voice session with the active text chat (about 2k tokens). */
export const SEED_MAX_ITEMS = 8;
export const SEED_MAX_CHARS = 8000;
const SEED_ITEM_CHARS = 1200;

/**
 * The last few turns of the text chat for the active dataset (chatForUi already filters by
 * dataset), so a user can move from chat to voice without repeating context. Text only.
 */
export async function voiceSeedHistory(sessionId = "default"): Promise<{ role: "user" | "assistant"; text: string }[]> {
  const rows = (await chatForUi(sessionId)).filter((m) => m.content.trim() && !m.meta?.error);
  const out: { role: "user" | "assistant"; text: string }[] = [];
  let chars = 0;
  for (let i = rows.length - 1; i >= 0 && out.length < SEED_MAX_ITEMS; i--) {
    const raw = rows[i].content.trim();
    const text = raw.length > SEED_ITEM_CHARS ? `${raw.slice(0, SEED_ITEM_CHARS)}…` : raw;
    if (chars + text.length > SEED_MAX_CHARS) break;
    chars += text.length;
    out.unshift({ role: rows[i].role === "user" ? "user" : "assistant", text });
  }
  return out;
}

/** Remove anything that looks like an API key from text that may reach the browser. */
export function scrubSecrets(s: string): string {
  const key = process.env.OPENAI_API_KEY;
  let out = key ? s.split(key).join("[redacted]") : s;
  out = out.replace(/\b(sk|ek)-?[A-Za-z0-9_*-]{8,}/g, "[redacted]");
  return out;
}

export interface MintedSecret {
  client_secret: string;
  expires_at: number;
  model: string;
  voice: string;
  max_session_ms: number;
  /** Event name from the active dataset, for the spoken introduction. */
  event_name: string | null;
}

export async function mintClientSecret(date: string, signal?: AbortSignal): Promise<MintedSecret> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new HttpError("Voice mode needs OPENAI_API_KEY on the server. Add it to app/.env.local and restart the dev server.", 503, "missing_key");
  const cfg = voiceConfig();
  const session = await buildVoiceSession(date, cfg);
  let res: Response;
  try {
    res = await fetch(`${OPENAI_REALTIME_URL}/client_secrets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: VOICE_CLIENT_SECRET_TTL_S }, session }),
      signal: signal ?? AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (e) {
    throw new HttpError(`Could not reach OpenAI to start the voice session: ${scrubSecrets((e as Error).message)}`, 502, "network");
  }
  const text = await res.text();
  let j: { value?: string; expires_at?: number; error?: { message?: string; code?: string; type?: string } } = {};
  try {
    j = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok || !j.value) {
    const err = j.error ?? {};
    if (isUsageLimitError({ ...err, status: res.status })) throw new HttpError(USAGE_LIMIT_MESSAGE, 429, err.code ?? "usage_limit");
    if (res.status === 401 || res.status === 403) throw new HttpError("OpenAI rejected the server's API key for voice mode. Check OPENAI_API_KEY and that the project has Realtime access.", 502, "auth");
    const detail = scrubSecrets(err.message || text.slice(0, 200) || `HTTP ${res.status}`);
    // Upstream 5xx stays 5xx (502) so the browser retries; upstream 4xx (bad config such as an
    // unknown model) becomes 422 with the reason, which the browser does not retry.
    throw new HttpError(`OpenAI could not create the voice session: ${detail}`, res.status >= 500 ? 502 : 422, err.code);
  }
  const event_name = (await loadData()).event.event_name || null;
  return { client_secret: j.value, expires_at: j.expires_at ?? 0, model: cfg.model, voice: cfg.voice, max_session_ms: VOICE_MAX_SESSION_MS, event_name };
}

/**
 * Per-IP session limiter. In memory, so it is per server instance: on Vercel each warm function
 * instance keeps its own count and a cold start resets it. Good enough to stop a casual loop;
 * use a shared store (Redis, the database) for a hard limit.
 */
const store = globalThis as unknown as { __voiceRate?: Map<string, number[]> };
const hits = (store.__voiceRate ??= new Map<string, number[]>());

export function takeVoiceSlot(ip: string, now = Date.now()): { ok: boolean; retryAfterS: number } {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < VOICE_RATE_WINDOW_MS);
  if (recent.length >= VOICE_SESSIONS_PER_WINDOW) {
    hits.set(ip, recent);
    return { ok: false, retryAfterS: Math.ceil((VOICE_RATE_WINDOW_MS - (now - recent[0])) / 1000) };
  }
  recent.push(now);
  hits.set(ip, recent);
  // Keep the map from growing without bound on a long-lived server.
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < VOICE_RATE_WINDOW_MS)) hits.delete(k);
  return { ok: true, retryAfterS: 0 };
}

/** Give a slot back when the mint failed for reasons that are not the caller's fault. */
export function releaseVoiceSlot(ip: string) {
  const v = hits.get(ip);
  if (v?.length) v.pop();
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] || req.headers.get("x-real-ip") || "local").trim();
}
