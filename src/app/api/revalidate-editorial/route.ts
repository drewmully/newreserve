import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

/**
 * On-demand revalidation for the editorial shelf.
 * Hit with GET to force /lp/editorial to regenerate on next request.
 *
 * Also revalidates the Mully 100 landing page, since some editorial pieces
 * feed into that surface as well.
 *
 * No secret required for now — this endpoint has no destructive side effects
 * beyond clearing a page cache.
 */
export async function GET() {
  revalidatePath("/lp/editorial");
  revalidatePath("/lp/mully100");
  return NextResponse.json({
    revalidated: true,
    paths: ["/lp/editorial", "/lp/mully100"],
    at: new Date().toISOString(),
  });
}

export const dynamic = "force-dynamic";
