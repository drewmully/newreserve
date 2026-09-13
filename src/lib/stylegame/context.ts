import { createHmac, timingSafeEqual } from "node:crypto";

export const STYLEGAME_CONTEXT_VERSION = "1";
export const STYLEGAME_IDENTITY_SOURCE = "first_party_cookie";

export interface StylegameAttribute {
  name: string;
  value: string;
}

function signaturePayload(anon: string, sessionId: string | null): string {
  return `stylegame-context:v${STYLEGAME_CONTEXT_VERSION}:${anon}:${sessionId ?? ""}`;
}

export function signStylegameContext(
  anon: string,
  sessionId: string | null,
  secret: string
): string {
  return createHmac("sha256", secret)
    .update(signaturePayload(anon, sessionId))
    .digest("hex");
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function sanitizeStylegameId(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return SAFE_ID.test(trimmed) ? trimmed : null;
}

export function sanitizeStylegameAttribution(value: string | null): string | null {
  const trimmed = value?.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 128) ?? "";
  return trimmed || null;
}

export function readStylegameCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(/;\s*/)) {
    const [key, ...rest] = part.split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

export function readTrustedCheckoutAnon(headers: Headers): string | null {
  if (headers.get("sec-gpc") === "1") return null;
  return sanitizeStylegameId(
    readStylegameCookie(headers.get("cookie"), "mully_anon_id")
  );
}

export function readTrustedOrderAnon(
  attributes: StylegameAttribute[] | null | undefined,
  secret = process.env.SHOPIFY_WEBHOOK_SECRET
): string | null {
  const read = (key: string) =>
    attributes?.find((attribute) => attribute.name === key)?.value ?? null;
  const anon = sanitizeStylegameId(read("mully_anon_id"));
  const sessionId = sanitizeStylegameId(read("stylegame_session_id"));
  const providedSignature = read("stylegame_context_signature");
  if (
    !anon ||
    !secret ||
    read("stylegame_context_version") !== STYLEGAME_CONTEXT_VERSION ||
    read("stylegame_identity_source") !== STYLEGAME_IDENTITY_SOURCE ||
    !providedSignature ||
    !/^[a-f0-9]{64}$/.test(providedSignature)
  ) {
    return null;
  }

  const expected = signStylegameContext(anon, sessionId, secret);
  const providedBuffer = Buffer.from(providedSignature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return timingSafeEqual(providedBuffer, expectedBuffer) ? anon : null;
}
