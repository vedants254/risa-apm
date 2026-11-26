"use client";

/**
 * "Upload a dataset": pick files, the server reads, maps (fast path or the model), cleans and
 * returns a preview of the mapped tables; the user confirms once with "Import this data", which
 * replaces the current data. The browser never sends rows: the import re-reads the stored file.
 */
import { Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DataTable, type DataColumn, type DataRow } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const MAX_MB = 4;
const ACCEPT = ".xlsx,.csv,.json";

type Cell = string | number | null;
interface TablePreview {
  table: string;
  label: string;
  origin: "file" | "built" | "empty";
  source: string | null;
  row_count: number;
  columns: string[];
  rows: Record<string, Cell>[];
}
interface Preview {
  upload_id: string;
  files: string[];
  mode: "fast" | "ai";
  model?: string;
  tables: TablePreview[];
  side_tables: { table: string; sheet: string; row_count: number }[];
  summary: string;
  blocking: string[];
  error?: string;
}

type Step = { kind: "pick"; error?: string } | { kind: "reading"; files: string[] } | { kind: "preview"; p: Preview } | { kind: "importing"; p: Preview };

const fmt = (n: number) => n.toLocaleString("en-IN");

function sourceLine(t: TablePreview): string {
  if (t.origin === "file") return `From ${t.source}`;
  if (t.origin === "built")
    return t.table === "event"
      ? "Built from the data's date range"
      : t.table === "people"
        ? "Built from registrations and check-ins"
        : t.table === "registration_history"
          ? "Built from registrations: each counts as confirmed when made"
          : t.table === "campaigns"
            ? "Built from the campaign names in daily marketing"
            : "Built from the other tables";
  return t.table === "targets" ? "Not in the file, so goals show as missing" : "Not in the file";
}

function TablePane({ t }: { t: TablePreview }) {
  const columns: DataColumn[] = t.columns.map((c) => ({ id: c, header: c, numeric: t.rows.some((r) => typeof r[c] === "number") }));
  const rows: DataRow[] = t.rows.map((r, i) => ({
    id: String(i),
    cells: Object.fromEntries(
      t.columns.map((c) => {
        const v = r[c];
        const s = v === null || v === undefined ? "" : String(v);
        return [c, s === "" ? <span className="text-muted-foreground">—</span> : s.length > 40 ? <span title={s}>{`${s.slice(0, 40)}…`}</span> : s];
      }),
    ),
  }));
  return (
    <div className="min-w-0">
      <p className="mb-2 text-[13px] text-foreground">
        {sourceLine(t)}
        {t.row_count > 0 && (
          <span className="text-muted-foreground">
            {" "}
            ({fmt(t.row_count)} rows{t.row_count > t.rows.length ? `, first ${t.rows.length} shown` : ""})
          </span>
        )}
      </p>
      <DataTable columns={columns} rows={rows} compact maxHeight={420} className="rounded-none border-0" caption={`${t.label} preview`} empty={{ title: "No rows" }} />
    </div>
  );
}

