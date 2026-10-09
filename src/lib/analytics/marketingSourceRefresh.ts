import { timingSafeEqual } from "node:crypto";
import { captureMarketingSource, MarketingSourceError, type CaptureRuntime,
  type MarketingClaim, type MarketingProvider } from "./marketingSourceCapture";
import { evidenceDigest } from "./evidenceIntake";
import { nyDate, type Row } from "./primitives";

export type MarketingRuntime = CaptureRuntime & {
  rpc(name: string, args: Row): Promise<unknown>;
};
export type MarketingLane = "primary" | "correction";
type Reply = { status: number; body: Row };
const object = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const providers: Record<string, MarketingProvider> = { google: "google_ads", meta: "meta_ads" };
const safeCodes = new Set(["configuration_missing", "authentication_denied", "rate_limited",
  "rate_limit_manual", "provider_unavailable", "timeout", "incomplete_pages", "schema_changed",
  "control_mismatch", "unsupported_window", "scope_invalid"]);
const error = (status: number, code: string): Reply => ({ status, body: { error: code } });
export function marketingProduction(env: CaptureRuntime["env"]) {
  return env.VERCEL_ENV === "production" && env.VERCEL_GIT_COMMIT_REF === "main";
}
function claim(value: unknown, provider: MarketingProvider, now: number): MarketingClaim {
  if (!object(value) || value.state !== "claimed" || value.provider !== provider ||
    typeof value.jobId !== "string" || !/^[1-9]\d{0,18}$/.test(value.jobId) ||
    typeof value.token !== "string" || !/^[a-f0-9-]{36}$/.test(value.token) ||
    typeof value.date !== "string" || !/^\d{4}-\d\d-\d\d$/.test(value.date) ||
    ![1, 2].includes(Number(value.attempt)) || typeof value.startedAt !== "string" ||
    typeof value.deadline !== "string") throw new Error("claim");
  const start = Date.parse(value.startedAt), end = Date.parse(value.deadline);
  const today = Date.parse(`${nyDate(new Date(now).toISOString())}T00:00:00Z`);
  const date = Date.parse(`${value.date}T00:00:00Z`);
  if (!Number.isFinite(start + end + date) || start > now || now - start > 15000 ||
    end - start !== 90000 || end <= now || date >= today || today - date > 7 * 86400000)
    throw new Error("claim");
  return value as unknown as MarketingClaim;
}
function committed(value: unknown, job: MarketingClaim, digest: string, packet: unknown): boolean {
  return object(value) && value.state === "complete" && value.jobId === job.jobId &&
    value.digest === digest && evidenceDigest(value.packet) === evidenceDigest(packet) &&
    typeof value.packetHash === "string" && /^[a-f0-9]{64}$/.test(value.packetHash);
}

/** Claim before any provider HTTP. A transport-ambiguous commit permits only a
 * same-job readback, never recapture or a second write. */
export async function refreshMarketingSource(provider: MarketingProvider, lane: MarketingLane,
  r: MarketingRuntime, repair: { date: string; actor: string; reason: string } | null = null): Promise<Reply> {
  if (!marketingProduction(r.env)) return error(503, "marketing_source_configuration");
  let c: MarketingClaim;
  try {
    const result = await r.rpc("lean_marketing_source_claim", {
      p_provider: provider, p_lane: lane, p_date: repair?.date ?? null,
      p_actor: repair?.actor ?? null, p_reason: repair?.reason ?? null,
    });
    if (object(result) && result.state !== "claimed") {
      if (!["disabled", "not_due", "busy", "held", "rate_limited", "attempts_exhausted"].includes(String(result.state)))
        return error(503, "marketing_source_claim");
      return { status: ["held", "attempts_exhausted"].includes(String(result.state)) ? 503 : 200,
        body: { state: result.state, provider, downstreamImport: "not_observed" } };
    }
    c = claim(result, provider, r.now());
  } catch { return error(503, "marketing_source_claim"); }
  let captured: Awaited<ReturnType<typeof captureMarketingSource>>;
  try { captured = await captureMarketingSource(c, r); }
  catch (e) {
    const code = e instanceof MarketingSourceError && safeCodes.has(e.category) ? e.category : "schema_changed";
    const seconds = e instanceof MarketingSourceError ? e.retryAfterSeconds : 0;
    try { await r.rpc("lean_marketing_source_fail", {
      p_job: c.jobId, p_token: c.token, p_code: code, p_retry_seconds: seconds,
    }); } catch { /* A later claim sees the retained running attempt and holds. */ }
    return { status: 503, body: { state: "failed", jobId: c.jobId, provider, code,
      downstreamImport: "not_observed" } };
  }
  const digest = evidenceDigest(captured);
  try {
    const value = await r.rpc("lean_marketing_source_commit", { p_job: c.jobId, p_token: c.token,
      p_packet: captured.packet, p_receipts: captured.receipts, p_digest: digest });
    if (!committed(value, c, digest, captured.packet)) throw new Error("commit");
    return { status: 200, body: { state: "complete", jobId: c.jobId, provider,
      reconciled: false, downstreamImport: "not_observed" } };
  } catch {
    try {
      const value = await r.rpc("lean_marketing_source_read", { p_job: c.jobId, p_token: c.token });
      if (committed(value, c, digest, captured.packet)) return { status: 200,
        body: { state: "complete", jobId: c.jobId, provider, reconciled: true,
          downstreamImport: "not_observed" } };
    } catch { /* Unknown means hold, not retry. */ }
    try { await r.rpc("lean_marketing_source_fail", {
      p_job: c.jobId, p_token: c.token, p_code: "commit_unconfirmed", p_retry_seconds: 0,
    }); } catch { /* The durable attempt is still consumed. */ }
    return { status: 503, body: { state: "held", jobId: c.jobId, provider,
      code: "commit_unconfirmed", downstreamImport: "not_observed" } };
  }
}

