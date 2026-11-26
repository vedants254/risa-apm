import { body, handle, qp } from "@/lib/api";
import { createTask, listTasks } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const GET = handle(async (req: Request) =>
  listTasks({ status: qp(req, "status"), campaign_id: qp(req, "campaign_id"), owner_name: qp(req, "owner_name"), source: qp(req, "source") }),
);
export const POST = handle(async (req: Request) => createTask(await body(req)));
