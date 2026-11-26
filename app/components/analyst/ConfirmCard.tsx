"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DecisionBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import type { Card } from "./types";

const CHANGE_LABEL: Record<string, string> = {
  status: "Status",
  owner_name: "Owner",
  planned_budget_inr: "Planned budget",
  notes: "Notes",
};

const str = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Pausing or stopping a campaign is a stop decision, re-activating is a scale; other edits carry no badge. */
function decisionOf(c: Card): "scale" | "stop" | null {
  if (c.kind !== "campaign_update") return null;
  const st = String(((c.draft.changes ?? {}) as Record<string, unknown>).status ?? "");
  return st === "stopped" || st === "paused" ? "stop" : st === "active" ? "scale" : null;
}

function formatChange(k: string, v: unknown) {
  if (k === "planned_budget_inr" && typeof v === "number") return `₹${Math.round(v).toLocaleString("en-IN")}`;
  if (k === "status" && typeof v === "string") return sentence(v);
  return str(v);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}

/**
 * The one card in the panel: a draft the copilot proposed. Nothing is written until the user
 * clicks Confirm (POST /api/chat/confirm).
 */
export function ConfirmCard({
  card,
  onResolve,
  tasksHref,
  campaignsHref,
  primary = true,
}: {
  card: Card;
  /** Only one primary button per view: older pending drafts get a secondary confirm. */
  primary?: boolean;
  onResolve: (action: "confirm" | "dismiss") => Promise<void>;
  tasksHref: string;
  campaignsHref: string;
}) {
  const [busy, setBusy] = useState<"confirm" | "dismiss" | null>(null);
  const isTask = card.kind === "task";
  const decision = decisionOf(card);
  const changes = (card.draft.changes ?? {}) as Record<string, unknown>;
  const current = (card.draft.current ?? {}) as Record<string, unknown>;

  const act = async (a: "confirm" | "dismiss") => {
    setBusy(a);
    try {
      await onResolve(a);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3 rounded-2xl bg-muted p-4 text-[13px]">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{isTask ? "Draft task" : "Draft campaign change"}</span>
        {decision && <DecisionBadge action={decision} />}
      </div>

      {isTask ? (
        <>
          <div className="text-sm font-medium text-foreground">{str(card.draft.title)}</div>
          <dl className="mt-2 space-y-1">
            <Row label="Owner">{str(card.draft.owner_name)}</Row>
            <Row label="Campaign">{str(card.draft.campaign_name ?? card.draft.campaign_id)}</Row>
            <Row label="Priority">{sentence(str(card.draft.priority))}</Row>
            {Boolean(card.draft.due_date) && (
              <Row label="Due">
                <span className="tabular">{str(card.draft.due_date)}</span>
              </Row>
            )}
          </dl>
          {Boolean(card.draft.description) && <p className="mt-2 line-clamp-3 text-muted-foreground">{String(card.draft.description)}</p>}
        </>
      ) : (
        <>
          <div className="text-sm font-medium text-foreground">{str(card.draft.campaign_name ?? card.draft.campaign_id)}</div>
          <dl className="mt-2 space-y-1">
            {Object.entries(changes).map(([k, v]) => (
              <Row key={k} label={CHANGE_LABEL[k] ?? k}>
                {current[k] !== undefined && <span className="text-muted-foreground">{formatChange(k, current[k])} to </span>}
                <span className="font-medium tabular">{formatChange(k, v)}</span>
              </Row>
            ))}
            {Boolean(card.draft.reason) && <Row label="Reason">{String(card.draft.reason)}</Row>}
          </dl>
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {card.state === "pending" ? (
          <>
            <Button size="sm" variant={primary ? "default" : "outline"} onClick={() => act("confirm")} disabled={busy !== null} className="rounded-full px-3.5">
              {busy === "confirm" ? (isTask ? "Creating…" : "Applying…") : isTask ? "Create task" : "Apply change"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => act("dismiss")} disabled={busy !== null} className="rounded-full px-3">
              Dismiss
            </Button>
          </>
        ) : card.state === "confirmed" ? (
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <Check className="size-3.5" strokeWidth={1.75} aria-hidden />
              {isTask ? "Task created" : "Campaign updated"}
            </span>
            <Link href={isTask ? tasksHref : campaignsHref} className="text-muted-foreground underline underline-offset-4 transition-colors duration-(--dur-1) hover:text-foreground">
              {isTask ? "Open in Tasks" : "Open in Campaigns"}
            </Link>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Dismissed</span>
        )}
      </div>
    </div>
  );
}
