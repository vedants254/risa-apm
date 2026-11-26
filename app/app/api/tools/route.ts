import { snapshotDate } from "@/lib/metrics";
/** Debug route for the copilot tool layer (works without an LLM key). */
import { body, handle, qp } from "@/lib/api";
import { getLlm } from "@/lib/llm";
import { TOOL_DEFS, safeRunTool } from "@/lib/tools";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const name = qp(req, "name");
  if (name) {
    const args = JSON.parse(qp(req, "args") ?? "{}");
    return safeRunTool(name, args, { date: await snapshotDate(qp(req, "date")) });
  }
  const llm = getLlm();
  return {
    llm: { provider: llm.name, model: llm.model, configured: llm.configured },
    tools: TOOL_DEFS.map((t) => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })),
    usage: "POST {name, args, date} or GET ?name=get_overview&args={}&date=YYYY-MM-DD",
  };
});

export const POST = handle(async (req: Request) => {
  const b = await body(req);
  return safeRunTool(String(b.name ?? ""), (b.args as Record<string, unknown>) ?? {}, { date: await snapshotDate(typeof b.date === "string" ? b.date : null) });
});
