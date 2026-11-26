import { body, handle } from "@/lib/api";
import { deleteAction, updateAction } from "@/lib/repo";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export const PATCH = handle(async (req: Request, ctx: Ctx) => updateAction((await ctx.params).id, await body(req)));
export const DELETE = handle(async (_req: Request, ctx: Ctx) => deleteAction((await ctx.params).id));
