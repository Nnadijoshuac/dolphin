import { NextResponse } from "next/server";

import { parseArgs } from "@/app/test/choices";
import { runStrategyTest } from "@/server/convex";

/**
 * The strategy test, behind the CDN. One set of choices with a finished end day always gives one answer,
 * so Vercel caches it for a day and a viral wave of the same few links never reaches Convex
 * (owner, 2026-10-13: "be careful" with the backend). The page and the share card both read it here.
 */
export async function GET(request: Request) {
  const args = parseArgs(new URL(request.url).searchParams);
  const result = await runStrategyTest(args);
  if (!result) return NextResponse.json({ error: "The test could not run. Try again in a minute." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(
    { args, result },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800" } },
  );
}
