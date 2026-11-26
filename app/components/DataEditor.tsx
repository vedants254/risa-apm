"use client";

/**
 * Raw table editor. Reads /api/tables/:table (server-side search, sort and paging) and writes
 * rows with POST / PATCH / DELETE exactly as before. Edits open in a side sheet; deletes and the
 * reset ask first. Every metric recomputes from these rows, so the page refreshes after a write.
 */
import { ChevronLeft, ChevronRight, Pencil, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DataTable, TableSkeleton, type DataColumn, type DataRow } from "@/components/shared";
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
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field, FormError, OptionSelect, api } from "@/components/manage/form";
import { cn } from "@/lib/utils";

interface Col {
  name: string;
  type: "text" | "int" | "date" | "ts";
}
interface Page {
  table: string;
  columns: Col[];
  id_column: string;
  rows: Record<string, unknown>[];
  total: number;
  duplicate_copies: number;
  limit: number;
  offset: number;
  error?: string;
}

const TABLES: { value: string; label: string }[] = [
  { value: "daily_marketing", label: "Daily marketing" },
  { value: "targets", label: "Targets" },
  { value: "campaigns", label: "Campaigns" },
  { value: "people", label: "People" },
  { value: "registrations", label: "Registrations" },
  { value: "registration_history", label: "Registration history" },
  { value: "checkins", label: "Check-ins" },
  { value: "interactions", label: "Interest and engagement" },
  { value: "event", label: "Event" },
];

// Readable labels are derived from IDs on save; hide them from the add form for daily rows.
const DERIVED: Record<string, string[]> = { daily_marketing: ["campaign_name", "owner_name", "owner_id"] };

const PLACEHOLDER: Record<Col["type"], string> = { date: "YYYY-MM-DD", ts: "YYYY-MM-DD HH:MM", int: "0", text: "" };

type Editing = { mode: "add" } | { mode: "edit"; rid: string; row: Record<string, unknown> };

