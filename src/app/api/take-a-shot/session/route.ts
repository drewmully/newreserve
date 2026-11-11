/**
 * POST /api/take-a-shot/session. Starts or resumes the player's one game.
 * Consent evidence is written here (capture first); the Klaviyo sync runs
 * once the player's code exists (see lib/takeAShot/service.ts claim()).
 */
import { identityCookie } from "@/lib/klaviyo/identity";
import { takeAShotService } from "@/lib/takeAShot/firestoreStore";
import { failed, parseTakeAShotRequest, respond, send } from "@/lib/takeAShot/http";
import { verifyTurnstile } from "@/lib/takeAShot/turnstile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const parsed = await parseTakeAShotRequest(req);
  if (!parsed.ok) return parsed.res;
  if (!(await verifyTurnstile(parsed.body.turnstileToken, parsed.ip)))
    return respond({ status: "error", error: "Please confirm you are not a robot and try again.", code: "turnstile_failed" }, 403);
  try {
    const result = await takeAShotService().session(parsed.body, parsed.ctx);
    const res = send(result);
    // Email consent is required on this route, so tie later site visits to the profile.
    if (result.status === "new" && typeof parsed.body.email === "string") {
      const kid = identityCookie(parsed.body.email.trim().toLowerCase());
      if (kid) res.cookies.set(kid);
    }
    return res;
  } catch {
    return failed("session");
  }
}
