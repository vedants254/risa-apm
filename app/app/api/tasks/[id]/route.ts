import { body, handle } from "@/lib/api";
import { deleteTask, updateTask } from "@/lib/repo";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export const PATCH = handle(async (req: Request, ctx: Ctx) => updateTask((await ctx.params).id, await body(req)));
export const DELETE = handle(async (_req: Request, ctx: Ctx) => deleteTask((await ctx.params).id));
