/**
 * Shared request handling for /api/take-a-shot/*. Same checks as
 * /api/shop/signup: same-origin, JSON only, 4 KB limit, `company` honeypot.
 */
import { NextResponse } from "next/server";
import { isTakeAShotServerEnabled } from "./config";
import { digest } from "./identity";
import type { ApiResult, RequestContext } from "./service";

export const respond = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export const notFound = () => respond({ error: "not_found" }, 404);

type Parsed = { ok: true; body: Record<string, unknown>; ctx: RequestContext; ip: string | null } | { ok: false; res: NextResponse };

export async function parseTakeAShotRequest(req: Request): Promise<Parsed> {
  if (!isTakeAShotServerEnabled()) return { ok: false, res: notFound() };
  if (req.headers.get("origin") !== new URL(req.url).origin) return { ok: false, res: respond({ status: "error", error: "invalid_origin" }, 403) };
  if (!req.headers.get("content-type")?.includes("application/json")) return { ok: false, res: respond({ status: "error", error: "invalid_content_type" }, 415) };
  if (Number(req.headers.get("content-length")) > 4096) return { ok: false, res: respond({ status: "error", error: "too_large" }, 413) };
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 4096) return { ok: false, res: respond({ status: "error", error: "too_large" }, 413) };
    body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch { return { ok: false, res: respond({ status: "error", error: "invalid_request" }, 400) }; }
  // Bots that fill the hidden field get a quiet success and nothing is stored.
  if (body.company) return { ok: false, res: respond({ status: "ok" }) };
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const visitor = typeof body.deviceId === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(body.deviceId) ? body.deviceId : null;
  const page = typeof body.page === "string" ? body.page.slice(0, 200).split("?")[0] : null;
  return {
    ok: true, body, ip,
    ctx: { ipHash: digest(`ip:${ip ?? "unknown"}`), visitor, page, userAgent: req.headers.get("user-agent") || "" },
  };
}

/** Map a service result to a response. Errors keep their copy (no PII) and a code. */
export function send(result: ApiResult) {
  if (result.status === "error") {
    const { httpStatus, ...rest } = result;
    return respond(rest, httpStatus ?? 400);
  }
  return respond(result);
}

export function failed(tag: string) {
  // Never log email, phone, request bodies or provider errors.
  console.error(`[take-a-shot] ${tag} unavailable`);
  return respond({ status: "error", error: "Something went wrong. Try again.", code: "unavailable" }, 503);
}
