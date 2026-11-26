import { snapshotDate } from "@/lib/metrics";
import { body, handle, qp } from "@/lib/api";
import { askCopilot, chatForUi } from "@/lib/copilot";
import { getLlm } from "@/lib/llm";
import { clearChat } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = handle(async (req: Request) => {
  const llm = getLlm();
  return {
    configured: llm.configured,
    provider: llm.name,
    model: llm.model,
    missing_key_message: llm.configured ? null : llm.missingKeyMessage,
    messages: await chatForUi(qp(req, "session") ?? "default"),
  };
});

export const POST = handle(async (req: Request) => {
  const b = await body(req);
  return askCopilot(String(b.session ?? "default"), String(b.message ?? ""), await snapshotDate(typeof b.date === "string" ? b.date : null));
});

export const DELETE = handle(async (req: Request) => {
  await clearChat(qp(req, "session") ?? "default");
  return { ok: true };
});
