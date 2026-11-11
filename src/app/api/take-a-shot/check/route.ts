/** POST /api/take-a-shot/check. Rules live in lib/takeAShot/service.ts. */
import { takeAShotService } from "@/lib/takeAShot/firestoreStore";
import { identityCookie } from "@/lib/klaviyo/identity";
import { failed, identifiesPlayer, parseTakeAShotRequest, send } from "@/lib/takeAShot/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const parsed = await parseTakeAShotRequest(req);
  if (!parsed.ok) return parsed.res;
  try {
    const result = await takeAShotService().check(parsed.body, parsed.ctx);
    const res = send(result);
    // A returning player stops at this step and never reaches /session.
    // Identify them only on the browser that played (consent already on
    // file); another browser typing the same email gets no cookie.
    if (identifiesPlayer(result) && typeof parsed.body.email === "string") {
      const kid = identityCookie(parsed.body.email.trim().toLowerCase());
      if (kid) res.cookies.set(kid);
    }
    return res;
  } catch {
    return failed("check");
  }
}
