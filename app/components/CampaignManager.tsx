"use client";

/**
 * Campaign editing: a "New campaign" dialog for the page header and a per-row actions menu
 * (edit sheet, status changes, open funnel) for the results table. Every change PATCHes or POSTs
 * /api/campaigns exactly as before, then refreshes the server page.
 */
import { CirclePause, CirclePlay, CircleStop, Filter, MoreHorizontal, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useShell } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { CAMPAIGN_STATUS_OPTIONS, Field, FormError, OptionSelect, api } from "@/components/manage/form";

export interface CampaignRowData {
  campaign_id: string;
  campaign_name: string;
  channel: string;
  status: string;
  owner_name: string | null;
  planned_budget_inr: number | null;
  notes: string | null;
  updated_at: string | null;
  objective?: string | null;
}

const STATUS_VERB: Record<string, string> = { active: "Campaign activated", paused: "Campaign paused", stopped: "Campaign stopped" };

function ownerOptions(owners: string[]) {
  return owners.map((o) => ({ value: o, label: o }));
}

/** Status, owner, planned budget and notes in a side sheet. */
function EditCampaignSheet({
  c,
  owners,
  open,
  onOpenChange,
}: {
  c: CampaignRowData;
  owners: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const init = () => ({ status: c.status, owner_name: c.owner_name ?? "", planned_budget_inr: c.planned_budget_inr ?? "", notes: c.notes ?? "" });
  const [f, setF] = useState<{ status: string; owner_name: string; planned_budget_inr: number | string; notes: string }>(init);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const idp = `cm-${c.campaign_id}`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const j = await api(`/api/campaigns/${c.campaign_id}`, "PATCH", f);
    setBusy(false);
    if (j.error) return setErr(j.error);
    setErr("");
    onOpenChange(false);
    toast.success("Campaign updated", { description: c.campaign_name });
    router.refresh();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setF(init());
          setErr("");
        }
        onOpenChange(o);
      }}
    >
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <form onSubmit={save} className="flex h-full flex-col">
          <SheetHeader className="px-5 pt-5 pb-1">
            <SheetTitle className="text-base font-semibold">{c.campaign_name}</SheetTitle>
            <SheetDescription className="text-[13px]">
              <span className="font-mono text-xs">{c.campaign_id}</span> · {c.channel}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <Field id={`${idp}-status`} label="Status">
                <OptionSelect id={`${idp}-status`} value={f.status} onChange={(v) => setF({ ...f, status: v })} options={CAMPAIGN_STATUS_OPTIONS} />
              </Field>
              <Field id={`${idp}-owner`} label="Owner">
                <OptionSelect
                  id={`${idp}-owner`}
                  value={f.owner_name}
                  onChange={(v) => setF({ ...f, owner_name: v })}
                  options={ownerOptions(owners)}
                  noneLabel="Unassigned"
                />
              </Field>
            </div>
            <Field id={`${idp}-budget`} label="Planned budget (₹)">
              <Input
                id={`${idp}-budget`}
                type="number"
                inputMode="numeric"
                min={0}
                className="tabular"
                value={f.planned_budget_inr}
                onChange={(e) => setF({ ...f, planned_budget_inr: e.target.value })}
              />
            </Field>
            <Field id={`${idp}-notes`} label="Notes">
              <Textarea id={`${idp}-notes`} rows={4} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </Field>
            <FormError>{err}</FormError>
          </div>
          <SheetFooter className="flex-row justify-end px-5 py-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Row actions for the results table. Hidden until the row is hovered or the menu is focused,
 * so the table reads as data first.
 */
