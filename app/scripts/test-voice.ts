/**
 * Voice mode tests.
 *
 *   npm run test:voice        offline: TOOL_DEFS -> Realtime tool conversion, the tool-round cap,
 *                             parallel tool execution with timeouts and error outputs, retries,
 *                             the per-IP limiter, the session config, and the voice draft ->
 *                             confirm path (against a temporary copy of data/growth.db).
 *   npm run test:voice:live   LIVE (needs the dev server on VOICE_TEST_BASE, default
 *                             http://localhost:3311, and OPENAI_API_KEY there): mints a client
 *                             secret through POST /api/voice/session, opens a Realtime WebSocket
 *                             with it (text input only, no microphone), runs every function call
 *                             through POST /api/tools exactly like the browser, and checks the
 *                             answer. At most 2 sessions.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LIVE = process.argv.includes("--live");

let failures = 0;
let passes = 0;
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) {
    passes++;
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function offline() {
  const src = path.join(process.cwd(), "data", "growth.db");
  if (!fs.existsSync(src)) {
    console.error("data/growth.db not found. Run `npm run seed` first.");
    process.exit(1);
  }
  const tmp = path.join(os.tmpdir(), `growth-voice-test-${Date.now()}.db`);
  fs.copyFileSync(src, tmp);
  process.env.SQLITE_PATH = tmp;
  process.env.DB_DRIVER = "sqlite";

  const voice = await import("../lib/voice");
  const { TOOL_DEFS } = await import("../lib/tools");

  console.log("TOOL_DEFS -> Realtime tools");
  const rt = voice.toRealtimeTools(TOOL_DEFS);
  check("one realtime tool per definition", rt.length === TOOL_DEFS.length, { rt: rt.length, defs: TOOL_DEFS.length });
  check(
    "flat shape {type, name, description, parameters}",
    rt.every((t, i) => t.type === "function" && t.name === TOOL_DEFS[i].function.name && t.description === TOOL_DEFS[i].function.description && t.parameters === TOOL_DEFS[i].function.parameters && !("function" in t)),
  );
  check("propose tools are included", rt.some((t) => t.name === "propose_task") && rt.some((t) => t.name === "propose_campaign_update"));
  let threw = false;
  try {
    voice.toRealtimeTools([TOOL_DEFS[0], TOOL_DEFS[0]]);
  } catch {
    threw = true;
  }
  check("duplicate tool names are rejected", threw);
  threw = false;
  try {
    voice.toRealtimeTools([{ type: "function", function: { name: "", description: "", parameters: {} } }]);
  } catch {
    threw = true;
  }
  check("a nameless tool is rejected", threw);
  const noParams = voice.toRealtimeTools([{ type: "function", function: { name: "x", description: "d", parameters: undefined as never } }]);
  check("missing parameters become an empty object schema", (noParams[0].parameters as { type?: string }).type === "object");

  console.log("Tool-round cap");
  const g = new voice.ToolRoundGuard(6);
  const allowed = Array.from({ length: 7 }, () => g.next().allowed);
  check("six rounds allowed, the seventh refused", allowed.slice(0, 6).every(Boolean) && allowed[6] === false, allowed);
  g.startTurn();
  check("a new user turn resets the cap", g.next().allowed && g.count === 1);
  check("default cap is VOICE_MAX_TOOL_ROUNDS (6)", new voice.ToolRoundGuard().max === 6 && voice.VOICE_MAX_TOOL_ROUNDS === 6);
  check("cap output is an error object for the model", typeof voice.TOOL_CAP_OUTPUT.error === "string");

  console.log("Function calls");
  const done = {
    status: "completed",
    output: [
      { type: "message", role: "assistant", content: [{ type: "output_audio", transcript: "One moment." }] },
      { type: "function_call", call_id: "call_1", name: "diagnose", arguments: "{}" },
      { type: "function_call", call_id: "call_2", name: "get_overview", arguments: '{"date":"2025-03-29"}' },
    ],
  };
  const calls = voice.functionCallsOf(done);
  check("extracts every function call in order", calls.length === 2 && calls[0].call_id === "call_1" && calls[1].name === "get_overview", calls);
  check("no calls from an empty or odd response", voice.functionCallsOf(null).length === 0 && voice.functionCallsOf({ output: "x" }).length === 0);

  let aborted = false;
  const runner: import("../lib/voice").ToolRunner = async (name, _args, signal) => {
    if (name === "slow") {
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      });
    }
    if (name === "boom") throw new TypeError("fetch failed");
    if (name === "bad") return { result: { error: "Unknown campaign_id" }, error: "Unknown campaign_id" };
    return { result: { ok: name } };
  };
  const t0 = Date.now();
  const res = await voice.runToolCalls(
    [
      { call_id: "a", name: "good", arguments: "{}" },
      { call_id: "b", name: "slow", arguments: "{}" },
      { call_id: "c", name: "boom", arguments: "{}" },
      { call_id: "d", name: "bad", arguments: "{}" },
      { call_id: "e", name: "good", arguments: "{not json" },
    ],
    runner,
    { timeoutMs: 150 },
  );
  check("every call gets an output, in order", res.map((r) => r.call.call_id).join("") === "abcde", res.map((r) => r.call.call_id));
  check("good call returns its JSON result", res[0].ok && JSON.parse(res[0].output).ok === "good");
  check("slow call times out with an error output", !res[1].ok && /longer than/.test(JSON.parse(res[1].output).error), res[1]);
  check("timeout aborts the in-flight request", aborted);
  check("calls run in parallel (total close to one timeout)", Date.now() - t0 < 1000, Date.now() - t0);
  check("thrown error becomes an error output", !res[2].ok && JSON.parse(res[2].output).error === "fetch failed");
  check("tool error becomes an error output", !res[3].ok && JSON.parse(res[3].output).error === "Unknown campaign_id");
  check("invalid argument JSON becomes an error output", !res[4].ok && /not valid JSON/.test(JSON.parse(res[4].output).error));
  const ctrl = new AbortController();
  const pending = voice.runToolCalls([{ call_id: "z", name: "slow", arguments: "{}" }], runner, { timeoutMs: 10_000, signal: ctrl.signal });
  ctrl.abort();
  const [zr] = await pending;
  check("hangup aborts pending tools with an error output", !zr.ok && /ended/.test(zr.error ?? ""), zr);
  const evs = voice.functionOutputEvents(res);
  check(
    "function_call_output items carry call_id and a JSON string",
    evs.length === 5 && evs.every((e, i) => e.type === "conversation.item.create" && e.item.type === "function_call_output" && e.item.call_id === res[i].call.call_id && typeof e.item.output === "string"),
  );
  const sys = voice.systemMessageEvent("hi");
  check("system message item shape", sys.item.role === "system" && sys.item.content[0].type === "input_text");

  console.log("Turns, cancels and superseded tool rounds");
  {
    const sent: { type: string; response?: Record<string, unknown> }[] = [];
    const t = new voice.VoiceTurns((e) => {
      sent.push(e as { type: string });
      return true;
    }, { webrtc: true });
    const types = () => sent.map((e) => e.type);
    t.requestResponse(0, { instructions: "greet", tool_choice: "none" });
    check("greeting response.create sent", types().join() === "response.create" && t.busy);
    t.responseCreated("r0");
    t.audioPlaying = true;
    sent.length = 0;
    const t1 = t.userText("Tell me about Paid Social");
    check(
      "a typed question mid-answer cancels, clears audio, adds the item, and waits",
      types().join() === "response.cancel,output_audio_buffer.clear,conversation.item.create" && t1 === 1,
      types(),
    );
    t.responseDone({ id: "r0", status: "cancelled" });
    check("queued response.create goes out after the cancelled response is done", types().at(-1) === "response.create");
    t.responseCreated("r1");
    t.audioPlaying = false;
    // r1 ends in a function call; while the tool runs, the user asks something else.
    const d1 = t.responseDone({ id: "r1", status: "completed", output: [{ type: "function_call", call_id: "c1", name: "diagnose", arguments: "{}" }] });
    check("response.done reports its turn and calls", d1.turn === 1 && d1.calls.length === 1 && d1.current);
    sent.length = 0;
    t.userText("No, Creator Partners instead");
    check("nothing to cancel when no response is running", types().join() === "conversation.item.create,response.create", types());
    t.responseCreated("r2");
    sent.length = 0;
    check("the superseded tool round gets no response.create", t.requestResponse(d1.turn) === "superseded" && sent.length === 0);
    check("a second request for the live turn is queued while r2 runs", t.requestResponse(t.turn) === "queued" && sent.length === 0);
    t.responseDone({ id: "r2", status: "completed", output: [] });
    check("queued request is sent once r2 is done (never two at once)", types().join() === "response.create");
    t.responseCreated("r3");
    t.userSpoke();
    sent.length = 0;
    t.responseDone({ id: "r3", status: "cancelled" });
    check("spoken turns leave response creation to server VAD", sent.length === 0);
    t.requestResponse(t.turn);
    t.createRejected();
    check("a rejected create frees the slot", !t.busy);
  }
  check(
    "incomplete function calls from a cancelled response are not run",
    voice.functionCallsOf({ output: [{ type: "function_call", status: "incomplete", call_id: "x", name: "diagnose", arguments: "{" }] }).length === 0,
  );

  console.log("Retries and errors");
  let n = 0;
  try {
    await voice.withRetry(
      async () => {
        n++;
        throw new voice.HttpError("down", 502);
      },
      { retries: 2, baseMs: 5, retryable: voice.isRetryable },
    );
  } catch {
    /* expected */
  }
  check("5xx retried twice (3 attempts)", n === 3, n);
  n = 0;
  try {
    await voice.withRetry(
      async () => {
        n++;
        throw new voice.HttpError("bad", 422);
      },
      { retries: 2, baseMs: 5, retryable: voice.isRetryable },
    );
  } catch {
    /* expected */
  }
  check("4xx not retried", n === 1, n);
  n = 0;
  const ok = await voice.withRetry(
    async () => {
      if (++n < 2) throw new TypeError("network");
      return "ok";
    },
    { retries: 2, baseMs: 5, retryable: voice.isRetryable },
  );
  check("network error retried, then succeeds", ok === "ok" && n === 2);
  check("usage-limit detection", voice.isUsageLimitError({ code: "insufficient_quota" }) && voice.isUsageLimitError({ type: "rate_limit_exceeded" }) && voice.isUsageLimitError({ status: 429 }) && !voice.isUsageLimitError({ code: "invalid_value" }));
  check("countdown format", voice.formatCountdown(300_000) === "5:00" && voice.formatCountdown(61_001) === "1:02" && voice.formatCountdown(-5) === "0:00");
  check("session cap is 5 minutes", voice.VOICE_MAX_SESSION_MS === 300_000);

  console.log("Session route helpers");
  const vs = await import("../lib/voice-session");
  const ip = `test-${Date.now()}`;
  const t = 1_000_000;
  const slots = Array.from({ length: 6 }, (_, i) => vs.takeVoiceSlot(ip, t + i).ok);
  check("5 sessions per IP per 10 minutes, the 6th refused", slots.slice(0, 5).every(Boolean) && !slots[5], slots);
  check("slot frees after the window", vs.takeVoiceSlot(ip, t + voice.VOICE_RATE_WINDOW_MS + 10).ok);
  check("keys are scrubbed from messages", !/sk-proj/.test(vs.scrubSecrets("Incorrect API key provided: sk-proj-abcdEFGH1234****wxyz.")));
  const prevModel = process.env.OPENAI_REALTIME_MODEL;
  delete process.env.OPENAI_REALTIME_MODEL;
  check("default model gpt-realtime-2.1-mini", vs.voiceConfig().model === "gpt-realtime-2.1-mini");
  process.env.OPENAI_REALTIME_MODEL = "gpt-realtime-2.1";
  check("OPENAI_REALTIME_MODEL overrides the model", vs.voiceConfig().model === "gpt-realtime-2.1");
  if (prevModel === undefined) delete process.env.OPENAI_REALTIME_MODEL;
  else process.env.OPENAI_REALTIME_MODEL = prevModel;
  const session = await vs.buildVoiceSession("2025-03-29");
  check("session type realtime with function tools", session.type === "realtime" && session.tools.length === TOOL_DEFS.length && session.tool_choice === "auto");
  check("instructions carry the snapshot date and voice rules", session.instructions.includes("2025-03-29") && session.instructions.includes("VOICE MODE") && session.instructions.includes("RULES"));
  const td = session.audio.input.turn_detection as { type: string; create_response?: boolean; interrupt_response?: boolean };
  check("semantic VAD with barge-in, and input transcription on", td.type === "semantic_vad" && td.create_response === true && td.interrupt_response === true && Boolean(session.audio.input.transcription.model));
  check("voice-only reading hint on diagnose", /weakest first/.test(session.tools.find((x) => x.name === "diagnose")?.description ?? ""));
  const diag = (await (await import("../lib/tools")).safeRunTool("diagnose", {}, { date: "2025-03-29" })).result as { campaigns: { campaign_name: string; rank: number; cac: number }[] };
  const vv = voice.voiceView("diagnose", diag) as { campaigns: { campaign_name: string; rank: number; cac: number; stages?: unknown }[] };
  check(
    "voice view of diagnose: weakest first, same values, stage tables dropped",
    vv.campaigns[0].rank === Math.max(...diag.campaigns.map((c) => c.rank)) &&
      vv.campaigns.length === diag.campaigns.length &&
      vv.campaigns.every((c) => diag.campaigns.find((d) => d.campaign_name === c.campaign_name)?.cac === c.cac && c.stages === undefined),
    vv.campaigns.map((c) => c.campaign_name),
  );
  check("other tools pass through unchanged", voice.voiceView("get_overview", diag) === diag);
  check("instructions cover interruptions", /Never silently drop a request/.test(session.instructions));
  check("default reasoning effort is the model default", !("reasoning" in session) || process.env.OPENAI_REALTIME_REASONING_EFFORT !== undefined);
  check("query_data description includes the live schema", (session.tools.find((x) => x.name === "query_data")?.description ?? "").length > 200);
  const { systemPrompt } = await import("../lib/copilot");
  const chat = await systemPrompt("2025-03-29");
  check("chat prompt unchanged in shape (still has its writing guide)", chat.includes("HOW TO WRITE THE ANSWER") && !chat.includes("VOICE MODE"));

  console.log("Voice draft -> confirm");
  const repo = await import("../lib/repo");
  const { POST: proposalPOST } = await import("../app/api/voice/proposal/route");
  const { POST: confirmPOST } = await import("../app/api/chat/confirm/route");
  const before = (await repo.listTasks()).length;
  const pr = await proposalPOST(
    new Request("http://x/api/voice/proposal", {
      method: "POST",
      body: JSON.stringify({ name: "propose_task", args: { title: "Review Creator Partners spend", campaign_id: "C03", priority: "high" }, date: "2025-03-29" }),
    }),
  );
  const pj = (await pr.json()) as { message_id?: string; index?: number; card?: { state: string; kind: string }; error?: string };
  check("proposal recorded as a pending card", Boolean(pj.message_id) && pj.card?.state === "pending" && pj.card?.kind === "task", pj);
  check("nothing created before the click", (await repo.listTasks()).length === before);
  const bad = await proposalPOST(new Request("http://x", { method: "POST", body: JSON.stringify({ name: "query_data", args: { sql: "DELETE FROM tasks" } }) }));
  check("non-proposal tools are refused", bad.status === 400);
  const cr = await confirmPOST(new Request("http://x", { method: "POST", body: JSON.stringify({ message_id: pj.message_id, index: 0, action: "confirm" }) }));
  const cj = (await cr.json()) as { state?: string };
  check("existing confirm endpoint creates the task", cj.state === "confirmed" && (await repo.listTasks()).length === before + 1, cj);
  const ui = await (await import("../lib/copilot")).chatForUi("default");
  check("voice drafts stay out of the chat history", !ui.some((m) => (m.meta as { voice?: boolean } | null)?.voice));

  const { closeDb } = await import("../lib/db");
  await closeDb();
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* Windows may hold the file briefly */
  }
}

