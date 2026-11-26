/**
 * Uploaded files wait in the dataset_uploads table between "analyse" and "import", so the import
 * re-reads the original file on the server instead of trusting rows sent by the browser. Keeping
 * them in the database (not on disk) works on serverless hosts, where the two requests can land
 * on different instances. The row is deleted after a successful import; abandoned uploads expire.
 */
import crypto from "node:crypto";
import path from "node:path";
import { getDb } from "../db";
import { ensureSeeded } from "../seed";
import type { DatasetMapping } from "./mapping";
import { SUPPORTED_EXTENSIONS } from "./parse";

export const UPLOAD_LIMITS = {
  // Vercel rejects request bodies over 4.5 MB, so the cap stays below that.
  maxBytes: 4 * 1024 * 1024,
  maxFiles: 20,
  keepHours: 24,
} as const;

export interface UploadMeta {
  id: string;
  created_at: string;
  files: { name: string; size: number }[];
  mode?: "fast" | "ai";
  model?: string;
  mapping?: DatasetMapping;
}

const ID_RE = /^[a-f0-9]{24}$/;
function checkId(id: string): string {
  if (!ID_RE.test(id)) throw new Error("Unknown upload. Upload the file again.");
  return id;
}

/** Check names, types and the size cap, then store the files. */
export async function saveUpload(files: { name: string; buf: Buffer }[]): Promise<UploadMeta> {
  if (!files.length) throw new Error("Choose at least one file.");
  if (files.length > UPLOAD_LIMITS.maxFiles) throw new Error(`Upload at most ${UPLOAD_LIMITS.maxFiles} files at once.`);
  const total = files.reduce((a, f) => a + f.buf.length, 0);
  if (total > UPLOAD_LIMITS.maxBytes)
    throw new Error(`The upload is ${(total / 1048576).toFixed(1)} MB. The limit is ${UPLOAD_LIMITS.maxBytes / 1048576} MB in total.`);
  for (const f of files) {
    const ext = path.extname(f.name).toLowerCase();
    if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) throw new Error(`${f.name}: upload .xlsx, .csv or .json files.`);
    if (!f.buf.length) throw new Error(`${f.name} is empty.`);
  }
  await ensureSeeded();
  const db = getDb();
  const now = new Date();
  await db.run("DELETE FROM dataset_uploads WHERE expires_at < ?", [now.toISOString()]);
  const meta: UploadMeta = {
    id: crypto.randomBytes(12).toString("hex"),
    created_at: now.toISOString(),
    files: files.map((f, i) => ({ name: path.basename(f.name).replace(/[^\w .()-]/g, "_").slice(0, 120) || `file${i}`, size: f.buf.length })),
  };
  const payload = files.map((f, i) => ({ name: meta.files[i].name, data: f.buf.toString("base64") }));
  await db.run("INSERT INTO dataset_uploads (id, created_at, expires_at, files, meta) VALUES (?, ?, ?, ?, ?)", [
    meta.id,
    meta.created_at,
    new Date(now.getTime() + UPLOAD_LIMITS.keepHours * 3_600_000).toISOString(),
    JSON.stringify(payload),
    JSON.stringify(meta),
  ]);
  return meta;
}

export async function writeMeta(meta: UploadMeta): Promise<void> {
  await getDb().run("UPDATE dataset_uploads SET meta = ? WHERE id = ?", [JSON.stringify(meta), checkId(meta.id)]);
}

export async function readUpload(id: string): Promise<{ meta: UploadMeta; files: { name: string; buf: Buffer }[] }> {
  await ensureSeeded();
  const r = await getDb().get<{ files: string; meta: string; expires_at: string }>(
    "SELECT files, meta, expires_at FROM dataset_uploads WHERE id = ?",
    [checkId(id)],
  );
  if (!r || r.expires_at < new Date().toISOString()) throw new Error("This upload has expired or was already imported. Upload the file again.");
  const files = (JSON.parse(r.files) as { name: string; data: string }[]).map((f) => ({ name: f.name, buf: Buffer.from(f.data, "base64") }));
  return { meta: JSON.parse(r.meta) as UploadMeta, files };
}

export async function deleteUpload(id: string): Promise<void> {
  await getDb().run("DELETE FROM dataset_uploads WHERE id = ?", [checkId(id)]);
}
