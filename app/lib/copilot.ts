/**
 * AI Growth Analyst & Copilot: a tool-calling loop over lib/tools.ts with persisted history.
 */
import { findUngroundedNumbers } from "./grounding";
import { getLlm, type LlmMessage, type ToolCall } from "./llm";
import { loadData } from "./metrics";
import { getDb } from "./db";
import { appendChat, currentDatasetId, getChat, type ChatMessage } from "./repo";
import { safeRunTool, toolDefs, type Proposal } from "./tools";

const MAX_STEPS = 10;
const HISTORY_USER_TURNS = 12;

export interface ProposalCard extends Proposal {
  state: "pending" | "confirmed" | "dismissed";
  result?: unknown;
}
export interface ToolTrace {
  name: string;
  args: unknown;
  ok: boolean;
  error?: string;
  preview?: string;
}
export interface AssistantMeta {
  date: string;
  proposals?: ProposalCard[];
  tools?: ToolTrace[];
  model?: string;
  error?: boolean;
  /** Active dataset (dataset_versions.id) the turn ran against. History survives edits to that
   *  dataset but never crosses to another one (an import or reset starts a new id). */
  dataset_id?: string;
  /** Figures in the shipped answer that no tool result or user message backs (see lib/grounding.ts). */
  ungrounded?: string[];
  /** Figures flagged in the first draft, which triggered the one correction round. */
  corrected?: string[];
}

/** Extra fields and sheets kept from an uploaded file, as listed in app_meta at import. */
async function extraDataText(): Promise<string> {
  const rows = await getDb().all<{ key: string; value: string }>("SELECT key, value FROM app_meta WHERE key IN ('extra_fields', 'extra_tables')");
  const get = (k: string) => {
    try {
      return JSON.parse(rows.find((r) => r.key === k)?.value ?? "[]") as Record<string, unknown>[];
    } catch {
      return [];
    }
  };
  const fields = get("extra_fields").map((f) => `${f.table}.${f.column} ("${f.header}")`);
  const tables = get("extra_tables").map((t) => `${t.table} (sheet "${t.sheet}": ${(t.columns as string[]).join(", ")})`);
  const out: string[] = [];
  if (fields.length) out.push(`Extra columns kept from the uploaded file (TEXT, query with query_data): ${fields.join("; ")}.`);
  if (tables.length) out.push(`Extra sheets kept as tables (TEXT, query with query_data): ${tables.join("; ")}.`);
  return out.length ? `${out.join("\n")}\n` : "";
}

