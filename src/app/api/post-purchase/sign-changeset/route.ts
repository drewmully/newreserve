import { NextRequest } from "next/server";
import { appCredentials, CORS, json, isExistingMember, mullyAccessChanges, verifyExtensionRequest } from "@/lib/postPurchase/mullyAccessOffer";
import { newJti, signHs256 } from "@/lib/postPurchase/jwt";

export const dynamic = "force-dynamic";
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });

/** Accept: sign the server-built Mully Access changeset for applyChangeset. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let purchase;
  try { purchase = verifyExtensionRequest(req, body.referenceId); }
  catch { return json({ error: "unauthorized" }, 401); }
  try {
    if (await isExistingMember(purchase.customerId)) return json({ error: "already a member" }, 409);
    const changes = await mullyAccessChanges();
    if (!changes) return json({ error: "offer unavailable" }, 409);
    const { apiKey, secret } = appCredentials();
    const token = signHs256({ iss: apiKey, jti: newJti(), iat: Date.now(), sub: body.referenceId, changes }, secret);
    return json({ token });
  } catch (err) {
    console.error("[post-purchase/sign-changeset]", err);
    return json({ error: "unavailable" }, 503);
  }
}
