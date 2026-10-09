import { createHash, timingSafeEqual } from "node:crypto";
import { metaHourlyPacketFromCaptures, metaHourlyWindow, type MetaGraphCapture } from "./metaHourlySpendInput";
import { prepareMetaSpendRegistration } from "./multiProviderSpendRegistration";
import { evidenceDigest } from "./evidenceIntake";
import { nyDate } from "./primitives";

const ACCOUNT = "2796962933960445";
const URL_ROOT = `https://graph.facebook.com/v25.0/act_${ACCOUNT}`;
const HOUR = "hourly_stats_aggregated_by_advertiser_time_zone";
const hash = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
const fail = (): never => { throw new Error("meta_source_refused"); };
const check: (v: unknown) => asserts v = v => { if (!v) fail(); };
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue => {
  check(v && typeof v === "object" && !Array.isArray(v)); return v as ObjectValue;
};
type JobContext = { runId: number; setMeta(v: ObjectValue): void; bumpRows(input: number, output: number): void };
export type MetaSourceRuntime = {
  env: NodeJS.ProcessEnv; now(): number; request: typeof fetch;
  runJob(name: string, fn: (job: JobContext) => Promise<ObjectValue>): Promise<unknown>;
  readJob(id: number): Promise<{ id: number; job_name: string; status: string; started_at: string }>;
  register(args: { p_job: number; p_packet: unknown; p_receipts: unknown; p_as_of: string }): Promise<unknown>;
};

/** Same duplicate-member/depth scanner as googleReadinessJson, with the native
 * response byte ceiling. Unknown provider strings never leave this reader. */
function parseNative(text: string): unknown {
  check(Buffer.byteLength(text) <= 1000000);
  let at = 0;
  const space = () => { while (at < text.length && /[ \t\r\n]/.test(text[at])) at++; };
  const string = (): string => {
    const start = at++;
    while (at < text.length) {
      if (text[at] === "\\") { at += 2; continue; }
      if (text[at++] === '"') return JSON.parse(text.slice(start, at));
    }
    return fail();
  };
  const value = (depth: number): void => {
    check(depth <= 32); space();
    if (text[at] === '"') { string(); return; }
    const open = text[at];
    if (open === "{" || open === "[") {
      at++; space(); const close = open === "{" ? "}" : "]", keys = new Set<string>();
      if (text[at] === close) { at++; return; }
      for (;;) {
        space();
        if (open === "{") {
          check(text[at] === '"'); const key = string(); check(!keys.has(key)); keys.add(key);
          space(); check(text[at++] === ":");
        }
        value(depth + 1); space();
        if (text[at] === close) { at++; return; }
        check(text[at++] === ",");
      }
    }
    const found = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));
    check(found); at += found[0].length;
  };
  value(0); space(); check(at === text.length); return JSON.parse(text);
}
function projectResponse(raw: unknown, campaign: boolean | null) {
  const v = object(raw); check(!Object.hasOwn(v, "error"));
  if (campaign === null) {
    check(v.id === `act_${ACCOUNT}` && v.account_id === ACCOUNT && v.currency === "USD" &&
      v.timezone_name === "America/Los_Angeles" && v.account_status === 1);
    return Object.fromEntries(["id", "account_id", "currency", "timezone_name", "account_status"].map(k => [k, v[k]]));
  }
  check(Object.keys(v).every(k => ["data", "paging"].includes(k)) && Array.isArray(v.data) &&
    v.data.length <= (campaign ? 1000 : 48));
  if (v.paging !== undefined) check(!Object.hasOwn(object(v.paging), "next"));
  const fields = ["account_id", "account_currency", "date_start", "date_stop", "spend", HOUR,
    ...(campaign ? ["campaign_id"] : [])];
  return { data: v.data.map(item => {
    const row = object(item); check(Object.keys(row).every(k => fields.includes(k)));
    check(row.account_id === ACCOUNT && row.account_currency === "USD" &&
      fields.every(k => typeof row[k] === "string") &&
      /^(0|[1-9]\d{0,13})(\.\d{1,6})?$/.test(row.spend as string) &&
      (!campaign || /^[1-9]\d{0,19}$/.test(row.campaign_id as string)));
    return Object.fromEntries(fields.map(k => [k, row[k]]));
  }) };
}

