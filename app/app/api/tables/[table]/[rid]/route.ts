import { body, handle } from "@/lib/api";
import { deleteRow, updateRow } from "@/lib/repo";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ table: string; rid: string }> };
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const p = await ctx.params;
  return updateRow(p.table, p.rid, await body(req));
});
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const p = await ctx.params;
  return deleteRow(p.table, p.rid);
});
