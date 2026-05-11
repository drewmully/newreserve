/**
 * Reserve Founders Shortlist v1 — campaign constants & helpers.
 *
 * One campaign, 9,285 invited contacts, 300 spots. Drives traffic to
 * /reserve/founders with a personalization token in the URL. Two paths
 * to claim: pay-now ($50 off via FOUNDERS50 code) or reserve-by-reply
 * (48-hour hold, no auto-charge).
 *
 * NOTE: all values can be overridden via env so we don't hard-code
 * deadlines / codes / spot caps in source. Defaults match Drew's
 * decisions on 2026-05-11.
 */
import crypto from "node:crypto";

export const FOUNDERS_CAMPAIGN_ID =
  process.env.FOUNDERS_CAMPAIGN_ID ?? "reserve_founders_v1";

/** Shopify discount code applied at checkout when a tokened invite clicks "Claim My Spot". */
export const FOUNDERS_DISCOUNT_CODE =
  process.env.NEXT_PUBLIC_FOUNDERS_DISCOUNT_CODE ?? "FOUNDERS50";

/** Total founders batch size — when claimed >= cap, the LP swaps to waitlist mode. */
export const FOUNDERS_TOTAL_SPOTS = parsePositiveInt(
  process.env.FOUNDERS_TOTAL_SPOTS,
  300,
);

/** First batch ship date (ISO). Used as the campaign deadline in copy. */
export const FOUNDERS_SHIP_DATE = process.env.FOUNDERS_SHIP_DATE ?? "2026-05-27";

/** How long a reply-to-reserve hold lasts before the spot returns to the pool. */
export const FOUNDERS_RESERVATION_HOLD_HOURS = parsePositiveInt(
  process.env.FOUNDERS_RESERVATION_HOLD_HOURS,
  48,
);

/**
 * HMAC secret for personalization tokens. MUST be set in production.
 * Falls back to a deterministic dev value so local builds don't 500.
 */
const TOKEN_SECRET =
  process.env.FOUNDERS_TOKEN_SECRET ??
  "dev-only-founders-secret-do-not-use-in-prod";

export interface FoundersTokenPayload {
  /** Lowercased email. */
  email: string;
  /** Customer 360 id, if known at send time — speeds up server-side lookup. */
  customerId?: string;
  /** Score tier at the time of send: A/B/C/D/E. Drives copy + display. */
  tier?: "A" | "B" | "C" | "D" | "E";
  /** First name when available — pre-fills "Hey {firstName}". */
  firstName?: string;
  /** Unix seconds when the token was issued. */
  iat: number;
  /** Campaign id — lets us invalidate cleanly later. */
  cmp: string;
}

/** Sign a payload into a compact `base64url(payload).base64url(hmac)` token. */
export function signFoundersToken(
  payload: Omit<FoundersTokenPayload, "iat" | "cmp"> &
    Partial<Pick<FoundersTokenPayload, "iat" | "cmp">>,
): string {
  const full: FoundersTokenPayload = {
    email: payload.email.trim().toLowerCase(),
    customerId: payload.customerId,
    tier: payload.tier,
    firstName: payload.firstName,
    iat: payload.iat ?? Math.floor(Date.now() / 1000),
    cmp: payload.cmp ?? FOUNDERS_CAMPAIGN_ID,
  };
  const body = base64url(JSON.stringify(full));
  const sig = base64url(
    crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest(),
  );
  return `${body}.${sig}`;
}

/** Verify a token, returning the decoded payload or `null` if invalid. */
export function verifyFoundersToken(
  token: string | null | undefined,
): FoundersTokenPayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = base64url(
    crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest(),
  );
  // Constant-time comparison
  if (
    expectedSig.length !== sig.length ||
    !crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(sig))
  ) {
    return null;
  }
  let decoded: FoundersTokenPayload;
  try {
    decoded = JSON.parse(base64urlDecode(body).toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof decoded.email !== "string" ||
    typeof decoded.iat !== "number" ||
    typeof decoded.cmp !== "string"
  ) {
    return null;
  }
  if (decoded.cmp !== FOUNDERS_CAMPAIGN_ID) return null;
  // No expiry by design — campaign ends at FOUNDERS_SHIP_DATE; UI hides the
  // founders pricing automatically once spots are gone.
  return decoded;
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padLen), "base64");
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}
