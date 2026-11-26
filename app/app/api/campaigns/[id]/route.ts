import { body, handle } from "@/lib/api";
import { deleteCampaign, updateCampaign } from "@/lib/repo";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export const PATCH = handle(async (req: Request, ctx: Ctx) => updateCampaign((await ctx.params).id, await body(req)));
export const DELETE = handle(async (_req: Request, ctx: Ctx) => deleteCampaign((await ctx.params).id));
