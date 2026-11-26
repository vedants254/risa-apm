/**
 * Ask the model for a mapping (lib/dataset/mapping.ts) from the uploaded sheets to the canonical
 * schema, plus value maps for the categorical columns. The model sees only sheet names, headers,
 * the first few rows and the distinct values of low-cardinality text columns, never the full
 * file, and it never produces data values. One call per upload; one retry on an invalid reply.
 */
import { getLlm, type LlmMessage } from "../llm";
import { validateMapping, type DatasetMapping } from "./mapping";
import type { SourceSheet } from "./parse";
import { COLUMN_MEANING, RAW_TABLES, REQUIRED, TABLE_MEANING, VOCAB, VOCAB_FIELDS, cellValue, normalizeTs, type TableName } from "./schema";

export const MAPPER_CONFIG = {
  sampleRows: 8,
  maxDistinct: 25,
  cellChars: 60,
  maxSheets: 30,
} as const;

function show(v: unknown): string | number | null {
  v = cellValue(v);
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return normalizeTs(v, "ts");
  if (typeof v === "number") return v;
  const s = String(v);
  return s.length > MAPPER_CONFIG.cellChars ? `${s.slice(0, MAPPER_CONFIG.cellChars)}…` : s;
}

/** What the model sees of one sheet. */
export function sheetSummary(s: SourceSheet) {
  const values: Record<string, string[]> = {};
  s.headers.forEach((h, i) => {
    const set = new Set<string>();
    let texty = 0;
    for (const r of s.rows) {
      const v = cellValue(r[i]);
      if (v === null || v === undefined || v === "" || v instanceof Date || typeof v === "number") continue;
      const str = String(v).trim();
      if (/^[\d\s,.₹()%+-]+$/.test(str) || /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/.test(str)) continue;
      texty++;
      set.add(str.slice(0, 40));
      if (set.size > MAPPER_CONFIG.maxDistinct) break;
    }
    if (texty && set.size <= MAPPER_CONFIG.maxDistinct) values[h] = [...set];
  });
  return {
    sheet: s.name,
    file: s.file,
    row_count: s.rows.length,
    headers: s.headers,
    sample_rows: s.rows.slice(0, MAPPER_CONFIG.sampleRows).map((r) => r.map(show)),
    distinct_values: values,
  };
}

function schemaText(): string {
  return RAW_TABLES.map((spec) => {
    const t = spec.table as TableName;
    const req = REQUIRED[t]?.length ? ` Needs: ${REQUIRED[t]!.join(", ")}.` : "";
    const cols = Object.entries(spec.columns)
      .map(([c, type]) => `  - ${c} (${type}): ${COLUMN_MEANING[c] ?? ""}`)
      .join("\n");
    return `${t}: ${TABLE_MEANING[t]}${req}\n${cols}`;
  }).join("\n\n");
}

function vocabText(): string {
  return Object.entries(VOCAB)
    .map(([k, vs]) => {
      const f = VOCAB_FIELDS[k as keyof typeof VOCAB];
      return `- ${k} (${f.table}.${f.column}${f.strict ? ", strict" : ""}): ${vs.join(", ")}`;
    })
    .join("\n");
}

