import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runSubscriptionRuntime } from "@/lib/analytics/subscriptionRuntime";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
async function hasEmptyBody(req: NextRequest): Promise<boolean> {
  if (req.signal.aborted) return false;
  if (req.body === null) return true;
  if (req.body.locked || req.bodyUsed) return false;
  // Next's Node adapter represents even a zero-byte POST as a stream.
  // Require EOF, not a null stream, without buffering or logging any bytes.
  const reader = req.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: () => void = () => {};
  const stopped = new Promise<false>(resolve => {
    stop = () => resolve(false);
    timer = setTimeout(stop, 1000);
    req.signal.addEventListener("abort", stop, { once: true });
    if (req.signal.aborted) stop();
  });
  try {
    const empty = reader.read().then(({ done, value }) =>
      done === true && (value === undefined || value.byteLength === 0), () => false);
    return await Promise.race([empty, stopped]);
  } finally {
    clearTimeout(timer);
    req.signal.removeEventListener("abort", stop);
    // Cancellation itself must not make request admission unbounded.
    void reader.cancel().catch(() => {});
  }
}
export async function POST(req: NextRequest) {
  if (process.env.LEAN_ANALYTICS_SUBSCRIPTIONS_ENABLED !== "true")
    return new NextResponse(null, { status: 404, headers });
  const secret = process.env.LEAN_ANALYTICS_SUBSCRIPTIONS_SECRET ?? "";
  if (secret.length < 32 || secret.length > 512) return new NextResponse(null, { status: 503, headers });
  const a = Buffer.from(`Bearer ${secret}`), b = Buffer.from(req.headers.get("authorization") ?? "");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new NextResponse(null, { status: 401, headers });
  if (req.nextUrl.search || req.headers.has("transfer-encoding") ||
      req.headers.has("content-length") && req.headers.get("content-length") !== "0")
    return new NextResponse(null, { status: 400, headers });
  if (!await hasEmptyBody(req)) return new NextResponse(null, { status: 400, headers });
  try { return NextResponse.json(await runSubscriptionRuntime({ signal: req.signal }), { headers }); }
  catch { return NextResponse.json({ state: "unavailable" }, { status: 503, headers }); }
}