/** Add or edit one row in a side sheet. The stable ID is read-only when editing. */
function RowSheet({
  editing,
  onClose,
  table,
  tableLabel,
  cols,
  idColumn,
  onSaved,
}: {
  editing: Editing | null;
  onClose: () => void;
  table: string;
  tableLabel: string;
  cols: Col[];
  idColumn: string;
  onSaved: (text: string) => Promise<void>;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const adding = editing?.mode === "add";
  const fields = adding ? cols.filter((c) => !(DERIVED[table] ?? []).includes(c.name)) : cols;

  useEffect(() => {
    if (!editing) return;
    setErr("");
    setVals(
      editing.mode === "add"
        ? Object.fromEntries(cols.map((c) => [c.name, ""]))
        : Object.fromEntries(cols.map((c) => [c.name, String(editing.row[c.name] ?? "")])),
    );
  }, [editing, cols]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    const j =
      editing.mode === "add"
        ? await api(`/api/tables/${table}`, "POST", Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== "")))
        : await api(
            `/api/tables/${table}/${encodeURIComponent(editing.rid)}`,
            "PATCH",
            Object.fromEntries(Object.entries(vals).filter(([k, v]) => String(editing.row[k] ?? "") !== v)),
          );
    setBusy(false);
    if (j.error) return setErr(j.error);
    onClose();
    await onSaved(editing.mode === "add" ? "Row added" : "Row updated");
  };

  return (
    <Sheet open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <form onSubmit={save} className="flex h-full min-h-0 flex-col">
          <SheetHeader className="px-5 pt-5 pb-1">
            <SheetTitle className="text-base font-semibold">{adding ? `New ${tableLabel.toLowerCase()} row` : "Edit row"}</SheetTitle>
            <SheetDescription className="text-[13px]">
              {adding ? (
                table === "daily_marketing" ? (
                  "Campaign name and owner come from campaign_id. activity_id is generated if blank."
                ) : (
                  <span className="sr-only">Fill in the fields for the new row.</span>
                )
              ) : (
                <>
                  <span className="font-mono text-xs">
                    {idColumn} {String(editing?.mode === "edit" ? editing.row[idColumn] ?? "" : "")}
                  </span>
                </>
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {fields.map((c) => {
              const locked = !adding && c.name === idColumn;
              const id = `row-${c.name}`;
              return (
                <Field
                  key={c.name}
                  id={id}
                  label={<span className="font-mono text-xs font-normal">{c.name}</span>}
                >
                  <Input
                    id={id}
                    disabled={locked}
                    inputMode={c.type === "int" ? "numeric" : undefined}
                    placeholder={PLACEHOLDER[c.type]}
                    className={cn(c.type !== "text" && "tabular")}
                    value={vals[c.name] ?? ""}
                    onChange={(e) => setVals((v) => ({ ...v, [c.name]: e.target.value }))}
                  />
                </Field>
              );
            })}
            <FormError>{err}</FormError>
          </div>
          <SheetFooter className="flex-row justify-end px-5 py-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : adding ? "Add row" : "Save changes"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export default function DataEditor() {
  const router = useRouter();
  const [table, setTable] = useState("daily_marketing");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<{ rid: string; label: string } | null>(null);

  // Debounce typing so each keystroke doesn't refetch.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(q);
      setOffset(0);
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ limit: "50", offset: String(offset) });
    if (query) p.set("q", query);
    if (sort) p.set("sort", sort);
    const j = await api<Page>(`/api/tables/${table}?${p}`, "GET");
    setPage(j);
    setLoading(false);
  }, [table, query, offset, sort]);
  useEffect(() => {
    load();
  }, [load]);

  const afterWrite = async (text: string) => {
    toast.success(text, { description: "Every metric has been recomputed." });
    await load();
    router.refresh();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const d = deleting;
    setDeleting(null);
    const j = await api(`/api/tables/${table}/${encodeURIComponent(d.rid)}`, "DELETE");
    if (j.error) return toast.error("Could not delete the row", { description: j.error });
    await afterWrite("Row deleted");
  };

  const cols = useMemo(() => page?.columns ?? [], [page]);
  const idColumn = page?.id_column ?? "";
  const tableLabel = TABLES.find((t) => t.value === table)?.label ?? table;
  // The stable ID goes first so it is the sticky column and carries the row actions.
  const ordered = useMemo(() => [...cols.filter((c) => c.name === idColumn), ...cols.filter((c) => c.name !== idColumn)], [cols, idColumn]);

  const columns: DataColumn[] = ordered.map((c) => ({
    id: c.name,
    header: c.name,
    numeric: c.type === "int",
    sortable: true,
    className: c.name === idColumn ? "min-w-[160px]" : undefined,
  }));
  const rows: DataRow[] = (page?.rows ?? []).map((r) => {
    const rid = String(r._rid);
    const cells: Record<string, React.ReactNode> = {};
    for (const c of ordered) {
      const v = r[c.name];
      const s = v === null || v === undefined ? "" : String(v);
      if (c.name === idColumn) {
        cells[c.name] = (
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-foreground">{s}</span>
            <span className="flex items-center opacity-0 transition-opacity duration-(--dur-1) group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
              <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`Edit ${idColumn} ${s}`} onClick={() => setEditing({ mode: "edit", rid, row: r })}>
                <Pencil className="size-4" strokeWidth={1.5} aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
                aria-label={`Delete ${idColumn} ${s}`}
                onClick={() => setDeleting({ rid, label: `${idColumn} ${s}` })}
              >
                <Trash2 className="size-4" strokeWidth={1.5} aria-hidden />
              </Button>
            </span>
          </div>
        );
      } else if (c.type === "text" && s.length > 32) {
        cells[c.name] = (
          <span className="block max-w-[280px] truncate" title={s}>
            {s}
          </span>
        );
      } else {
        cells[c.name] = s === "" ? <span className="text-muted-foreground">—</span> : s;
      }
    }
    return { id: rid, cells };
  });

  return (
    <div>
      <div className="mb-2 -ml-2 flex flex-wrap items-center gap-1">
        <OptionSelect
          size="sm"
          value={table}
          onChange={(v) => {
            setTable(v);
            setOffset(0);
            setQ("");
            setQuery("");
            setSort("");
            setEditing(null);
          }}
          options={TABLES}
          ariaLabel="Table"
          quiet
          className="text-[13px] font-medium"
        />
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.5} aria-hidden />
          <Input
            type="search"
            aria-label="Search text columns"
            placeholder="Search text columns"
            className="h-7 w-[200px] rounded-full border-transparent bg-transparent pl-8 text-[13px] shadow-none hover:bg-accent focus-visible:bg-card"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" disabled={!page || !!page.error} onClick={() => setEditing({ mode: "add" })}>
          <Plus strokeWidth={1.5} aria-hidden />
          Add row
        </Button>
      </div>

      {page?.error ? (
        <FormError>{page.error}</FormError>
      ) : !page ? (
        <TableSkeleton rows={8} columns={6} />
      ) : (
        <div className={cn("transition-opacity duration-(--dur-2)", loading && "opacity-60")} aria-busy={loading}>
          <DataTable
            columns={columns}
            rows={rows}
            compact
            maxHeight={560}
            className="rounded-none border-0"
            caption={`${tableLabel} rows`}
            // Header clicks sort on the server (all pages): up, down, then the original order. A view only.
            sort={sort ? { id: sort.replace(/^-/, ""), desc: sort.startsWith("-") } : null}
            onSortChange={(next) => {
              setSort(next ? `${next.desc ? "-" : ""}${next.id}` : "");
              setOffset(0);
            }}
            empty={{
              title: query ? "No rows match this search" : "This table is empty",
              action: query ? (
                <Button variant="ghost" size="sm" onClick={() => setQ("")}>
                  Clear search
                </Button>
              ) : undefined,
            }}
          />
        </div>
      )}

      {page && !page.error && (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted-foreground">
          {/* Row count and duplicate copies live here, beside paging, instead of a caption above the table. */}
          <span className="tabular" aria-live="polite">
            {page.total ? offset + 1 : 0}–{Math.min(offset + page.limit, page.total)} of {page.total.toLocaleString("en-IN")} rows
            {page.duplicate_copies ? `, ${page.duplicate_copies.toLocaleString("en-IN")} duplicate copies counted once` : ""}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - page.limit))}>
            <ChevronLeft className="size-4" strokeWidth={1.5} aria-hidden />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={offset + page.limit >= page.total} onClick={() => setOffset(offset + page.limit)}>
            <ChevronRight className="size-4" strokeWidth={1.5} aria-hidden />
          </Button>
        </div>
      )}

      <RowSheet editing={editing} onClose={() => setEditing(null)} table={table} tableLabel={tableLabel} cols={ordered} idColumn={idColumn} onSaved={afterWrite} />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this row?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono text-xs text-foreground">{deleting?.label}</span> and any import copies with the same ID will be removed, and every metric
              recomputes without them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              Delete row
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Reset to the seed dataset, behind a confirm. */
export function ResetButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    setBusy(true);
    const j = await api("/api/reset", "POST");
    setBusy(false);
    setOpen(false);
    if (j.error) return toast.error("Reset failed", { description: j.error });
    toast.success("Original data restored");
    router.replace(window.location.pathname);
    router.refresh();
  };
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" disabled={busy} onClick={() => setOpen(true)}>
        <RotateCcw strokeWidth={1.5} aria-hidden />
        {busy ? "Resetting…" : "Reset to original data"}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset to the original data?</AlertDialogTitle>
          <AlertDialogDescription>
            This drops every data edit, campaign change, task, action item and chat message, and reloads the seed dataset. It cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel variant="ghost">Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              reset();
            }}
          >
            {busy ? "Resetting…" : "Reset data"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