export function marketingCronAuthorized(request: Request, env: CaptureRuntime["env"]) {
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : "");
  return !!expected.length && actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function marketingCron(request: Request, name: string, r: MarketingRuntime): Promise<Reply> {
  if (!marketingCronAuthorized(request, r.env)) return error(401, "unauthorized");
  const url = new URL(request.url), lane = url.searchParams.get("lane");
  if (request.method !== "GET" || !Object.hasOwn(providers, name) ||
    [...url.searchParams].length !== 1 || !["primary", "correction"].includes(lane ?? ""))
    return error(400, "marketing_source_scope");
  return refreshMarketingSource(providers[name], lane as MarketingLane, r);
}

/** The mounted route supplies requireAdmin. Authentication is deliberately
 * before runtime construction, body parsing, or database access. */
export async function marketingAdmin(request: Request,
  authorize: () => Promise<{ uid: string } | null>, runtime: () => MarketingRuntime): Promise<Reply> {
  let admin: { uid: string } | null;
  try { admin = await authorize(); } catch { admin = null; }
  if (!admin) return error(401, "unauthorized");
  if (new URL(request.url).search || !["GET", "POST"].includes(request.method))
    return error(400, "marketing_source_scope");
  try {
    const r = runtime();
    if (!marketingProduction(r.env)) return error(503, "marketing_source_configuration");
    if (request.method === "GET") {
      const result = await r.rpc("lean_marketing_source_health", {});
      if (!Array.isArray(result) || result.length !== 2) throw new Error("health");
      const keys = ["provider", "enabled", "reportEnabled", "blockedCode", "retryAfter",
        "lastAttempt", "lastState", "lastCode", "lastSuccess", "lastSuccessDate", "lastSuccessHash",
        "lastCaptureAt", "lastControlAt", "downstreamImport"];
      if (result.some(v => !object(v) || Object.keys(v).some(k => !keys.includes(k)) ||
        v.downstreamImport !== "not_observed")) throw new Error("health");
      return { status: 200, body: { sources: result } };
    }
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
      return error(400, "marketing_source_scope");
    const reader = request.body?.getReader(); if (!reader) return error(400, "marketing_source_scope");
    let text = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("marketing_source_body")), 5000);
    });
    try {
      let bytes = 0; const chunks: Uint8Array[] = [];
      for (;;) {
        const part = await Promise.race([reader.read(), expired]); if (part.done) break;
        bytes += part.value.length; if (bytes > 2048) return error(400, "marketing_source_scope");
        chunks.push(part.value);
      }
      text = Buffer.concat(chunks).toString("utf8");
    } finally { if (timer) clearTimeout(timer); void reader.cancel().catch(() => {}); reader.releaseLock(); }
    const body: unknown = JSON.parse(text);
    if (!object(body) || Object.keys(body).some(k => !["action", "provider", "date", "reason"].includes(k)) ||
      !["retry", "pause"].includes(String(body.action)) || !Object.hasOwn(providers, String(body.provider)) ||
      typeof body.reason !== "string" || !/^[A-Za-z0-9 _.-]{3,120}$/.test(body.reason) ||
      body.action === "retry" && (typeof body.date !== "string" || !/^\d{4}-\d\d-\d\d$/.test(body.date)) ||
      body.action === "pause" && body.date !== undefined)
      return error(400, "marketing_source_scope");
    const provider = providers[String(body.provider)];
    if (body.action === "pause") {
      await r.rpc("lean_marketing_source_pause", { p_provider: provider, p_actor: admin.uid, p_reason: body.reason });
      return { status: 200, body: { state: "paused", provider } };
    }
    return refreshMarketingSource(provider, "primary", r,
      { date: String(body.date), actor: admin.uid, reason: body.reason });
  } catch { return error(503, "marketing_source_unavailable"); }
}
