import { snapshotDate } from "@/lib/metrics";
import { body, handle } from "@/lib/api";
import { simulateReallocation } from "@/lib/insights";

export const dynamic = "force-dynamic";
export const POST = handle(async (req: Request) => {
  const b = await body(req);
  return simulateReallocation({
    date: await snapshotDate(typeof b.date === "string" ? b.date : null),
    from_campaign_id: String(b.from_campaign_id ?? ""),
    to_campaign_id: String(b.to_campaign_id ?? ""),
    pct: b.pct === undefined || b.pct === "" ? undefined : Number(b.pct),
    amount_inr: b.amount_inr === undefined || b.amount_inr === "" ? undefined : Number(b.amount_inr),
    base: b.base === "planned_budget" ? "planned_budget" : "spend_to_date",
  });
});
