"use client";

/**
 * DataTable: TanStack Table on shadcn table styling.
 * - 36px rows (32px compact), 32px sticky header, horizontal row hairlines only:
 *   no outer box, no vertical lines, no zebra (Stripe-style).
 * - Numeric columns are right-aligned and tabular. The first column is sticky.
 * - Sortable headers (click or Enter): ascending, then descending, then the original order. Nulls always last.
 * - Server mode: pass `sort` + `onSortChange` and the rows are shown as given (the server sorts); the header
 *   click only reports the next state. Sorting is a view, never a data change.
 *
 * Server pages can use it directly: cells are pre-rendered ReactNodes and sort keys are plain
 * values, so no functions cross the server/client boundary.
 */
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";

export interface DataColumn {
  id: string;
  header: string;
  /** Right-aligned, tabular figures. */
  numeric?: boolean;
  /** Needs `sort` values on the rows. */
  sortable?: boolean;
  /** Extra classes for this column's cells and header (e.g. "w-24", "text-muted-foreground"). */
  className?: string;
  /** Header hint shown as a native tooltip (definitions, denominators). */
  title?: string;
}

export interface DataRow {
  id: string;
  cells: Record<string, React.ReactNode>;
  /** Sort keys per column id; null sorts last. */
  sort?: Record<string, number | string | null | undefined>;
  /** "selected" gets the light violet tint (no bar); decision tints are for scale/change/stop rows only. */
  state?: "selected" | "scale" | "change" | "stop" | "total" | "muted";
}

const ROW_STATE: Record<NonNullable<DataRow["state"]>, string> = {
  selected: "bg-primary-tint",
  scale: "bg-success-tint/50",
  change: "bg-warning-tint/50",
  stop: "bg-danger-tint/50",
  total: "font-semibold [&>td]:border-t",
  muted: "text-muted-foreground",
};

export function DataTable({
  columns,
  rows,
  empty,
  maxHeight,
  defaultSort,
  compact,
  caption,
  stickyFirstColumn = true,
  footerRows,
  sort,
  onSortChange,
  className,
}: {
  columns: DataColumn[];
  rows: DataRow[];
  empty?: { title: string; description?: React.ReactNode; action?: React.ReactNode };
  /** Scroll height; enables the sticky header within the table. Default: min(70vh, 640px). */
  maxHeight?: number | string;
  defaultSort?: { id: string; desc?: boolean };
  compact?: boolean;
  /** Screen-reader caption. */
  caption?: string;
  stickyFirstColumn?: boolean;
  /** Rows pinned after the sorted body (totals, unattributed). They don't sort. */
  footerRows?: DataRow[];
  /** Server-side sort (controlled). `null` = original order. */
  sort?: { id: string; desc: boolean } | null;
  onSortChange?: (next: { id: string; desc: boolean } | null) => void;
  className?: string;
}) {
  const [localSorting, setLocalSorting] = useState<SortingState>(defaultSort ? [{ id: defaultSort.id, desc: !!defaultSort.desc }] : []);
  const server = !!onSortChange;
  const sorting: SortingState = server ? (sort ? [{ id: sort.id, desc: sort.desc }] : []) : localSorting;
  const setSorting = (u: SortingState | ((old: SortingState) => SortingState)) => {
    const next = typeof u === "function" ? u(sorting) : u;
    if (server) onSortChange?.(next[0] ? { id: next[0].id, desc: next[0].desc } : null);
    else setLocalSorting(next);
  };

  const defs = useMemo<ColumnDef<DataRow>[]>(
    () =>
      columns.map((c) => ({
        id: c.id,
        header: c.header,
        enableSorting: !!c.sortable,
        accessorFn: (r: DataRow) => {
          const v = r.sort?.[c.id];
          return v === null ? undefined : v;
        },
        sortUndefined: "last",
        cell: (ctx) => ctx.row.original.cells[c.id] ?? null,
      })),
    [columns],
  );

  const table = useReactTable({
    data: rows,
    columns: defs,
    state: { sorting },
    onSortingChange: setSorting,
    // Every column cycles up, down, then back to the original order.
    sortDescFirst: false,
    enableSortingRemoval: true,
    manualSorting: server,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const colById = new Map(columns.map((c) => [c.id, c]));
  const rowH = compact ? "h-8" : "h-9";
  const cellCls = (c: DataColumn | undefined, i: number) =>
    cn(
      "px-3 whitespace-nowrap first:pl-0",
      c?.numeric && "text-right tabular",
      stickyFirstColumn && i === 0 && "sticky left-0 z-[1] bg-inherit",
      c?.className,
    );

  if (!rows.length && !footerRows?.length) {
    return (
      <div className={className}>
        <EmptyState title={empty?.title ?? "Nothing to show"} description={empty?.description} action={empty?.action} />
      </div>
    );
  }

  const renderStaticRow = (r: DataRow) => (
    <tr key={r.id} className={cn("border-b bg-card last:border-b-0", rowH, r.state && ROW_STATE[r.state])}>
      {columns.map((c, i) => (
        <td key={c.id} className={cellCls(c, i)}>
          {r.cells[c.id] ?? null}
        </td>
      ))}
    </tr>
  );

  return (
    <div className={cn("relative overflow-auto", className)} style={{ maxHeight: maxHeight ?? "min(70vh, 640px)" }}>
      <table className="w-full caption-bottom border-separate border-spacing-0 text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h, i) => {
                const c = colById.get(h.column.id);
                const sorted = h.column.getIsSorted();
                const canSort = h.column.getCanSort();
                return (
                  <th
                    key={h.id}
                    scope="col"
                    title={c?.title}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : canSort ? "none" : undefined}
                    className={cn(
                      "sticky top-0 z-[2] h-8 border-b bg-card px-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground first:pl-0",
                      c?.numeric && "text-right",
                      stickyFirstColumn && i === 0 && "left-0 z-[3]",
                      c?.className,
                    )}
                  >
                    {canSort ? (
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        title={sorted === "asc" ? "Sorted low to high. Click for high to low" : sorted === "desc" ? "Sorted high to low. Click for the original order" : "Click to sort low to high"}
                        className={cn(
                          "-mx-1 inline-flex items-center gap-1 rounded-sm px-1 transition-colors duration-(--dur-1) hover:text-foreground",
                          c?.numeric && "flex-row-reverse",
                          sorted && "text-foreground",
                        )}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "asc" ? (
                          <ArrowUp className="size-3.5" strokeWidth={1.75} aria-hidden />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="size-3.5" strokeWidth={1.75} aria-hidden />
                        ) : (
                          <ChevronsUpDown className="size-3.5 opacity-50" strokeWidth={1.75} aria-hidden />
                        )}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className={cn(
                "group bg-card transition-colors duration-(--dur-1) hover:bg-accent [&>td]:border-b",
                rowH,
                row.original.state && ROW_STATE[row.original.state],
              )}
            >
              {row.getVisibleCells().map((cell, i) => (
                <td key={cell.id} className={cellCls(colById.get(cell.column.id), i)}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={columns.length}>
                <EmptyState title={empty?.title ?? "Nothing to show"} description={empty?.description} action={empty?.action} />
              </td>
            </tr>
          )}
        </tbody>
        {footerRows?.length ? <tfoot>{footerRows.map(renderStaticRow)}</tfoot> : null}
      </table>
    </div>
  );
}