export function mapperSystemPrompt(): string {
  return `You map an uploaded spreadsheet onto the fixed schema of an event attendee-growth app. You only name which sheet and column feeds each schema column. You never write data values.

SCHEMA (table: meaning; columns with type and meaning)
${schemaText()}

VALUE VOCABULARIES (the app's metrics read these exact values)
${vocabText()}

RULES
1. Map a table only when a sheet really holds that kind of record. If nothing fits, set "source": null. Do not force unrelated data (for example sponsor deals or brands) into attendee tables.
2. One sheet can feed several tables (for example a flat registrations sheet can feed people and registrations). Several sheets with the same columns (one per month) can feed one table: give "source" as a list.
3. For each schema column give the exact source header, or {"constant": value} when the whole table has one value (for example person_type "external" when every row is an attendee, checkin verification "verified" when the sheet only lists scanned admissions), or leave the column out. Leave ID columns out when the file has none: the app generates IDs and links names to IDs itself (campaign_name is enough for daily rows).
4. "values": for each categorical field, map every distinct source value you see (from distinct_values) onto the vocabulary, e.g. {"person_type": {"Student": "external", "Volunteer": "staff"}, "checkin_result": {"Yes": "admitted", "No": "denied"}}. Strict fields accept only the listed values. Leave out values that already match exactly.
5. "person_flags": optional rules that mark test, staff or internal people by a column of the people sheet, e.g. {"column": "Email", "op": "ends_with", "value": "@test.com", "person_type": "test"}. op is contains, equals, starts_with or ends_with. Only add a rule the sample clearly supports.
6. "date_order": "DMY" if dates look like 31/01/2025, "MDY" for 01/31/2025, "YMD" for ISO, "auto" if unsure.
7. Money is whole INR; negative spend is a credit or refund. Counts are events, not people.
8. The app needs daily spend per campaign (daily_marketing with a date and an amount) and either registrations or people. If the file cannot supply that, set "can_import": false and say in "reason", in one plain sentence, what is missing.
9. "assumptions": short plain sentences for any guess you made. "unmapped_columns": source columns you did not use (the app keeps them as extra fields).

Reply with one JSON object only, exactly this shape:
{"tables": {"<table>": {"source": "<sheet>" | ["<sheet>", ...] | null, "columns": {"<schema column>": "<source header>" | {"constant": <value>}}}},
 "date_order": "auto" | "DMY" | "MDY" | "YMD",
 "values": {"<vocabulary field>": {"<source value>": "<allowed value>"}},
 "person_flags": [],
 "can_import": true, "reason": "",
 "assumptions": [], "unmapped_columns": [{"sheet": "", "column": ""}]}
Include all nine tables in "tables".`;
}

export function mapperUserPrompt(sheets: SourceSheet[]): string {
  const summary = sheets.slice(0, MAPPER_CONFIG.maxSheets).map(sheetSummary);
  return `Uploaded sheets (headers, the first ${MAPPER_CONFIG.sampleRows} rows, and distinct values of short text columns):\n${JSON.stringify(summary)}`;
}

function parseJsonReply(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object in the reply");
  return JSON.parse(t.slice(start, end + 1));
}

export interface ProposedMapping {
  mapping: DatasetMapping;
  model: string;
  calls: number;
}

/** Ask the model for a mapping; validate it; retry once with the problems if it is invalid. */
export async function proposeMapping(sheets: SourceSheet[]): Promise<ProposedMapping> {
  const llm = getLlm();
  if (!llm.configured) {
    throw new Error(
      "These sheets do not match the expected layout, and mapping them needs the AI model. Set OPENAI_API_KEY in app/.env, or rename the sheets and columns to match the original workbook.",
    );
  }
  const messages: LlmMessage[] = [
    { role: "system", content: mapperSystemPrompt() },
    { role: "user", content: mapperUserPrompt(sheets) },
  ];
  let problems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await llm.chat(messages, [], { json: true });
    const text = res.message.content ?? "";
    let raw: unknown;
    try {
      raw = parseJsonReply(text);
    } catch (e) {
      problems = [`The reply was not valid JSON (${(e as Error).message}).`];
    }
    if (raw !== undefined) {
      const v = validateMapping(raw, sheets);
      if (v.mapping) return { mapping: v.mapping, model: llm.model, calls: attempt };
      problems = v.errors;
    }
    messages.push({ role: "assistant", content: text.slice(0, 20000) });
    messages.push({
      role: "user",
      content: `That mapping has problems:\n- ${problems.slice(0, 20).join("\n- ")}\nReply with the corrected JSON object only.`,
    });
  }
  throw new Error(
    `The AI could not produce a usable mapping for this file (${problems.slice(0, 3).join(" ")}). Try again, or rename the sheets and columns to match the original workbook.`,
  );
}
