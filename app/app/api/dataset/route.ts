import { handle } from "@/lib/api";
import { getDatasetInfo } from "@/lib/dataset/pipeline";

export const dynamic = "force-dynamic";
/** The active dataset: name, kind, import time and date range. */
export const GET = handle(async () => getDatasetInfo());
