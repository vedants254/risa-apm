/**
 * Read uploaded files into plain sheets: { name, headers, rows }. .xlsx (every worksheet),
 * .csv (one sheet per file, named after the file) and .json (an array of objects, or an
 * object of arrays keyed by sheet name). Values stay raw here; mapping and cleaning coerce them.
 */
import path from "node:path";
import ExcelJS from "exceljs";
import { cellValue } from "./schema";

export interface SourceSheet {
  name: string;
  file: string;
  headers: string[];
  rows: unknown[][];
}

export const SUPPORTED_EXTENSIONS = [".xlsx", ".csv", ".json"] as const;

/** Trim, collapse inner whitespace and drop a byte-order mark. */
export const normalizeHeader = (h: unknown) =>
  String(cellValue(h) ?? "")
    .replace(/^﻿/, "")
    .replace(/\s+/g, " ")
    .trim();

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

function finish(name: string, file: string, headers: string[], rows: unknown[][]): SourceSheet {
  // Name blank headers so their columns are not lost, and make duplicates unique.
  const seen = new Map<string, number>();
  const hs = headers.map((h, i) => {
    const base = h || `column ${i + 1}`;
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n > 1 ? `${base} (${n})` : base;
  });
  return { name, file, headers: hs, rows: rows.filter((r) => !r.every(isEmpty)) };
}

export async function parseXlsx(file: string, buf: Buffer): Promise<SourceSheet[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs types expect its own Buffer flavour; the runtime accepts a Node Buffer.
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: SourceSheet[] = [];
  wb.eachSheet((ws) => {
    const header = ((ws.getRow(1).values as unknown[]) ?? []).slice(1).map(normalizeHeader);
    while (header.length && !header[header.length - 1]) header.pop();
    if (!header.length) return;
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const vals = ((row.values as unknown[]) ?? []).slice(1).map(cellValue);
      rows.push(header.map((_, i) => vals[i] ?? null));
    });
    out.push(finish(ws.name.trim(), file, header, rows));
  });
  return out;
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF. The delimiter (, ; tab) is detected from the header line. */
export function parseCsvText(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1]);
  const delim = counts[0][1] > 1 ? counts[0][0] : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseCsv(file: string, buf: Buffer): SourceSheet[] {
  const all = parseCsvText(buf.toString("utf8"));
  if (!all.length) return [];
  const headers = all[0].map(normalizeHeader);
  const rows = all.slice(1).map((r) => headers.map((_, i) => (r[i] === undefined || r[i] === "" ? null : r[i])));
  return [finish(path.parse(file).name.trim(), file, headers, rows)];
}

function objectsToSheet(name: string, file: string, items: unknown[]): SourceSheet {
  const headers: string[] = [];
  for (const it of items) {
    if (it && typeof it === "object" && !Array.isArray(it)) for (const k of Object.keys(it)) if (!headers.includes(k)) headers.push(k);
  }
  const rows = items
    .filter((it) => it && typeof it === "object" && !Array.isArray(it))
    .map((it) =>
      headers.map((h) => {
        const v = (it as Record<string, unknown>)[h];
        return v !== null && typeof v === "object" ? JSON.stringify(v) : (v ?? null);
      }),
    );
  return finish(name, file, headers.map(normalizeHeader), rows);
}

export function parseJson(file: string, buf: Buffer): SourceSheet[] {
  let data: unknown;
  try {
    data = JSON.parse(buf.toString("utf8").replace(/^﻿/, ""));
  } catch (e) {
    throw new Error(`${file} is not valid JSON (${(e as Error).message}).`);
  }
  const base = path.parse(file).name.trim();
  if (Array.isArray(data)) return [objectsToSheet(base, file, data)];
  if (data && typeof data === "object") {
    const out: SourceSheet[] = [];
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) if (Array.isArray(v)) out.push(objectsToSheet(k, file, v));
    if (out.length) return out;
  }
  throw new Error(`${file}: expected an array of rows, or an object whose values are arrays of rows (one per sheet).`);
}

export async function parseFile(file: string, buf: Buffer): Promise<SourceSheet[]> {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".xlsx") {
    try {
      return await parseXlsx(file, buf);
    } catch (e) {
      throw new Error(`Could not read ${file} as an Excel workbook (${(e as Error).message}).`);
    }
  }
  if (ext === ".csv") return parseCsv(file, buf);
  if (ext === ".json") return parseJson(file, buf);
  throw new Error(`${file}: unsupported file type. Upload .xlsx, .csv or .json.`);
}

/** Parse several files; sheet names stay unique across files. */
export async function parseFiles(files: { name: string; buf: Buffer }[]): Promise<SourceSheet[]> {
  const out: SourceSheet[] = [];
  for (const f of files) {
    for (const s of await parseFile(f.name, f.buf)) {
      let name = s.name;
      for (let i = 2; out.some((o) => o.name.toLowerCase() === name.toLowerCase()); i++) name = `${s.name} (${i})`;
      out.push({ ...s, name });
    }
  }
  if (!out.length) throw new Error("No sheets with a header row were found in the upload.");
  return out;
}
