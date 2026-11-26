/**
 * Bring-your-own-dataset pipeline:
 *
 *   parse → map (fast path, or the model proposes) → apply → clean → validate → preview → import
 *
 * The model only proposes names (which sheet and column feeds what, and value maps). Code applies
 * the mapping to every row, cleans, validates, and on import re-reads the stored file on the
 * server and replaces the whole dataset in one transaction (lib/seed.ts seedTables).
 */
import type { Param } from "../db";
import { getDb } from "../db";
import { seedTables, type SeedReport } from "../seed";
import { proposeMapping } from "./ai";
import { cleanTables, cleaningSummary, type CleanReport, type CleanResult, type TableOrigin } from "./clean";
import { applyMapping, fastPathMapping, type DatasetMapping, type SideTable } from "./mapping";
import { parseFiles, type SourceSheet } from "./parse";
import { RAW_TABLES, TABLE_LABELS, TABLE_NAMES, type TableName } from "./schema";
import { deleteUpload, readUpload, saveUpload, writeMeta } from "./store";

export const PREVIEW_ROWS = 15;

export interface TablePreview {
  table: TableName;
  label: string;
  origin: TableOrigin;
  source: string | null;
  row_count: number;
  columns: string[];
  rows: Record<string, Param>[];
}
export interface DatasetPreview {
  upload_id: string;
  files: string[];
  mode: "fast" | "ai";
  model?: string;
  tables: TablePreview[];
  side_tables: { table: string; sheet: string; row_count: number }[];
  summary: string;
  blocking: string[];
  range: { from: string | null; to: string | null };
}

export interface Built {
  clean: CleanResult;
  sideTables: SideTable[];
  blocking: string[];
}

/** Apply, clean and validate. Shared by the preview and the import so both see the same rows. */
export function buildDataset(sheets: SourceSheet[], mapping: DatasetMapping, datasetName: string): Built {
  const { tables, sideTables } = applyMapping(sheets, mapping);
  const clean = cleanTables(tables, mapping, datasetName);
  const T = clean.tables;
  const blocking: string[] = [];
  if (!T.daily_marketing.length)
    blocking.push("No daily marketing spend found. The file needs rows with a date, a campaign and a spend amount.");
  if (!T.registrations.length && !T.people.filter((p) => p.person_type === "external").length)
    blocking.push("No registrations or attendee records found.");
  // The model's own refusal only adds information when the checks above found nothing.
  if (!mapping.can_import && !blocking.length) blocking.push(mapping.reason || "This file does not hold attendee-growth data.");
  return { clean, sideTables, blocking };
}

const nameOf = (files: { name: string }[]) => {
  const s = files.map((f) => f.name).join(", ");
  return s.length > 120 ? `${files[0].name} and ${files.length - 1} more` : s;
};
const eventName = (files: { name: string }[]) => files[0].name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();

function preview(id: string, files: string[], mode: "fast" | "ai", model: string | undefined, mapping: DatasetMapping, built: Built): DatasetPreview {
  const { clean } = built;
  const tables = TABLE_NAMES.map((t): TablePreview => {
    const spec = RAW_TABLES.find((s) => s.table === t)!;
    const rows = clean.tables[t];
    const extras = (clean.extras[t] ?? []).map((e) => e.column);
    return {
      table: t,
      label: TABLE_LABELS[t],
      origin: clean.origin[t],
      source: mapping.tables[t]?.source.join(", ") || null,
      row_count: rows.length,
      columns: [...Object.keys(spec.columns), ...extras],
      rows: rows.slice(0, PREVIEW_ROWS),
    };
  });
  const ev = clean.tables.event[0];
  return {
    upload_id: id,
    files,
    mode,
    model,
    tables,
    side_tables: built.sideTables.map((s) => ({ table: s.name, sheet: s.sheet, row_count: s.rows.length })),
    summary: cleaningSummary(clean.report),
    blocking: built.blocking,
    range: { from: (ev?.history_start as string) ?? null, to: (ev?.history_end as string) ?? null },
  };
}

/** Store the upload, map it (fast path or model), and return the cleaned preview. */
export async function analyzeUpload(files: { name: string; buf: Buffer }[]): Promise<DatasetPreview> {
  const meta = await saveUpload(files);
  try {
    const sheets = await parseFiles(files);
    let mapping = fastPathMapping(sheets);
    let mode: "fast" | "ai" = "fast";
    let model: string | undefined;
    if (!mapping) {
      const p = await proposeMapping(sheets);
      mapping = p.mapping;
      mode = "ai";
      model = p.model;
    }
    Object.assign(meta, { mapping, mode, model });
    await writeMeta(meta);
    const built = buildDataset(sheets, mapping, eventName(meta.files));
    return preview(meta.id, meta.files.map((f) => f.name), mode, model, mapping, built);
  } catch (e) {
    await deleteUpload(meta.id);
    throw e;
  }
}

/** Re-read the stored upload, re-apply the stored mapping to every row, and replace the dataset. */
export async function importUpload(id: string): Promise<SeedReport & { summary: string }> {
  const { meta, files } = await readUpload(id);
  if (!meta.mapping) throw new Error("This upload was not analysed. Upload the file again.");
  const sheets = await parseFiles(files);
  const built = buildDataset(sheets, meta.mapping, eventName(meta.files));
  if (built.blocking.length) throw new Error(`Can't import: ${built.blocking.join(" ")}`);
  const { log: _log, ...counts } = built.clean.report;
  void _log;
  const report = await seedTables({
    tables: built.clean.tables,
    extras: built.clean.extras,
    sideTables: built.sideTables,
    source: {
      name: nameOf(meta.files),
      kind: "upload",
      mapping: meta.mapping,
      cleaning: { ...counts, mode: meta.mode, model: meta.model ?? null } as Record<string, unknown>,
    },
  });
  await deleteUpload(id);
  return { ...report, summary: cleaningSummary(built.clean.report as CleanReport) };
}

export interface DatasetInfo {
  name: string;
  kind: string;
  imported_at: string | null;
  data_version: string;
  event_name: string;
  history_start: string;
  history_end: string;
  event_starts_at: string;
  event_ends_at: string;
}

/** The active dataset, for Settings and the shell. */
export async function getDatasetInfo(): Promise<DatasetInfo> {
  const { loadData } = await import("../metrics");
  const data = await loadData();
  const db = getDb();
  const meta = new Map((await db.all<{ key: string; value: string }>("SELECT key, value FROM app_meta")).map((r) => [r.key, r.value]));
  const active = await db.get<{ source_name: string; source_kind: string; imported_at: string }>(
    "SELECT source_name, source_kind, imported_at FROM dataset_versions WHERE is_active = 1",
  );
  return {
    name: active?.source_name ?? meta.get("dataset_name") ?? "",
    kind: active?.source_kind ?? meta.get("dataset_kind") ?? "original",
    imported_at: active?.imported_at ?? meta.get("seeded_at") ?? null,
    data_version: data.version,
    event_name: data.event.event_name,
    history_start: data.event.history_start,
    history_end: data.event.history_end,
    event_starts_at: data.event.event_starts_at,
    event_ends_at: data.event.event_ends_at,
  };
}
