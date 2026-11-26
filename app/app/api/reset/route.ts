import { handle } from "@/lib/api";
import { resetToOriginal } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** Re-seed from the original workbook (drops data edits, tasks, action items and chat). */
export const POST = handle(async () => resetToOriginal());
