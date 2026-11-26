/** UI shapes of the chat rows returned by GET /api/chat (see lib/copilot.ts chatForUi). */
export interface Card {
  kind: "task" | "campaign_update";
  draft: Record<string, unknown>;
  summary: string;
  state: "pending" | "confirmed" | "dismissed";
  result?: unknown;
}

export interface Trace {
  name: string;
  args: unknown;
  ok: boolean;
  error?: string;
  /** First 600 characters of the tool's JSON result. */
  preview?: string;
}

export interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta: {
    date?: string;
    proposals?: Card[];
    tools?: Trace[];
    error?: boolean;
    model?: string;
    /** Figures the grounding check could not match to any tool result (lib/grounding.ts). */
    ungrounded?: string[];
  } | null;
}

export const prettyDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
