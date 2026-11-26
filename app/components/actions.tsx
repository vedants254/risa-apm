"use client";

import { Check, ListPlus, NotebookPen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useShell } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Icon-only row action with a tooltip; used where actions appear on row hover. */
function IconAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={label} onClick={onClick} disabled={disabled} className="rounded-full text-muted-foreground hover:text-foreground">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function Done({ label, icon }: { label: string; icon?: boolean }) {
  return (
    <span className="inline-flex h-7 min-w-7 items-center justify-center gap-1 px-1.5 text-xs text-muted-foreground" title={label}>
      <Check className="size-3.5" strokeWidth={1.75} aria-hidden />
      {icon ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}

/** Insight to action: one click turns a recommendation into a tracked task. */
export function CreateTaskButton({
  draft,
  label = "Create task",
  source = "recommendation",
  small = false,
  variant,
  icon = false,
}: {
  draft: { title: string; description?: string; campaign_id?: string | null; owner_name?: string | null; priority?: string; due_date?: string | null };
  label?: string;
  source?: "recommendation" | "manual";
  small?: boolean;
  /** Defaults to outline when `small`, primary otherwise (the original behaviour). */
  variant?: "default" | "outline" | "ghost";
  /** Icon-only button with a tooltip (for row actions shown on hover). */
  icon?: boolean;
}) {
  const router = useRouter();
  const { withDate } = useShell();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const go = async () => {
    setState("busy");
    try {
      const r = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, source }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setState("done");
      toast.success("Task created", {
        description: draft.title,
        action: { label: "Open tasks", onClick: () => router.push(withDate("/tasks")) },
      });
      router.refresh();
    } catch (e) {
      setState("idle");
      toast.error("Could not create the task", { description: (e as Error).message });
    }
  };
  if (state === "done") return <Done label="Task created" icon={icon} />;
  if (icon)
    return (
      <IconAction label={label} onClick={go} disabled={state === "busy"}>
        <ListPlus className="size-4" strokeWidth={1.5} aria-hidden />
      </IconAction>
    );
  return (
    <Button size="sm" variant={variant ?? (small ? "outline" : "default")} onClick={go} disabled={state === "busy"}>
      {state === "busy" ? "Creating…" : label}
    </Button>
  );
}

export function LogDecisionButton({
  campaign_id,
  kind,
  description,
  owner_name,
  icon = false,
}: {
  campaign_id: string;
  kind: string;
  description: string;
  owner_name?: string | null;
  /** Icon-only button with a tooltip (for row actions shown on hover). */
  icon?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const go = async () => {
    setState("busy");
    try {
      const r = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id, kind: kind === "maintain" ? "other" : kind, description, owner_name, source: "recommendation" }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setState("done");
      toast.success("Decision logged", { description });
      router.refresh();
    } catch (e) {
      setState("idle");
      toast.error("Could not log the decision", { description: (e as Error).message });
    }
  };
  if (state === "done") return <Done label="Decision logged" icon={icon} />;
  if (icon)
    return (
      <IconAction label="Log decision" onClick={go} disabled={state === "busy"}>
        <NotebookPen className="size-4" strokeWidth={1.5} aria-hidden />
      </IconAction>
    );
  return (
    <Button size="sm" variant="ghost" onClick={go} disabled={state === "busy"}>
      {state === "busy" ? "Logging…" : "Log decision"}
    </Button>
  );
}
