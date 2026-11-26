import { body, handle } from "@/lib/api";
import { importUpload } from "@/lib/dataset/pipeline";
import { deleteUpload } from "@/lib/dataset/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** { upload_id } → re-reads the stored file, re-applies its mapping and replaces the dataset. */
export const POST = handle(async (req: Request) => {
  const b = await body(req);
  const id = String(b.upload_id ?? "");
  if (!id) throw new Error("upload_id is required.");
  return importUpload(id);
});

/** { upload_id } → discard an analysed upload without importing it (Cancel). */
export const DELETE = handle(async (req: Request) => {
  const b = await body(req);
  await deleteUpload(String(b.upload_id ?? ""));
  return { ok: true };
});
