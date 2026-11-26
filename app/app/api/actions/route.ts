import { body, handle } from "@/lib/api";
import { createAction, listActions } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const GET = handle(async () => listActions());
export const POST = handle(async (req: Request) => createAction(await body(req)));
