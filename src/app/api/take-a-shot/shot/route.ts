/** POST /api/take-a-shot/shot. Rules live in lib/takeAShot/service.ts. */
import { takeAShotService } from "@/lib/takeAShot/firestoreStore";
import { failed, parseTakeAShotRequest, send } from "@/lib/takeAShot/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const parsed = await parseTakeAShotRequest(req);
  if (!parsed.ok) return parsed.res;
  try {
    return send(await takeAShotService().shot(parsed.body, parsed.ctx));
  } catch {
    return failed("shot");
  }
}
