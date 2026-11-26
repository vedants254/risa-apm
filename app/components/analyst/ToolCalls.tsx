"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { Trace } from "./types";

const VISIBLE = 4;

/** `date: 2025-03-29, campaign_id: C03` */
function compactArgs(args: unknown) {
  if (!args || typeof args !== "object") return "";
  return Object.entries(args as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
}

function prettyJson(s: string | undefined) {
  if (!s) return "";
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    // Previews are cut at 600 characters, so most are not valid JSON on their own.
    return s.length >= 600 ? `${s}…` : s;
  }
}

function ToolCall({ t }: { t: Trace }) {
  const args = compactArgs(t.args);
  return (
    <details className="group/tool">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-sm py-0.5 font-mono text-[11px] text-muted-foreground/80 transition-colors duration-(--dur-1) select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 transition-transform duration-(--dur-1) group-open/tool:rotate-90" strokeWidth={1.75} aria-hidden />
        <span className="shrink-0">{t.name}</span>
        <span className="min-w-0 truncate">({args})</span>
        {!t.ok && <span className="shrink-0 font-sans text-danger">failed</span>}
      </summary>
      <div className="mt-1 mb-2 ml-5 space-y-2 font-mono text-xs text-muted-foreground">
        <div>
          <div className="mb-0.5 font-sans text-muted-foreground">Arguments</div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(t.args ?? {}, null, 2)}</pre>
        </div>
        {t.error && (
          <div>
            <div className="mb-0.5 font-sans text-muted-foreground">Error</div>
            <pre className="whitespace-pre-wrap break-all text-foreground">{t.error}</pre>
          </div>
        )}
        {t.preview && (
          <div>
            <div className="mb-0.5 font-sans text-muted-foreground">Result (first 600 characters)</div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{prettyJson(t.preview)}</pre>
          </div>
        )}
      </div>
    </details>
  );
}

/** The evidence trail: one collapsed monospace line per tool call, expandable to arguments and a result preview. */
export function ToolCalls({ tools }: { tools: Trace[] }) {
  const [all, setAll] = useState(false);
  if (!tools.length) return null;
  const shown = all ? tools : tools.slice(0, VISIBLE);
  return (
    <div className="mb-2" aria-label={`${tools.length} tool ${tools.length === 1 ? "call" : "calls"}`}>
      {shown.map((t, i) => (
        <ToolCall key={i} t={t} />
      ))}
      {tools.length > VISIBLE && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="ml-5 text-xs text-muted-foreground transition-colors duration-(--dur-1) hover:text-foreground"
        >
          {all ? "Show fewer" : `Show ${tools.length - VISIBLE} more tool calls`}
        </button>
      )}
    </div>
  );
}
