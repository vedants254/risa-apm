import { body, handle, qp } from "@/lib/api";
import { insertRow, listRows } from "@/lib/repo";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ table: string }> };
export const GET = handle(async (req: Request, ctx: Ctx) =>
  listRows((await ctx.params).table, {
    q: qp(req, "q"),
    limit: Number(qp(req, "limit") ?? 50),
    offset: Number(qp(req, "offset") ?? 0),
    sort: qp(req, "sort"),
  }),
);
export const POST = handle(async (req: Request, ctx: Ctx) => insertRow((await ctx.params).table, await body(req)));