export async function systemPrompt(date: string): Promise<string> {
  const data = await loadData();
  const roster = data.campaigns
    .map((c) => {
      const m = data.meta.get(c.campaign_id);
      return `${c.campaign_id} ${c.campaign_name} (${c.channel}; owner ${m?.owner_name || c.owner_name}; status ${m?.status ?? "active"})`;
    })
    .join("; ");
  const name = data.event.event_name || "the event";
  return `You are the Growth Analyst & Copilot inside the ${name} Growth Center (attendee growth).
The user's selected snapshot date is ${date} (end of day, Asia/Kolkata). Use it unless the user names another date.
Event: ${name}, ${data.event.event_starts_at} to ${data.event.event_ends_at} IST. Data covers ${data.event.history_start} to ${data.event.history_end}.
Campaigns: ${roster}.
${await extraDataText()}
RULES
1. Answer ONLY from tool results in this conversation. Never use general knowledge, benchmarks or memory for numbers or facts about this event. Never invent numbers.
2. Every derived number (ratios, %, differences, sums, what-ifs) must come from a tool; use the calculate tool for arithmetic rather than doing it in your head. Do the work with tools, but show only the result, not the working.
3. Use the selected snapshot date silently. Mention a date only when the user asked about a different one or the answer depends on timing ("as of 29 March").
4. Keep evidence and assumptions distinct, in plain prose. Measured facts from the tools are stated as facts (optionally "From the data, ..."). Anything that is an estimate (simulation, projection, what-if) or rests on a premise gets one plain sentence saying so, e.g. "Assumption: cost per registration stays at today's level, so treat this as an estimate." State it once per answer, not per bullet. Never write bracket labels like [Evidence], [Estimate] or [Assumption], and no "Evidence:" tag on each point.
5. If no tool and no listed column covers the question (e.g. demographics, age, gender, college names, ticket price or revenue, social sentiment, competitor events, weather, survey feedback, ad creatives, unless an extra column above holds it), say so plainly in one sentence, name the data that would be needed, and give the closest answer the data does support. Never guess a value for a missing or empty column.
6. Use the conversation history for follow-ups ("it", "that campaign", "the best one" refer to earlier answers).
7. To create tasks or change campaigns, call propose_task / propose_campaign_update. These only create a draft; tell the user to click "Create task" (for a task) or "Apply change" (for a campaign change) on the card. Never claim something was created or changed unless the history says the user confirmed it.
8. Definitions: external people only; import copies deduplicated by stable ID; verified visitor = admitted + verified check-in at or before D (walk-ins included, unattributed); show-up = registered external people who became verified visitors / registered; spend is net of credits; targets = latest version effective at or before D; anonymous funnel counts are events, not people, and reach must never be summed into unique people.
9. "Underperforming" means relative to the median campaign on CAC per verified visitor and show-up (use diagnose / get_recommendations). "Best" campaign = lowest CAC per visitor with adequate volume unless the user defines it otherwise.
10. Rounding: rupee amounts to whole rupees with the ₹ sign and Indian grouping ("₹1,80,000", "₹180"), ratios to two decimals ("2.22×"), percentages to one decimal ("78.6%"), people to whole numbers. Never show raw tool precision like 180.0738. Task and card descriptions follow the same rounding.

HOW TO WRITE THE ANSWER
Write like a senior growth analyst replying to a colleague in chat: plain, specific, calm. Default shape:
- First, one or two sentences that answer the question directly. Name the campaign by its name, give the one number that proves the point, and say what it is compared with (shape: "<Campaign> is the weakest: each verified visitor costs ₹X, against a campaign median of ₹Y.").
- Then, only if reasons help, up to 3 short bullets saying why. Each bullet is one plain sentence with at most one or two numbers, and says what the number means (shape: "Fewer of its visitors start registering: X% against Y% across all campaigns.").
- End with one sentence on what to do next, and offer to draft the task or change (shape: "Want me to draft a task for <owner> to cut its budget?").
Style:
- Aim for about 120 words. Go longer, or use a table, only when the user asks for detail, a breakdown or a comparison of several items.
- No preamble or restating the question, no headings in short answers, no nested lists or bullets inside bullets, no bold labels at the start of bullets, no closing summary.
- Pick the few numbers that matter; leave out the rest. Do not list every metric, ratio or stage. Prefer one comparison per point over several ratios.
- Use campaign names, not IDs (C03), unless the user uses IDs or asks for them.
- Use everyday words. Spell out a metric on first use: "cost per verified visitor (CAC)", "cost per registration". Say "show-up rate", not "registered→visitor conversion".
- Show the arithmetic only when the user asks for a calculation or how a number was reached; then give it in one clean line with the inputs, e.g. "₹48,800 spend ÷ 271 registrations = ₹180 per registration." Otherwise no "Calculation:" lines.
- When evidence is thin (few registrations, early dates, missing fields), say so in one sentence rather than overstating the conclusion.
- If a second campaign also deserves a mention, give it one sentence, not a second full breakdown.`;
}

function toLlmHistory(rows: ChatMessage[]): LlmMessage[] {
  // Keep the last N user turns; never split an assistant tool_call from its tool results.
  const userIdx = rows.map((r, i) => (r.role === "user" ? i : -1)).filter((i) => i >= 0);
  const start = userIdx.length > HISTORY_USER_TURNS ? userIdx[userIdx.length - HISTORY_USER_TURNS] : 0;
  const out: LlmMessage[] = [];
  for (const r of rows.slice(start)) {
    if (r.role === "user") out.push({ role: "user", content: r.content ?? "" });
    else if (r.role === "assistant") {
      const calls = r.tool_calls ? (JSON.parse(r.tool_calls) as ToolCall[]) : undefined;
      let content = r.content ?? null;
      if (r.meta) {
        const meta = JSON.parse(r.meta) as AssistantMeta;
        const cards = (meta.proposals ?? []).map(
          (p) => `[Card "${p.summary}": ${p.state}${p.state === "confirmed" ? ` by the user; result ${JSON.stringify(p.result)}` : ""}]`,
        );
        if (cards.length) content = `${content ?? ""}\n${cards.join("\n")}`;
      }
      out.push({ role: "assistant", content, ...(calls?.length ? { tool_calls: calls } : {}) });
    } else if (r.role === "tool") {
      out.push({ role: "tool", content: r.content ?? "", tool_call_id: r.tool_call_id ?? "" });
    }
  }
  // Drop orphan tool messages at the start (if trimming cut their assistant call).
  while (out.length && out[0].role === "tool") out.shift();
  return out;
}

