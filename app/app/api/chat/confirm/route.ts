import { body, handle } from "@/lib/api";
import { resolveProposal } from "@/lib/copilot";

export const dynamic = "force-dynamic";

/** The only path by which a copilot draft becomes a real task / campaign change. */
export const POST = handle(async (req: Request) => {
  const b = await body(req);
  const action = b.action === "dismiss" ? "dismiss" : "confirm";
  return resolveProposal(String(b.message_id), Number(b.index ?? 0), action, (b.edits as Record<string, unknown>) ?? {});
});
