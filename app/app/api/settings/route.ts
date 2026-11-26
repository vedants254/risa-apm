import { body, handle } from "@/lib/api";
import { getSettings } from "@/lib/metrics";
import { updateSettings } from "@/lib/repo";
import type { SettingsKey } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const GET = handle(async () => getSettings());
export const PATCH = handle(async (req: Request) => {
  const b = await body(req);
  return updateSettings(String(b.key) as SettingsKey, (b.value as Record<string, unknown>) ?? {});
});
