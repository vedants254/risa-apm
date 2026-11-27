import { NextResponse } from "next/server";
import { body } from "@/lib/api";
import { snapshotDate } from "@/lib/metrics";
import { HttpError } from "@/lib/voice";
import { clientIp, mintClientSecret, releaseVoiceSlot, takeVoiceSlot, voiceSeedHistory } from "@/lib/voice-session";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Mint an ephemeral Realtime client secret for the voice analyst. The real OPENAI_API_KEY never
 * leaves the server. Body: { date?: "YYYY-MM-DD" }. Returns { client_secret, expires_at, model,
 * voice, max_session_ms, event_name, history } (history: the last few text-chat turns of the active
 * dataset, to seed the voice session). Errors: 503 missing key, 429 per-IP limit or OpenAI usage limit,
 * 422 OpenAI rejected the config, 502 OpenAI unreachable or failing (safe to retry).
 */
export async function POST(req: Request) {
  const noStore = { "Cache-Control": "no-store" };
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Voice mode needs OPENAI_API_KEY on the server. Add it to app/.env.local and restart the dev server.", code: "missing_key" },
      { status: 503, headers: noStore },
    );
  }
  const ip = clientIp(req);
  const slot = takeVoiceSlot(ip);
  if (!slot.ok) {
    const mins = Math.max(1, Math.ceil(slot.retryAfterS / 60));
    return NextResponse.json(
      { error: `Too many voice sessions from this network. Try again in about ${mins} minute${mins === 1 ? "" : "s"}, or use chat.`, code: "session_limit" },
      { status: 429, headers: { ...noStore, "Retry-After": String(slot.retryAfterS) } },
    );
  }
  try {
    const b = await body(req);
    const date = await snapshotDate(typeof b.date === "string" ? b.date : null);
    const minted = await mintClientSecret(date);
    // Context only: a failure here must not block the session.
    const history = await voiceSeedHistory().catch(() => []);
    return NextResponse.json({ ...minted, date, history }, { headers: noStore });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    // Upstream outages and bad config should not use up the caller's session allowance.
    if (status >= 500 || status === 422) releaseVoiceSlot(ip);
    const code = e instanceof HttpError ? e.code : undefined;
    const message = e instanceof HttpError ? e.message : `Could not start the voice session: ${(e as Error).message}`;
    return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status, headers: noStore });
  }
}
