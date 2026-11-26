import { NextResponse } from "next/server";

/** Wrap a route handler: JSON in/out, errors become 400 with an actionable message. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    try {
      const out = await fn(...args);
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  };
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const j = await req.json();
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

export const qp = (req: Request, k: string) => new URL(req.url).searchParams.get(k) ?? undefined;