export async function captureMetaSourceReceipts(r: Pick<MetaSourceRuntime, "now" | "request">,
  date: string, startedAt: string, token: string) {
  const window = metaHourlyWindow(date), began = r.now();
  const deadline = Math.min(began + 55000, Date.parse(startedAt) + 90000);
  const queryClose = Math.max(...window.providerHours.values()) + 3600000;
  check(began >= queryClose && began < deadline);
  let bytes = 0, requests = 0;
  async function get(campaign: boolean | null): Promise<MetaGraphCapture> {
    const started = r.now(), remaining = Math.min(15000, deadline - started);
    check(remaining > 0 && requests < 3 && started >= queryClose);
    const params: Record<string, string> = campaign === null ?
      { fields: "id,account_id,currency,timezone_name,account_status,business" } : {
        time_range: JSON.stringify({ since: window.since, until: window.until }), time_increment: "1",
        breakdowns: HOUR, level: campaign ? "campaign" : "account",
        fields: `account_id,account_currency,date_start,date_stop,spend${campaign ? ",campaign_id" : ""}`,
        limit: campaign ? "1001" : "49",
      };
    const url = URL_ROOT + (campaign === null ? "" : "/insights");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    requests++;
    try {
      // Explicit race bounds a stalled fetch or stream even in a custom transport.
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("meta_source_refused")); }, remaining);
      });
      const response = await Promise.race([r.request(`${url}?${new URLSearchParams(params)}`, {
        method: "GET", headers: { Authorization: `Bearer ${token}` }, redirect: "error",
        cache: "no-store", signal: controller.signal,
      }), expired]);
      check(response.status === 200 && response.body);
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const next = await Promise.race([reader.read(), expired]);
          if (next.done) break;
          size += next.value.length; bytes += next.value.length;
          check(size <= 1000000 && bytes <= 8388608 && r.now() < deadline);
          chunks.push(next.value);
        }
      } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      const body = Buffer.concat(chunks);
      const safe = projectResponse(parseNative(new TextDecoder("utf-8", { fatal: true }).decode(body)), campaign);
      const finished = r.now(); check(finished >= started && finished < deadline && finished - started < remaining);
      return { startedAt: new Date(started).toISOString(), finishedAt: new Date(finished).toISOString(),
        method: "GET", url, params, status: 200, bodyBytes: body.length, bodySha256: hash(body),
        pagingCredentialQueryParametersRemoved: true, response: safe };
    } catch { return fail(); }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
  const metadata = await get(null), accountHours = await get(false), campaignHours = await get(true);
  check(requests === 3 && r.now() < deadline);
  return { metadata, accountHours, campaignHours };
}

/** Existing cron, source-only mode. No legacy table upsert or PostHog event. */
export async function runMetaSourceIngestion(request: Request, r: MetaSourceRuntime) {
  const url = new URL(request.url), authorization = request.headers.get("authorization") || "";
  const secret = r.env.CRON_SECRET, expected = secret ? `Bearer ${secret}` : "";
  const actualBytes = Buffer.from(authorization), expectedBytes = Buffer.from(expected);
  if (!expected || actualBytes.length !== expectedBytes.length ||
    !timingSafeEqual(actualBytes, expectedBytes))
    return { status: 401, body: { error: "unauthorized" } };
  if (request.method !== "GET" || [...url.searchParams].length !== 1 ||
    url.searchParams.get("source_only") !== "1")
    return { status: 400, body: { error: "meta_source_scope" } };
  const token = r.env.META_MARKETING_API_TOKEN;
  // Accept only the fixed account after removing surrounding configuration
  // whitespace; do not rewrite historical identifiers or normalize token bytes.
  if (r.env.VERCEL_ENV !== "production" || r.env.VERCEL_GIT_COMMIT_REF !== "main" ||
    !token || !/^[!-~]{1,4096}$/.test(token) ||
    ![ACCOUNT, `act_${ACCOUNT}`].includes((r.env.META_AD_ACCOUNT_ID || "").trim()))
    return { status: 503, body: { error: "meta_source_configuration" } };
  const today = nyDate(new Date(r.now()).toISOString());
  const date = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const name = `meta-source:${date}`;
  try {
    const result = await r.runJob(name, async job => {
      try {
        const saved = await r.readJob(job.runId);
        check(Number.isSafeInteger(job.runId) && job.runId > 0 &&
          saved.id === job.runId && saved.job_name === name && saved.status === "running" &&
          Number.isFinite(Date.parse(saved.started_at)) && Date.parse(saved.started_at) <= r.now() &&
          r.now() < Date.parse(saved.started_at) + 90000);
        const receipts = await captureMetaSourceReceipts(r, date, saved.started_at, token);
        const asOf = new Date(r.now()).toISOString(), ref = `meta-source-job:${job.runId}`;
        const packet = metaHourlyPacketFromCaptures({
          projectRef: "xnfjdbpjuaezxjgargto", shop: "mullybox-store.myshopify.com",
          generationId: `meta_ingest_daily_${date}`, accountId: `act_${ACCOUNT}`, date,
          approvalRef: "meta-source-daily-v1", actorRef: ref, controlApprovalRef: `${ref}:account-control`,
          freshnessCutoffAt: saved.started_at.replace(/\+00:00$/, "Z"), asOf, ...receipts,
        });
        prepareMetaSpendRegistration(packet, { freshnessCutoffAt: saved.started_at.replace(/\+00:00$/, "Z"), asOf });
        job.setMeta({ report_date: date, meta_source_receipts: receipts, source_requests: 3 });
        const persisted = object(await r.register({ p_job: job.runId, p_packet: packet, p_receipts: receipts, p_as_of: asOf }));
        check(persisted.state === "source_registered" && persisted.generationId === packet.generationId &&
          persisted.enabled === false && persisted.packetHashValid === true &&
          typeof persisted.packetHash === "string" && /^[a-f0-9]{64}$/.test(persisted.packetHash) &&
          evidenceDigest(persisted.packet) === evidenceDigest(packet));
        const result = { state: "source_registered", generationId: packet.generationId, reportDate: date,
          packetHash: persisted.packetHash, enabled: false, verifiedEmpty: packet.source.verifiedEmpty,
          sourceRows: packet.source.rows.length, controlRows: packet.control.rows.length };
        job.setMeta(result); job.bumpRows(packet.source.rows.length + packet.control.rows.length, 1);
        return result;
      } catch { return fail(); }
    });
    // withJobRun records callback failure and returns ok:false instead of
    // throwing. Preserve that failure at the HTTP boundary too.
    return { status: object(result).ok === true ? 200 : 503, body: result };
  } catch {
    // Duplicate job/date, ambiguous previous run, or a log failure never cause
    // another capture. Do not expose database/provider error text.
    return { status: 409, body: { error: "meta_source_attempt_unavailable" } };
  }
}
