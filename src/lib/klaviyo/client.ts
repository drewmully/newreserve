/**
 * Minimal Klaviyo REST client.
 *
 * - Adds auth + revision headers.
 * - 5s timeout per attempt.
 * - Retries 429 and 5xx in-line (honoring Retry-After, capped) a couple of
 *   times; anything still failing surfaces as a KlaviyoError so the caller can
 *   schedule a durable retry.
 * - Never logs or embeds request bodies, emails or phones in errors. Errors
 *   carry only a short code and the HTTP status.
 */

import { KLAVIYO_BASE_URL, KLAVIYO_REVISION, REQUEST_TIMEOUT_MS } from "./config";

export type KlaviyoErrorCode =
  | "not_configured"
  | "timeout"
  | "network"
  | "rate_limited"
  | "server_error"
  | "duplicate_profile"
  | "bad_request"
  | "unauthorized"
  | "unexpected";

export class KlaviyoError extends Error {
  readonly code: KlaviyoErrorCode;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  /** Klaviyo error codes from the JSON:API errors array (never detail text). */
  readonly apiCodes: string[];
  constructor(code: KlaviyoErrorCode, status: number | null, opts?: { retryAfterMs?: number | null; apiCodes?: string[] }) {
    super(`klaviyo_${code}${status ? `_${status}` : ""}`);
    this.name = "KlaviyoError";
    this.code = code;
    this.status = status;
    this.retryAfterMs = opts?.retryAfterMs ?? null;
    this.apiCodes = opts?.apiCodes ?? [];
  }
}

export interface KlaviyoResponse<T = unknown> {
  status: number;
  body: T | null;
}

const INLINE_RETRIES = 2;
const MAX_INLINE_WAIT_MS = 5_000;

export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(value);
  if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function classify(status: number, apiCodes: string[]): KlaviyoErrorCode {
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 409 || apiCodes.includes("duplicate_profile")) return "duplicate_profile";
  if (status >= 400) return "bad_request";
  return "unexpected";
}

async function readJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** JSON pointers of rejected fields (paths only, never values or detail text). */
function errorPointers(body: unknown): string[] {
  const errors = (body as { errors?: Array<{ source?: { pointer?: unknown } }> } | null)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors
    .map((e) => (typeof e?.source?.pointer === "string" ? e.source.pointer.replace(/[^\w/.-]/g, "") : ""))
    .filter(Boolean)
    .slice(0, 5);
}

function errorCodes(body: unknown): string[] {
  const errors = (body as { errors?: Array<{ code?: unknown }> } | null)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.map((e) => (typeof e?.code === "string" ? e.code : "")).filter(Boolean).slice(0, 5);
}

export async function klaviyoRequest<T = unknown>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
  deps: { fetchImpl?: typeof fetch; sleepImpl?: (ms: number) => Promise<void> } = {},
): Promise<KlaviyoResponse<T>> {
  const key = process.env.KLAVIYO_PRIVATE_API_KEY;
  if (!key) throw new KlaviyoError("not_configured", null);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const wait = deps.sleepImpl ?? sleep;

  let last: KlaviyoError | null = null;
  for (let attempt = 0; attempt <= INLINE_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchImpl(`${KLAVIYO_BASE_URL}${path}`, {
        method: init.method ?? "POST",
        headers: {
          Authorization: `Klaviyo-API-Key ${key}`,
          revision: KLAVIYO_REVISION,
          accept: "application/vnd.api+json",
          "content-type": "application/vnd.api+json",
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = (err as { name?: string })?.name === "AbortError";
      last = new KlaviyoError(aborted ? "timeout" : "network", null);
      if (attempt < INLINE_RETRIES) { await wait(500 * (attempt + 1)); continue; }
      throw last;
    }
    clearTimeout(timer);

    const body = await readJson(res);
    if (res.ok) return { status: res.status, body: body as T };

    const apiCodes = errorCodes(body);
    const code = classify(res.status, apiCodes);
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      console.warn(
        `[klaviyo] ${path.split("?")[0]} ${res.status} codes=${apiCodes.join(",") || "-"} at=${errorPointers(body).join(",") || "-"}`,
      );
    }
    const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
    last = new KlaviyoError(code, res.status, { retryAfterMs, apiCodes });
    const retryable = code === "rate_limited" || code === "server_error";
    if (!retryable || attempt >= INLINE_RETRIES) throw last;
    const delay = retryAfterMs ?? 500 * (attempt + 1);
    if (delay > MAX_INLINE_WAIT_MS) throw last; // let the durable retry handle long waits
    await wait(delay);
  }
  throw last ?? new KlaviyoError("unexpected", null);
}