function PreviewView({ p }: { p: Preview }) {
  // Open on the busiest table people care about first: daily spend, else whatever has rows.
  const [tab, setTab] = useState(
    (["daily_marketing", "campaigns", "registrations"].find((k) => p.tables.some((t) => t.table === k && t.row_count > 0)) ??
      p.tables.find((t) => t.row_count > 0)?.table ??
      p.tables[0]?.table) as string,
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground">
        <span className="font-medium">{p.files.join(", ")}</span>
        <span className="text-muted-foreground"> {p.mode === "fast" ? "matched the expected layout" : `was mapped by ${p.model ?? "the AI model"}`}</span>
      </p>
      {p.blocking.length > 0 ? (
        <div role="alert" className="rounded-xl bg-danger-tint px-4 py-3 text-sm text-foreground">
          <p className="font-medium">This file can&apos;t be imported</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {p.blocking.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-foreground">{p.summary}</p>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList variant="line" className="w-max">
            {p.tables.map((t) => (
              <TabsTrigger key={t.table} value={t.table} className={cn("flex-none", t.row_count === 0 && "text-muted-foreground")}>
                {t.label}
                <span className="tabular text-muted-foreground">{fmt(t.row_count)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {p.tables.map((t) => (
          <TabsContent key={t.table} value={t.table} className="pt-3">
            <TablePane t={t} />
          </TabsContent>
        ))}
      </Tabs>
      {p.side_tables.length > 0 && (
        <p className="text-[13px] text-foreground">
          Other sheets are kept as extra tables the analyst can query:{" "}
          {p.side_tables.map((s) => `${s.sheet} (${fmt(s.row_count)} rows)`).join(", ")}.
        </p>
      )}
    </div>
  );
}

export default function DatasetUpload({ autoOpen = false }: { autoOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Settings links here with ?upload=1; open once and drop the flag from the URL.
  useEffect(() => {
    if (!autoOpen) return;
    setOpen(true);
    const u = new URL(window.location.href);
    u.searchParams.delete("upload");
    router.replace(`${u.pathname}${u.search}`, { scroll: false });
  }, [autoOpen, router]);

  const reset = () => {
    // Discard an analysed but not imported upload on the server too.
    if (step.kind === "preview")
      fetch("/api/dataset/import", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ upload_id: step.p.upload_id }) }).catch(() => {});
    setStep({ kind: "pick" });
    if (input.current) input.current.value = "";
  };

  const analyze = async (list: FileList | File[]) => {
    const files = [...list];
    if (!files.length) return;
    const bad = files.find((f) => !/\.(xlsx|csv|json)$/i.test(f.name));
    if (bad) return setStep({ kind: "pick", error: `${bad.name} is not an .xlsx, .csv or .json file.` });
    const total = files.reduce((a, f) => a + f.size, 0);
    if (total > MAX_MB * 1048576)
      return setStep({ kind: "pick", error: `These files are ${(total / 1048576).toFixed(1)} MB. The limit is ${MAX_MB} MB in total.` });
    setStep({ kind: "reading", files: files.map((f) => f.name) });
    const form = new FormData();
    for (const f of files) form.append("files", f);
    try {
      const r = await fetch("/api/dataset/analyze", { method: "POST", body: form });
      const j = (await r.json().catch(() => ({ error: `The server answered ${r.status}.` }))) as Preview;
      if (j.error) return setStep({ kind: "pick", error: j.error });
      setStep({ kind: "preview", p: j });
    } catch (e) {
      setStep({ kind: "pick", error: `Could not reach the server (${(e as Error).message}).` });
    }
  };

  const doImport = async (p: Preview) => {
    setStep({ kind: "importing", p });
    try {
      const r = await fetch("/api/dataset/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_id: p.upload_id }),
      });
      const j = (await r.json()) as { error?: string; dataset?: string };
      if (j.error) {
        toast.error("Import failed", { description: j.error });
        return setStep({ kind: "preview", p });
      }
      toast.success(`Imported ${p.files.join(", ")}`, { description: "Every page now runs on this data." });
      setOpen(false);
      setStep({ kind: "pick" });
      // The old snapshot date may be outside the new data; drop it so the default applies.
      router.replace("/data");
      router.refresh();
    } catch (e) {
      toast.error("Import failed", { description: (e as Error).message });
      setStep({ kind: "preview", p });
    }
  };

  const busy = step.kind === "reading" || step.kind === "importing";
  const preview = step.kind === "preview" || step.kind === "importing" ? step.p : null;

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Upload strokeWidth={1.75} aria-hidden />
        Upload a dataset
      </Button>
      <Sheet
        open={open}
        onOpenChange={(o) => {
          if (busy) return;
          setOpen(o);
          if (!o) reset();
        }}
      >
        <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[min(1120px,94vw)]">
          <SheetHeader className="px-6 pt-5 pb-2">
            <SheetTitle className="text-base font-semibold">{preview ? "Review the import" : "Upload a dataset"}</SheetTitle>
            <SheetDescription className="sr-only">Upload attendee-growth data, review how it maps onto the app&apos;s tables, then import it.</SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
            {step.kind === "pick" && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  analyze(e.dataTransfer.files);
                }}
                className={cn(
                  "flex flex-col items-center gap-3 rounded-2xl bg-muted px-6 py-14 text-center transition-colors duration-(--dur-1)",
                  dragging && "bg-primary-tint",
                )}
              >
                <p className="max-w-md text-sm text-foreground">
                  Drop an Excel workbook, CSV files (one per table) or JSON here, up to {MAX_MB} MB. The app maps the columns onto its tables, cleans
                  the rows and shows you the result before anything changes.
                </p>
                <Button variant="outline" className="ring-1 ring-border" onClick={() => input.current?.click()}>
                  Choose files
                </Button>
                <input
                  ref={input}
                  type="file"
                  accept={ACCEPT}
                  multiple
                  className="sr-only"
                  aria-label="Choose dataset files"
                  onChange={(e) => e.target.files && analyze(e.target.files)}
                />
                {step.error && (
                  <p role="alert" className="max-w-md text-sm text-destructive">
                    {step.error}
                  </p>
                )}
              </div>
            )}

            {step.kind === "reading" && (
              <div className="flex items-center gap-3 py-14 text-sm text-foreground" aria-live="polite">
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
                Reading and mapping {step.files.join(", ")}…
              </div>
            )}

            {preview && <PreviewView p={preview} />}
          </div>

          {preview && (
            <SheetFooter className="flex-row flex-wrap items-center justify-end gap-3 px-6 py-4">
              <p className="mr-auto max-w-xl text-[13px] text-foreground">
                Importing replaces the current data, edits, tasks and analyst history. Reset to original data brings back the provided dataset.
              </p>
              <Button variant="ghost" disabled={busy} onClick={reset}>
                Cancel
              </Button>
              <Button disabled={busy || preview.blocking.length > 0} onClick={() => doImport(preview)}>
                {step.kind === "importing" ? "Importing…" : "Import this data"}
              </Button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
