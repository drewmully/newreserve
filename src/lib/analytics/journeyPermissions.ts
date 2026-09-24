import { evidenceDigest } from "./evidenceIntake";
import type { IdentityEvidence } from "./identity";
import { nyDate } from "./primitives";
import { shopifyShop } from "./shopifySource";
export type JourneyPermissions = {
  projectRef: string; shop: string; posthogProject: string; from: string; until: string; capturedAt: string;
  grants: { subjectId: string; validFrom: string; expiresAt: string; revokedAt: string | null;
    permissionEvidenceRef: string }[];
  digest: string;
};
/** A subject may be anonymous but its permission must not be guessed. This
 * snapshot never asserts customer ownership or copies cookie/bearer hashes. */
export function mapJourneyPermissions(snapshot: JourneyPermissions, expected: {
  projectRef: string; shop: string; posthogProject: string; from: string; until: string; asOf: string;
  mappingVersion: string;
}): IdentityEvidence[] {
  const { digest, ...payload } = snapshot;
  [snapshot.from, snapshot.until, snapshot.capturedAt, expected.asOf].forEach(nyDate);
  if (digest !== evidenceDigest(payload) || snapshot.projectRef !== expected.projectRef ||
      snapshot.shop !== expected.shop || snapshot.posthogProject !== expected.posthogProject ||
      snapshot.from !== expected.from || snapshot.until !== expected.until ||
      Date.parse(snapshot.capturedAt) > Date.parse(expected.asOf) || snapshot.grants.length > 10000)
    throw new Error("journey_permission_scope");
  const seen = new Set<string>();
  return snapshot.grants.map(g => {
    [g.validFrom, g.expiresAt].forEach(nyDate);
    if (g.revokedAt !== null) nyDate(g.revokedAt);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(g.subjectId) || seen.has(g.subjectId) ||
        !g.permissionEvidenceRef?.trim() || Date.parse(g.validFrom) >= Date.parse(g.expiresAt) ||
        Date.parse(g.expiresAt) - Date.parse(g.validFrom) > 86400000 ||
        Date.parse(g.validFrom) >= Date.parse(snapshot.until) || Date.parse(g.expiresAt) <= Date.parse(snapshot.from) ||
        g.revokedAt !== null && (Date.parse(g.revokedAt) < Date.parse(g.validFrom) ||
          Date.parse(g.revokedAt) > Date.parse(snapshot.capturedAt))) throw new Error("journey_permission_grant");
    // Subject IDs are unique per grant. They must not be reused across sessions
    // or permission decisions; a canonical customer mapping is separate evidence.
    seen.add(g.subjectId);
    return { namespace: "lean_subject", identifier: g.subjectId, customerId: null,
      from: g.validFrom, to: g.expiresAt, type: "analytics_permission_authority",
      evidenceRef: g.permissionEvidenceRef, mappingVersion: expected.mappingVersion,
      resolution: g.revokedAt === null ? "unresolved" : "removed",
      consent: g.revokedAt === null ? "permitted" : "denied", removal: g.revokedAt === null ? "active" : "removed" };
  });
}
export async function readJourneyPermissions(config: Omit<JourneyPermissions, "grants" | "digest">,
  readKey: string, request: typeof fetch = fetch): Promise<JourneyPermissions> {
  shopifyShop(config.shop); [config.from, config.until, config.capturedAt].forEach(nyDate);
  if (!/^[a-z]{20}$/.test(config.projectRef) || !/^[1-9]\d{0,9}$/.test(config.posthogProject) ||
      !readKey.trim() || Date.parse(config.until) <= Date.parse(config.from) ||
      Date.parse(config.until) - Date.parse(config.from) > 93 * 86400000 ||
      Date.parse(config.until) > Date.parse(config.capturedAt)) throw new Error("journey_permission_read_scope");
  const response = await request(`https://${config.projectRef}.supabase.co/rest/v1/rpc/lean_journey_permissions_read`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { apikey: readKey, Authorization: `Bearer ${readKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_project: config.projectRef, p_shop: config.shop, p_posthog: config.posthogProject,
      p_from: config.from, p_until: config.until }),
  });
  if (!response.ok) throw new Error("journey_permission_read_unavailable");
  const reader = response.body?.getReader(); if (!reader) throw new Error("journey_permission_read_empty");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 4000000) { await reader.cancel(); throw new Error("journey_permission_read_budget"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!Array.isArray(raw) || raw.length > 10000) throw new Error("journey_permission_read_overflow");
  const utc = (value: unknown) => {
    if (typeof value !== "string") throw new Error("journey_permission_timestamp");
    const v = value.replace(/\+00:00$/, "Z"); nyDate(v); return v;
  };
  const grants = raw.map(g => ({ subjectId: g.subjectId, validFrom: utc(g.validFrom), expiresAt: utc(g.expiresAt),
    revokedAt: g.revokedAt === null ? null : utc(g.revokedAt), permissionEvidenceRef: g.permissionEvidenceRef }));
  const payload = { projectRef: config.projectRef, shop: config.shop, posthogProject: config.posthogProject,
    from: config.from, until: config.until, capturedAt: config.capturedAt, grants };
  const snapshot = { ...payload, digest: evidenceDigest(payload) };
  mapJourneyPermissions(snapshot, { ...config, asOf: config.capturedAt, mappingVersion: "reader-validation" });
  return snapshot;
}
