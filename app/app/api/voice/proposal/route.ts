import { body, handle } from "@/lib/api";
import type { AssistantMeta, ProposalCard } from "@/lib/copilot";
import { snapshotDate } from "@/lib/metrics";
import { appendChat, currentDatasetId } from "@/lib/repo";
import { safeRunTool } from "@/lib/tools";
import { PROPOSAL_TOOLS } from "@/lib/voice";

export const dynamic = "force-dynamic";

/** Chat session that holds drafts proposed during voice calls (kept apart from the chat history). */
const VOICE_SESSION = "voice";

/**
 * Record a draft the voice analyst proposed so it can be confirmed through the existing
 * POST /api/chat/confirm (which resolves cards stored on a chat message).
 * Body: { name: "propose_task" | "propose_campaign_update", args, date }.
 * The draft is rebuilt here from the tool, not taken from the browser, so only a draft the tool
 * itself produces can be confirmed. Nothing is created or changed until the user clicks.
 */
export const POST = handle(async (req: Request) => {
  const b = await body(req);
  const name = String(b.name ?? "");
  if (!PROPOSAL_TOOLS.has(name)) throw new Error(`"${name}" is not a proposal tool.`);
  const args = b.args && typeof b.args === "object" ? (b.args as Record<string, unknown>) : {};
  const date = await snapshotDate(typeof b.date === "string" ? b.date : null);
  const out = await safeRunTool(name, args, { date });
  if (out.error || !out.proposal) throw new Error(out.error ?? "The tool returned no draft.");
  const card: ProposalCard = { ...out.proposal, state: "pending" };
  const meta: AssistantMeta & { voice: true } = { date, dataset_id: await currentDatasetId(), proposals: [card], voice: true };
  const message_id = await appendChat(VOICE_SESSION, { role: "assistant", content: card.summary, tool_calls: null, tool_call_id: null, name: null, meta: JSON.stringify(meta) });
  return { message_id, index: 0, card };
});