export interface CopilotReply {
  ok: boolean;
  message: string;
  meta: AssistantMeta;
  message_id?: string;
}

/** The dataset a chat row was written under (undefined for untagged legacy rows). */
function rowDataset(r: ChatMessage): string | undefined {
  if (!r.meta) return undefined;
  try {
    return (JSON.parse(r.meta) as { dataset_id?: string }).dataset_id;
  } catch {
    return undefined;
  }
}

function groundingNote(figures: string[]): string {
  return `Automatic check: these figures in your draft answer do not match any tool result, calculation or user message in this conversation: ${figures.join(", ")}. For each one, either verify it with a tool (calculate for any arithmetic, or the relevant data tool) and keep it only if the tool output supports it, or remove it. Rounded forms of tool numbers are fine. Then write the complete answer for the user again. Do not mention this check and do not propose cards that are already drafted.`;
}

export async function askCopilot(sessionId: string, userText: string, date: string): Promise<CopilotReply> {
  const llm = getLlm();
  if (!llm.configured) {
    return { ok: false, message: llm.missingKeyMessage, meta: { date, error: true } };
  }
  const text = userText.trim().slice(0, 4000);
  if (!text) throw new Error("Empty message.");
  // Only turns recorded against the active dataset feed the model and the grounding check, so
  // numbers from a replaced dataset can neither be repeated nor vouch for an answer. Edits keep
  // the dataset id, so follow-ups still work after "Apply change" or a row edit.
  const dataset_id = await currentDatasetId();
  const rows = (await getChat(sessionId)).filter((r) => rowDataset(r) === dataset_id);
  const history = toLlmHistory(rows);
  const tag = JSON.stringify({ dataset_id });
  const tools = await toolDefs();
  await appendChat(sessionId, { role: "user", content: text, tool_calls: null, tool_call_id: null, name: null, meta: JSON.stringify({ date, dataset_id }) });

  const messages: LlmMessage[] = [{ role: "system", content: await systemPrompt(date) }, ...history, { role: "user", content: text }];
  const proposals: ProposalCard[] = [];
  const traces: ToolTrace[] = [];
  // Grounding evidence: tool results (calculate included) and the user's own messages.
  const evidence = rows.filter((r) => r.role === "tool").map((r) => r.content ?? "");
  const userEvidence = [...rows.filter((r) => r.role === "user").map((r) => r.content ?? ""), text].join("\n");
  // The first answer that failed the check; set once, so there is at most one correction round.
  let draft: { content: string; ungrounded: string[] } | null = null;

  const finish = async (content: string, ungrounded: string[]): Promise<CopilotReply> => {
    const meta: AssistantMeta = {
      date,
      dataset_id,
      proposals,
      tools: traces,
      model: llm.model,
      ...(draft ? { corrected: draft.ungrounded } : {}),
      ...(ungrounded.length ? { ungrounded } : {}),
    };
    const id = await appendChat(sessionId, { role: "assistant", content, tool_calls: null, tool_call_id: null, name: null, meta: JSON.stringify(meta) });
    return { ok: true, message: content, meta, message_id: id };
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    let res;
    try {
      res = await llm.chat(messages, tools);
    } catch (e) {
      // A failed correction round still has a usable draft: ship it with its figures flagged.
      if (draft) return finish(draft.content, draft.ungrounded);
      const msg = `The language model call failed: ${(e as Error).message}`;
      const meta: AssistantMeta = { date, dataset_id, tools: traces, proposals, model: llm.model, error: true };
      const id = await appendChat(sessionId, { role: "assistant", content: msg, tool_calls: null, tool_call_id: null, name: null, meta: JSON.stringify(meta) });
      return { ok: false, message: msg, meta, message_id: id };
    }
    const m = res.message;
    if (m.tool_calls?.length) {
      messages.push({ role: "assistant", content: m.content, tool_calls: m.tool_calls });
      await appendChat(sessionId, {
        role: "assistant",
        content: m.content,
        tool_calls: JSON.stringify(m.tool_calls),
        tool_call_id: null,
        name: null,
        meta: tag,
      });
      for (const call of m.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = {};
        }
        const out = await safeRunTool(call.function.name, args, { date });
        if (out.proposal) proposals.push({ ...out.proposal, state: "pending" });
        const json = JSON.stringify(out.result);
        const content = json.length > 24000 ? json.slice(0, 24000) + '..."[truncated]"' : json;
        traces.push({ name: call.function.name, args, ok: !out.error, error: out.error, preview: json.slice(0, 600) });
        messages.push({ role: "tool", content, tool_call_id: call.id });
        evidence.push(content);
        await appendChat(sessionId, { role: "tool", content, tool_calls: null, tool_call_id: call.id, name: call.function.name, meta: tag });
      }
      continue;
    }
    const answer = m.content ?? "";
    if (draft && !answer.trim()) return finish(draft.content, draft.ungrounded);
    const ungrounded = findUngroundedNumbers(answer, evidence, userEvidence);
    if (ungrounded.length && !draft && step < MAX_STEPS - 1) {
      // One correction round: name the unbacked figures and let the model verify (tools) or drop them.
      draft = { content: answer, ungrounded };
      console.info(`[copilot] grounding: unbacked figures ${ungrounded.join(", ")}; asking the model to verify or remove them`);
      messages.push({ role: "assistant", content: answer });
      messages.push({ role: "system", content: groundingNote(ungrounded) });
      continue;
    }
    if (draft) console.info(`[copilot] grounding: after correction ${ungrounded.length ? `still unbacked: ${ungrounded.join(", ")}` : "all figures backed"}`);
    return finish(answer, ungrounded);
  }
  if (draft) return finish(draft.content, draft.ungrounded);
  const msg = "I stopped after too many tool steps without a final answer. Please narrow the question.";
  const meta: AssistantMeta = { date, dataset_id, proposals, tools: traces, model: llm.model, error: true };
  const id = await appendChat(sessionId, { role: "assistant", content: msg, tool_calls: null, tool_call_id: null, name: null, meta: JSON.stringify(meta) });
  return { ok: false, message: msg, meta, message_id: id };
}