// ---------------------------------------------------------------------------------------------
// LIVE: Realtime over WebSocket with the minted client secret, text in, tools through /api/tools.
// ---------------------------------------------------------------------------------------------
async function live() {
  const base = process.env.VOICE_TEST_BASE ?? "http://localhost:3311";
  const date = "2025-03-29";
  const voice = await import("../lib/voice");
  const { findUngroundedNumbers } = await import("../lib/grounding");

  type Ev = Record<string, any>;
  const transcript: { role: string; text: string }[] = [];
  const toolLog: { turn: number; name: string; args: unknown; ok: boolean; ms: number; error?: string }[] = [];
  const evidence: string[] = [];
  const apiErrors: string[] = [];

  async function session(attempt: number) {
    console.log(`\nLIVE session ${attempt} against ${base} (snapshot ${date})`);
    const r = await fetch(`${base}/api/voice/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date }) });
    const minted = (await r.json()) as { client_secret?: string; expires_at?: number; model?: string; history?: unknown[]; error?: string };
    check("POST /api/voice/session returns a client secret", r.ok && /^ek_/.test(minted.client_secret ?? ""), { status: r.status, error: minted.error });
    if (!minted.client_secret) throw new Error(minted.error ?? `HTTP ${r.status}`);
    check("response has expires_at, model and a history array", typeof minted.expires_at === "number" && minted.expires_at * 1000 > Date.now() && Boolean(minted.model) && Array.isArray(minted.history));
    console.log(`  model ${minted.model}, secret expires in ${Math.round((minted.expires_at! * 1000 - Date.now()) / 1000)} s, chat seed ${minted.history?.length ?? 0} turns`);

    // Browser-style auth: the ephemeral key as a subprotocol (the server key is never used here).
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(minted.model!)}`, ["realtime", `openai-insecure-api-key.${minted.client_secret}`]);
    const sendRaw = (e: unknown) => {
      if (ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(e));
      return true;
    };
    const turns = new voice.VoiceTurns(sendRaw);
    let ready!: () => void;
    const readyP = new Promise<void>((res) => (ready = res));
    let sessionInfo = "";
    // Per-turn final answers; and hooks the scenario uses.
    const finals = new Map<number, string>();
    const cancelled: number[] = [];
    let onCreated: ((turn: number) => void) | null = null;
    let waiter: { turn: number; resolve: (t: string) => void } | null = null;
    let closed = "";

    ws.addEventListener("close", (e) => {
      closed = `closed (${e.code} ${e.reason})`;
      waiter?.resolve("");
    });
    ws.addEventListener("message", async (m) => {
      const ev = JSON.parse(String(m.data)) as Ev;
      switch (ev.type) {
        case "session.created":
          sessionInfo = `session.created ${ev.session?.id} model=${ev.session?.model} tools=${ev.session?.tools?.length} voice=${ev.session?.audio?.output?.voice} turn_detection=${ev.session?.audio?.input?.turn_detection?.type}`;
          ready();
          break;
        case "error":
          apiErrors.push(`${ev.error?.code ?? ""} ${ev.error?.message ?? ""}`.trim());
          if (ev.error?.code === "conversation_already_has_active_response") turns.createRejected();
          break;
        case "response.created": {
          turns.responseCreated(ev.response?.id ?? "");
          const cb = onCreated;
          if (cb) {
            onCreated = null;
            cb(turns.turn);
          }
          break;
        }
        case "response.done": {
          const resp = ev.response ?? {};
          const done = turns.responseDone(resp);
          const said = (resp.output ?? [])
            .filter((o: Ev) => o.type === "message")
            .flatMap((o: Ev) => o.content ?? [])
            .map((c: Ev) => c.transcript ?? c.text ?? "")
            .join(" ")
            .trim();
          if (said) transcript.push({ role: `assistant${resp.status !== "completed" ? ` (${resp.status})` : ""}`, text: said });
          if (resp.status === "cancelled") cancelled.push(done.turn);
          if (done.calls.length) {
            const results = await voice.runToolCalls(done.calls, voice.apiToolRunner(base, date));
            for (const res of results) {
              evidence.push(res.output);
              toolLog.push({ turn: done.turn, name: res.call.name, args: res.args, ok: res.ok, ms: res.ms, error: res.error });
              transcript.push({ role: "tool", text: `${res.call.name}(${JSON.stringify(res.args)}) -> ${res.ok ? "ok" : `error: ${res.error}`} [${res.ms} ms]${done.current ? "" : " (superseded turn: output appended, no new response)"}` });
            }
            voice.functionOutputEvents(results).forEach(sendRaw);
            const outcome = done.status === "failed" ? "skipped" : turns.requestResponse(done.turn);
            if (outcome === "superseded") transcript.push({ role: "client", text: `turn ${done.turn} superseded: no response.create` });
          } else if (resp.status === "completed" && said) {
            finals.set(done.turn, said);
            if (waiter && waiter.turn === done.turn) {
              const w = waiter;
              waiter = null;
              w.resolve(said);
            }
          }
          break;
        }
      }
    });

    const timeout = <T,>(p: Promise<T>, ms: number, what: string) =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000} s`)), ms))]);
    await timeout(readyP, 20_000, "session.created");
    console.log(`  ${sessionInfo}`);

    /** Ask, optionally interrupting with a second message as soon as the first answer starts. */
    const ask = async (text: string, interruptWith?: string) => {
      transcript.push({ role: "user", text });
      const first = turns.userText(text);
      let target = first;
      if (interruptWith) {
        await timeout(
          new Promise<void>((res) => {
            onCreated = () => {
              transcript.push({ role: "user (interrupts)", text: interruptWith });
              target = turns.userText(interruptWith); // response.cancel, then the new item; create waits for done
              res();
            };
          }),
          20_000,
          "first response",
        );
      }
      const answer = await timeout(new Promise<string>((resolve) => (waiter = { turn: target, resolve })), 90_000, `answer to turn ${target}`);
      return { answer, first, target, firstAnswered: finals.has(first) && first !== target };
    };

    const out: Record<string, { answer: string; first: number; target: number; firstAnswered: boolean; createsBefore: number; createsAfter: number }> = {};
    const run = async (key: string, text: string, interruptWith?: string) => {
      const createsBefore = turns.creates;
      const res = await ask(text, interruptWith);
      out[key] = { ...res, createsBefore, createsAfter: turns.creates };
      await sleep(400); // let any stray events land before the next step
    };
    try {
      await run("q1", "Which campaign is underperforming and why?");
      await run("also", "Tell me about Paid Social's cost per registration.", "And also Creator Partners.");
      await run("instead", "What's Paid Social's click-through rate?", "No, Creator Partners instead.");
    } finally {
      try {
        ws.close(1000);
      } catch {
        /* already closed */
      }
    }
    return { out, cancelled, closed };
  }

  let res: Awaited<ReturnType<typeof session>> | null = null;
  const maxSessions = Math.min(2, Math.max(1, Number(process.env.VOICE_TEST_SESSIONS ?? 2) || 2));
  for (let attempt = 1; attempt <= maxSessions && !res; attempt++) {
    try {
      res = await session(attempt);
    } catch (e) {
      console.log(`  session ${attempt} failed: ${(e as Error).message}`);
      if (attempt < maxSessions) await sleep(1500);
    }
  }
  console.log(`\n  Transcript (verbatim):`);
  for (const t of transcript) console.log(`    [${t.role}] ${t.text}`);
  console.log("");
  if (!res) {
    check("a live session completed", false);
    return;
  }
  const { out, cancelled } = res;
  check("the model called our tools", toolLog.length > 0, toolLog);
  check("all tool calls succeeded through /api/tools", toolLog.every((t) => t.ok), toolLog);
  check("q1: answer names Creator Partners", /creator partners/i.test(out.q1.answer), out.q1.answer);
  check(
    "q1: answer cites about ₹180 (cost per registration)",
    /(₹|rs\.?|inr)\s?180\b|\b180(\.\d+)?\s*(rupees|inr)|\bone (hundred (and )?)?eighty\b/i.test(out.q1.answer),
    out.q1.answer,
  );
  const ungrounded = findUngroundedNumbers(out.q1.answer, evidence, "");
  console.log(`  grounding check on q1: ${ungrounded.length ? `unbacked ${ungrounded.join(", ")}` : "all figures backed"}`);
  check("interruptions cancelled the answer in progress", cancelled.includes(out.also.first) && cancelled.includes(out.instead.first), { cancelled, also: out.also.first, instead: out.instead.first });
  check("an interrupted request never got its own separate answer", !out.also.firstAnswered && !out.instead.firstAnswered);
  check("no concurrent-response errors", !apiErrors.some((e) => /active_response/.test(e)), apiErrors);
  const both = /paid social/i.test(out.also.answer) && /creator partners/i.test(out.also.answer);
  const asks = /\?/.test(out.also.answer) && /paid social|creator partners/i.test(out.also.answer);
  check('"and also Creator Partners" covers both campaigns (or asks)', both || asks, out.also.answer);
  check('"no, Creator Partners instead" answers Creator Partners', /creator partners/i.test(out.instead.answer), out.instead.answer);
  check('"instead" answer does not go on about Paid Social', !/paid social/i.test(out.instead.answer), out.instead.answer);
  if (apiErrors.length) console.log(`  realtime errors seen: ${apiErrors.join(" | ")}`);
}

(async () => {
  if (LIVE) await live();
  else await offline();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
