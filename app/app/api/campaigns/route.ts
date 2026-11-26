import { body, handle } from "@/lib/api";
import { createCampaign, listCampaigns } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const GET = handle(async () => listCampaigns());
export const POST = handle(async (req: Request) => createCampaign(await body(req)));
