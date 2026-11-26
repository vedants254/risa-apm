/**
 * npm run test:copilot — runs the 3-step demo workflow through the real copilot loop
 * (tool execution, persistence, confirm cards) with a scripted stand-in for the LLM, so it
 * works without an API key. The scripted model only decides WHICH tools to call; every
 * number comes from the real tool layer. Uses a temporary DB copy.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const src = path.join(process.cwd(), "data", "growth.db");
if (!fs.existsSync(src)) {
  console.error("data/growth.db not found. Run `npm run seed` first.");
  process.exit(1);
}
const tmp = path.join(os.tmpdir(), `growth-copilot-${Date.now()}.db`);
fs.copyFileSync(src, tmp);
process.env.SQLITE_PATH = tmp;
process.env.DB_DRIVER = "sqlite";
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;

let fails = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${!cond && detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
  if (!cond) fails++;
};

(async () => {
  const { setLlmOverride } = await import("../lib/llm");
  type LlmMessage = import("../lib/llm").LlmMessage;
  const { askCopilot, resolveProposal, chatForUi } = await import("../lib/copilot");
  const repo = await import("../lib/repo");
  const { closeDb } = await import("../lib/db");

  console.log("No key configured");
  const nokey = await askCopilot("t", "hello", "2025-04-13");
  check("copilot says Set OPENAI_API_KEY", !nokey.ok && /OPENAI_API_KEY/.test(nokey.message), nokey.message);

  // Scripted model: picks tools from the user text; composes the final answer from tool JSON.
  let call = 0;
  const id = () => `call_${++call}`;
  const lastUserIdx = (m: LlmMessage[]) => m.map((x) => x.role).lastIndexOf("user");
  const toolResults = (m: LlmMessage[]) => m.slice(lastUserIdx(m) + 1).filter((x) => x.role === "tool").map((x) => JSON.parse(x.content ?? "{}"));
  const allTool = (m: LlmMessage[]) => m.filter((x) => x.role === "tool").map((x) => JSON.parse(x.content ?? "{}"));
  const fc = (name: string, args: unknown) => ({ id: id(), type: "function" as const, function: { name, arguments: JSON.stringify(args) } });

  setLlmOverride({
    name: "Scripted",
    model: "scripted-test",
    configured: true,
    missingKeyMessage: "",
    async chat(messages) {
      const user = String(messages[lastUserIdx(messages)].content);
      const results = toolResults(messages);
      const diag = allTool(messages).find((r) => r.campaigns && r.median_cac !== undefined);
      const worst = diag?.campaigns.find((c: { verdict: string }) => c.verdict === "under-performing");
      const worstSorted = diag ? [...diag.campaigns].sort((a: { efficiency_index: number }, b: { efficiency_index: number }) => a.efficiency_index - b.efficiency_index)[0] : null;
      const best = diag ? diag.campaigns[0] : null;
      if (/underperforming/i.test(user)) {
        if (!results.length) return { message: { role: "assistant", content: null, tool_calls: [fc("diagnose", {})] } };
        const w = worstSorted ?? worst;
        return {
          message: {
            role: "assistant",
            content: `${w.campaign_name} is the weakest: each verified visitor costs INR ${w.cac} against a median of INR ${diag.median_cac}. Its main drop-off is ${w.bottleneck?.stage}.`,
          },
        };
      }
      if (/move 20%/i.test(user)) {
        if (!results.length) return { message: { role: "assistant", content: null, tool_calls: [fc("simulate_reallocation", { from_campaign_id: worstSorted.campaign_id, to_campaign_id: best.campaign_id, pct: 0.2 })] } };
        const s = results[0];
        return { message: { role: "assistant", content: `Moving INR ${s.moved_inr} changes visitors by about ${s.net_visitor_change}. This is an estimate.` } };
      }
      if (/create a task/i.test(user)) {
        if (!results.length)
          return {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [fc("propose_task", { title: `Pause ${worstSorted.campaign_name}`, campaign_id: worstSorted.campaign_id, priority: "high", description: "From diagnosis" })],
            },
          };
        return { message: { role: "assistant", content: "Draft ready: click Confirm on the card." } };
      }
      return { message: { role: "assistant", content: "The data cannot answer that." } };
    },
  });

  console.log("Demo workflow");
  const s = "demo";
  const r1 = await askCopilot(s, "Which campaign is underperforming and why?", "2025-04-13");
  check("step 1 answered from diagnose tool", r1.ok && r1.meta.tools?.[0]?.name === "diagnose", r1);
  check("step 1 names Creator Partners (lowest efficiency)", /Creator Partners/.test(r1.message), r1.message);
  const r2 = await askCopilot(s, "What if we move 20% of its budget to the best one?", "2025-04-13");
  check("step 2 follow-up uses history to pick campaigns", r2.ok && r2.meta.tools?.[0]?.name === "simulate_reallocation", r2.meta.tools);
  check("step 2 says it is an estimate", /estimate/i.test(r2.message), r2.message);
  const before = (await repo.listTasks()).length;
  const r3 = await askCopilot(s, "Create a task for the owner to pause it", "2025-04-13");
  check("step 3 produces a confirm card", r3.meta.proposals?.length === 1 && r3.meta.proposals[0].state === "pending", r3.meta);
  check("nothing created before confirmation", (await repo.listTasks()).length === before);
  const card = await resolveProposal(r3.message_id!, 0, "confirm");
  const tasks = (await repo.listTasks()) as { title: string; source: string; owner_name: string }[];
  const t = tasks.find((x) => x.source === "copilot");
  check("confirm creates the task", card.state === "confirmed" && Boolean(t), tasks);
  check("task owner is the campaign owner", t?.owner_name === "Nisha Rao", t);
  let again = false;
  try {
    await resolveProposal(r3.message_id!, 0, "confirm");
  } catch {
    again = true;
  }
  check("a card cannot be confirmed twice", again);
  const ui = await chatForUi(s);
  check("chat history persisted (6 visible messages)", ui.length === 6, ui.length);

  // Grounding check: a scripted model that invents a figure, then reacts (or not) to the correction.
  const INVENTED = "₹98,765";
  let seen: LlmMessage[] = [];
  let rememberedMedian: number | null = null;
  const sinceUser = (m: LlmMessage[]) => m.slice(lastUserIdx(m) + 1);
  setLlmOverride({
    name: "Scripted",
    model: "scripted-test",
    configured: true,
    missingKeyMessage: "",
    async chat(messages) {
      seen = messages;
      const user = String(messages[lastUserIdx(messages)].content);
      const turn = sinceUser(messages);
      const corrected = turn.some((x) => x.role === "system" && /Automatic check/.test(x.content ?? ""));
      const results = turn.filter((x) => x.role === "tool").map((x) => JSON.parse(x.content ?? "{}"));
      const diag = results.find((r) => r.campaigns && r.median_cac !== undefined);
      const calc = results.find((r) => r.expression !== undefined);
      if (/^Version B/.test(user)) return { message: { role: "assistant", content: `The median is INR ${rememberedMedian}.` } };
      if (!diag) return { message: { role: "assistant", content: null, tool_calls: [fc("diagnose", {})] } };
      const w = diag.campaigns[0];
      if (/^Version A/.test(user)) {
        rememberedMedian = diag.median_cac;
        return { message: { role: "assistant", content: `The median is INR ${diag.median_cac}.` } };
      }
      if (!corrected || /stubborn/.test(user))
        return { message: { role: "assistant", content: `${w.campaign_name} costs INR ${w.cac} per visitor, against a median of ${INVENTED}.` } };
      if (!calc) return { message: { role: "assistant", content: null, tool_calls: [fc("calculate", { expression: `${w.cac} - ${diag.median_cac}` })] } };
      return {
        message: {
          role: "assistant",
          content: `${w.campaign_name} costs ₹${Math.round(w.cac)} per visitor, against a median of ₹${Math.round(diag.median_cac)} (a gap of ₹${Math.abs(Math.round(calc.value))}).`,
        },
      };
    },
  });

  console.log("Grounding check");
  const g1 = await askCopilot("g1", "Grounding: how does the best campaign compare with the median?", "2025-04-13");
  check("invented figure triggers one correction round", JSON.stringify(g1.meta.corrected) === JSON.stringify([INVENTED]), g1.meta);
  check("corrected answer is grounded (no meta.ungrounded)", g1.ok && !g1.meta.ungrounded && !g1.message.includes("98,765"), g1);
  check("correction round verified with calculate", g1.meta.tools?.some((t) => t.name === "calculate"), g1.meta.tools);
  const g1ui = await chatForUi("g1");
  check("draft answer is not persisted (one assistant message)", g1ui.filter((r) => r.role === "assistant").length === 1, g1ui);
  const g2 = await askCopilot("g2", "Grounding stubborn: compare with the median", "2025-04-13");
  check("still-unbacked figure is shipped and recorded in meta.ungrounded", g2.ok && JSON.stringify(g2.meta.ungrounded) === JSON.stringify([INVENTED]) && g2.message.includes("98,765"), g2);
  check("only one correction round", (seen.filter((x) => x.role === "system" && /Automatic check/.test(x.content ?? "")).length) === 1, seen.length);

  console.log("No leakage between datasets");
  const { getDb } = await import("../lib/db");
  const va = await askCopilot("v", "Version A: what is the median cost per visitor?", "2025-04-13");
  check("dataset A answer grounded by its own tool result", va.ok && !va.meta.ungrounded && !va.meta.corrected && Boolean(va.meta.dataset_id), va);
  const vRows = await repo.getChat("v");
  check("every chat row records its dataset_id", vRows.every((r) => r.meta && JSON.parse(r.meta).dataset_id === va.meta.dataset_id), vRows.map((r) => r.meta));
  await repo.bumpVersion();
  check("an edit keeps the dataset id (follow-ups survive edits)", (await repo.currentDatasetId()) === va.meta.dataset_id);
  check("history survives an edit in the panel", (await chatForUi("v")).length === 2);
  // A new active dataset (what an import or reset records), without wiping chat, to prove isolation.
  await getDb().run("UPDATE dataset_versions SET is_active = 0");
  await getDb().run(
    "INSERT INTO dataset_versions (id, data_version, source_name, source_kind, imported_at, schema_version, is_active) VALUES ('dv-test-b', 'vb', 'B.xlsx', 'upload', '2025-01-01 00:00:00', 2, 1)",
  );
  check("dataset A turns are hidden from the panel", (await chatForUi("v")).length === 0);
  const vb = await askCopilot("v", "Version B: and the median now?", "2025-04-13");
  check("dataset B runs under a new dataset id", vb.meta.dataset_id === "dv-test-b", [va.meta.dataset_id, vb.meta.dataset_id]);
  check("dataset A tool result does not ground a dataset B answer", (vb.meta.ungrounded ?? []).length === 1 && Boolean(vb.meta.corrected), vb.meta);
  check("dataset A turns are not sent to the model", !seen.some((x) => x.role === "tool" || /Version A/.test(x.content ?? "")), seen.map((x) => x.role));

  setLlmOverride(undefined);
  await closeDb();
  for (const ext of ["", "-wal", "-shm"]) fs.rmSync(tmp + ext, { force: true });
  console.log(fails ? `\n${fails} failed` : "\nall passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
