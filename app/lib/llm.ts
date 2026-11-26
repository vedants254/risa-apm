/**
 * LLM provider adapter. The copilot only depends on `getLlm().chat(messages, tools)`, using the
 * OpenAI chat-completions message/tool format. Providers:
 *
 *   LLM_PROVIDER=openai (default)  OPENAI_API_KEY, OPENAI_MODEL (default gpt-4.1-mini), OPENAI_BASE_URL
 *   LLM_PROVIDER=gemini            GEMINI_API_KEY, GEMINI_MODEL (default gemini-2.5-flash) via Google AI
 *                                  Studio's OpenAI-compatible endpoint.
 */

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}
export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface LlmResult {
  message: LlmMessage;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
/** Per-call options. `json` asks for a single JSON object reply (used by the dataset mapper). */
export interface ChatOptions {
  json?: boolean;
}
export interface LlmProvider {
  name: string;
  model: string;
  configured: boolean;
  missingKeyMessage: string;
  chat(messages: LlmMessage[], tools: ToolDef[], options?: ChatOptions): Promise<LlmResult>;
}

/** Optional sampling settings. Unset values are not sent, so the provider default applies. */
interface SamplingOptions {
  temperature?: number;
  reasoningEffort?: string;
}

function readNumber(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Adjustments learned from a provider's 400 response, kept per model for the life of the process.
const learned = new Map<string, SamplingOptions & { dropTemperature?: boolean }>();

class OpenAICompatible implements LlmProvider {
  constructor(
    public name: string,
    public model: string,
    private apiKey: string | undefined,
    private baseUrl: string,
    public missingKeyMessage: string,
    private sampling: SamplingOptions = {},
  ) {}
  get configured() {
    return Boolean(this.apiKey);
  }
  private body(messages: LlmMessage[], tools: ToolDef[], options: ChatOptions = {}) {
    const fix = learned.get(this.model) ?? {};
    const temperature = fix.dropTemperature ? undefined : this.sampling.temperature;
    const reasoningEffort = fix.reasoningEffort ?? this.sampling.reasoningEffort;
    return JSON.stringify({
      model: this.model,
      messages,
      // An empty tools array is rejected by the API, so omit tools entirely when there are none.
      ...(tools.length ? { tools, tool_choice: "auto" } : {}),
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    });
  }
  /**
   * Some models reject a non-default temperature, or function tools unless reasoning_effort is "none"
   * (e.g. gpt-5.x on /chat/completions). Learn that from the 400 once and retry, instead of failing the chat.
   */
  private learnFrom(status: number, text: string): boolean {
    if (status !== 400) return false;
    let param = "", message = "";
    try {
      const e = (JSON.parse(text) as { error?: { param?: string; message?: string } }).error;
      param = e?.param ?? "";
      message = e?.message ?? "";
    } catch {
      return false;
    }
    const fix = { ...(learned.get(this.model) ?? {}) };
    if (param === "temperature" && !fix.dropTemperature) fix.dropTemperature = true;
    else if (param === "reasoning_effort" && /'none'/.test(message) && fix.reasoningEffort !== "none") fix.reasoningEffort = "none";
    else return false;
    learned.set(this.model, fix);
    return true;
  }
  async chat(messages: LlmMessage[], tools: ToolDef[], options: ChatOptions = {}): Promise<LlmResult> {
    if (!this.apiKey) throw new Error(this.missingKeyMessage);
    const url = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` };
    let res = await fetch(url, { method: "POST", headers, body: this.body(messages, tools, options) });
    // At most two retries: one per learnable parameter.
    for (let i = 0; i < 2 && !res.ok; i++) {
      const text = await res.text();
      if (!this.learnFrom(res.status, text)) {
        // Never echo request headers/keys; the body is the provider's error message.
        throw new Error(`${this.name} API error ${res.status}: ${text.slice(0, 500)}`);
      }
      res = await fetch(url, { method: "POST", headers, body: this.body(messages, tools, options) });
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${this.name} API error ${res.status}: ${text.slice(0, 500)}`);
    }
    const json = (await res.json()) as {
      choices: { message: LlmMessage }[];
      usage?: LlmResult["usage"];
    };
    const msg = json.choices?.[0]?.message;
    if (!msg) throw new Error(`${this.name} returned no message.`);
    return {
      message: { role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls?.length ? msg.tool_calls : undefined },
      usage: json.usage,
    };
  }
}

export function getLlm(): LlmProvider {
  const o = (globalThis as unknown as { __llmOverride?: LlmProvider }).__llmOverride;
  if (o) return o;
  const provider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
  if (provider === "gemini") {
    return new OpenAICompatible(
      "Gemini",
      process.env.GEMINI_MODEL || "gemini-2.5-flash",
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai",
      "Set GEMINI_API_KEY in app/.env.local to enable the copilot (LLM_PROVIDER=gemini).",
      { temperature: readNumber(process.env.GEMINI_TEMPERATURE) ?? 0.1 },
    );
  }
  return new OpenAICompatible(
    "OpenAI",
    process.env.OPENAI_MODEL || "gpt-4.1-mini",
    process.env.OPENAI_API_KEY,
    process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    "Set OPENAI_API_KEY in app/.env.local to enable the copilot.",
    {
      temperature: readNumber(process.env.OPENAI_TEMPERATURE),
      reasoningEffort: process.env.OPENAI_REASONING_EFFORT || undefined,
    },
  );
}

// Test hook: scripts can inject a scripted provider to exercise the copilot loop without a key.
const g = globalThis as unknown as { __llmOverride?: LlmProvider };
export function setLlmOverride(p: LlmProvider | undefined) {
  g.__llmOverride = p;
}