export function CampaignRowActions({ campaign: c, owners }: { campaign: CampaignRowData; owners: string[] }) {
  const router = useRouter();
  const { withDate } = useShell();
  const [editing, setEditing] = useState(false);

  const setStatus = async (status: string) => {
    const j = await api(`/api/campaigns/${c.campaign_id}`, "PATCH", { status });
    if (j.error) return toast.error("Could not change the status", { description: j.error });
    toast.success(STATUS_VERB[status] ?? "Status changed", { description: c.campaign_name });
    router.refresh();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Actions for ${c.campaign_name}`}
            className="text-muted-foreground opacity-0 transition-opacity duration-(--dur-1) group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <MoreHorizontal className="size-4" strokeWidth={1.5} aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil strokeWidth={1.5} aria-hidden />
            Edit campaign
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`${withDate("/funnel")}&c=${encodeURIComponent(c.campaign_id)}`}>
              <Filter strokeWidth={1.5} aria-hidden />
              Open funnel
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {c.status !== "active" && (
            <DropdownMenuItem onSelect={() => setStatus("active")}>
              <CirclePlay strokeWidth={1.5} aria-hidden />
              Activate
            </DropdownMenuItem>
          )}
          {c.status !== "paused" && (
            <DropdownMenuItem onSelect={() => setStatus("paused")}>
              <CirclePause strokeWidth={1.5} aria-hidden />
              Pause
            </DropdownMenuItem>
          )}
          {c.status !== "stopped" && (
            <DropdownMenuItem variant="destructive" onSelect={() => setStatus("stopped")}>
              <CircleStop strokeWidth={1.5} aria-hidden />
              Stop
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <EditCampaignSheet c={c} owners={owners} open={editing} onOpenChange={setEditing} />
    </>
  );
}

/** The page's one primary action. */
export function NewCampaignButton({ owners }: { owners: string[] }) {
  const router = useRouter();
  const blank = () => ({ campaign_name: "", channel: "", owner_name: owners[0] ?? "", planned_budget_inr: "", status: "active", notes: "" });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blank);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const j = await api<{ campaign_id?: string }>("/api/campaigns", "POST", f);
    setBusy(false);
    if (j.error) return setErr(j.error);
    setOpen(false);
    toast.success("Campaign created", { description: f.campaign_name });
    router.refresh();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setF(blank());
          setErr("");
        }
        setOpen(o);
      }}
    >
      <Button onClick={() => setOpen(true)}>
        <Plus strokeWidth={1.5} aria-hidden />
        New campaign
      </Button>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={add} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New campaign</DialogTitle>
            <DialogDescription className="sr-only">Name, channel, owner, planned budget, status and notes for the new campaign.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field id="nc-name" label="Name" className="col-span-2">
              <Input id="nc-name" required autoFocus value={f.campaign_name} onChange={(e) => setF({ ...f, campaign_name: e.target.value })} />
            </Field>
            <Field id="nc-channel" label="Channel">
              <Input id="nc-channel" placeholder="e.g. whatsapp" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} />
            </Field>
            <Field id="nc-owner" label="Owner">
              <OptionSelect id="nc-owner" value={f.owner_name} onChange={(v) => setF({ ...f, owner_name: v })} options={ownerOptions(owners)} noneLabel="Unassigned" />
            </Field>
            <Field id="nc-budget" label="Planned budget (₹)">
              <Input
                id="nc-budget"
                type="number"
                inputMode="numeric"
                min={0}
                className="tabular"
                value={f.planned_budget_inr}
                onChange={(e) => setF({ ...f, planned_budget_inr: e.target.value })}
              />
            </Field>
            <Field id="nc-status" label="Status">
              <OptionSelect id="nc-status" value={f.status} onChange={(v) => setF({ ...f, status: v })} options={CAMPAIGN_STATUS_OPTIONS} />
            </Field>
            <Field id="nc-notes" label="Notes" className="col-span-2">
              <Textarea id="nc-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </Field>
          </div>
          <FormError>{err}</FormError>
          <DialogFooter className="mx-0 mb-0 border-t-0 bg-transparent p-0 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !f.campaign_name.trim()}>
              {busy ? "Creating…" : "Create campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
