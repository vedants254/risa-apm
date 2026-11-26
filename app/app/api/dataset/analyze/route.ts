import { handle } from "@/lib/api";
import { analyzeUpload } from "@/lib/dataset/pipeline";
import { UPLOAD_LIMITS } from "@/lib/dataset/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * multipart/form-data with one or more `files` (.xlsx, .csv, .json; 4 MB in total).
 * Stores the upload, maps it (fast path or the model), cleans it and returns the preview.
 */
export const POST = handle(async (req: Request) => {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > UPLOAD_LIMITS.maxBytes + 64 * 1024)
    throw new Error(`The upload is ${(len / 1048576).toFixed(1)} MB. The limit is ${UPLOAD_LIMITS.maxBytes / 1048576} MB in total.`);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new Error("Send the files as multipart/form-data in a field named files.");
  }
  const files: { name: string; buf: Buffer }[] = [];
  for (const v of form.getAll("files")) {
    if (typeof v === "string") continue;
    files.push({ name: v.name, buf: Buffer.from(await v.arrayBuffer()) });
  }
  return analyzeUpload(files);
});
