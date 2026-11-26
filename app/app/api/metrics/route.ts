import { handle, qp } from "@/lib/api";
import { getSnapshot, snapshotDate } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const GET = handle(async (req: Request) => getSnapshot(await snapshotDate(qp(req, "date"))));
