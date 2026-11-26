"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useShell } from "./shell-context";
import { fmtFull } from "./timeline/model";

interface Thresholds {
  scale_cac_ratio: number;
  min_volume: number;
  stop_cac_ratio: number;
  stop_showup_ratio: number;
  bad_stage_ratio: number;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-foreground tabular">{children}</span>
    </div>
  );
}

/** Dataset, analyst model status, decision thresholds and the data reset. Reads existing APIs only. */
export default function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { withDate, range } = useShell();
  const [ds, setDs] = useState<{ name: string; kind: string; imported_at: string | null } | null>(null);
  const [llm, setLlm] = useState<{ provider: string; model: string; configured: boolean } | null>(null);
  const [th, setTh] = useState<Thresholds | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/dataset", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setDs(j?.error ? null : j))
      .catch(() => setDs(null));
    fetch("/api/tools", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setLlm(j?.llm ?? null))
      .catch(() => setLlm(null));
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setTh(j?.thresholds ?? null))
      .catch(() => setTh(null));
  }, [open]);

  const reset = async () => {
    setResetting(true);
    try {
      const j = await (await fetch("/api/reset", { method: "POST" })).json();
      if (j.error) toast.error("Reset failed", { description: String(j.error) });
      else toast.success("Original data restored");
      // Drop a snapshot date from the previous dataset; the default applies.
      router.replace(window.location.pathname);
      router.refresh();
    } catch (e) {
      toast.error("Reset failed", { description: (e as Error).message });
    } finally {
      setResetting(false);
      setConfirmReset(false);
      onOpenChange(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="gap-5 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription className="sr-only">Dataset, analyst model, decision thresholds and data reset.</DialogDescription>
          </DialogHeader>

          <section>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">Dataset</h3>
            <Row label="Name">{ds ? ds.name : "…"}</Row>
            <Row label="Imported">{ds?.imported_at ? `${ds.imported_at.slice(0, 16)} IST` : "…"}</Row>
            <Row label="History">
              {fmtFull(range.start)} to {fmtFull(range.end)}
            </Row>
            <Row label="Event">
              {range.eventStart === range.eventEnd ? fmtFull(range.eventStart) : `${fmtFull(range.eventStart)} to ${fmtFull(range.eventEnd)}`}
            </Row>
          </section>

          <section>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">Analyst</h3>
            <Row label="Model">{llm ? `${llm.provider} ${llm.model}` : "…"}</Row>
            <Row label="API key">{llm ? (llm.configured ? "Set" : "Missing, set OPENAI_API_KEY") : "…"}</Row>
          </section>

          <section>
            <div className="mb-1 flex items-baseline justify-between">
              <h3 className="text-xs font-medium text-muted-foreground">Decision thresholds</h3>
              <Link href={withDate("/diagnose")} onClick={() => onOpenChange(false)} className="text-xs font-medium text-primary hover:underline">
                Edit
              </Link>
            </div>
            {th ? (
              <>
                <Row label="Scale when cost is below">{th.scale_cac_ratio}× median</Row>
                <Row label="Minimum volume">{th.min_volume}</Row>
                <Row label="Change when a stage is below">{th.bad_stage_ratio}× overall</Row>
                <Row label="Stop when cost is above">{th.stop_cac_ratio}× median</Row>
                <Row label="Stop when show-up is below">{th.stop_showup_ratio}× median</Row>
              </>
            ) : (
              <Row label="Loading">…</Row>
            )}
          </section>

          <section className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" asChild>
              <Link href={`${withDate("/data").split("?")[0]}?upload=1`} onClick={() => onOpenChange(false)}>
                Upload a dataset
              </Link>
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setConfirmReset(true)}>
              Reset to original data
            </Button>
          </section>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to the original data?</AlertDialogTitle>
            <AlertDialogDescription>
              This drops every data edit, campaign change, task, action item and the analyst history, then reloads the original workbook. It
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetting}
              onClick={(e) => {
                e.preventDefault();
                reset();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {resetting ? "Resetting…" : "Reset data"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