/** Chat rows for the UI: user messages and final assistant messages (with cards and tool traces). */
export async function chatForUi(sessionId = "default") {
  // Only the active dataset's turns; untagged legacy rows are hidden too.
  const dataset_id = await currentDatasetId();
  const rows = (await getChat(sessionId)).filter((r) => rowDataset(r) === dataset_id);
  return rows
    .filter((r) => r.role === "user" || (r.role === "assistant" && !r.tool_calls))
    .map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content ?? "",
      meta: r.meta ? (JSON.parse(r.meta) as AssistantMeta) : null,
      created_at: r.created_at,
    }));
}

/** Resolve a confirm card. Only this (a user click) creates tasks or changes campaigns. */
export async function resolveProposal(
  messageId: string,
  index: number,
  action: "confirm" | "dismiss",
  edits: Record<string, unknown> = {},
) {
  const { getDb } = await import("./db");
  const { createTask, updateCampaign, updateChatMeta } = await import("./repo");
  const row = await getDb().get<{ meta: string | null }>("SELECT meta FROM chat_messages WHERE id = ?", [messageId]);
  if (!row?.meta) throw new Error("Message not found.");
  const meta = JSON.parse(row.meta) as AssistantMeta;
  const card = meta.proposals?.[index];
  if (!card) throw new Error("Card not found.");
  if (card.state !== "pending") throw new Error(`Card already ${card.state}.`);
  if (action === "dismiss") {
    card.state = "dismissed";
  } else if (card.kind === "task") {
    const d = { ...card.draft, ...edits } as Record<string, string | null>;
    const task = (await createTask({
      title: d.title ?? undefined,
      description: d.description,
      campaign_id: d.campaign_id,
      owner_name: d.owner_name,
      due_date: d.due_date,
      priority: d.priority ?? undefined,
      source: "copilot",
    })) as { id: string; title: string };
    card.state = "confirmed";
    card.result = { task_id: task.id, title: task.title };
  } else {
    const d = card.draft as { campaign_id: string; changes: Record<string, unknown> };
    await updateCampaign(d.campaign_id, { ...d.changes, ...edits } as never);
    card.state = "confirmed";
    card.result = { campaign_id: d.campaign_id, applied: { ...d.changes, ...edits } };
  }
  await updateChatMeta(messageId, meta);
  return card;
}
