import type { FullBuildEvidence } from "./fullReportBuild";
import { mapJourneyPermissions, readJourneyPermissions } from "./journeyPermissions";
import type { BehaviorSource } from "./posthogSource";
import { nyDate } from "./primitives";
import { sourceObject } from "./shopifySource";

/** Optional, immutable full_builds.behavior policy. It authorizes only the
 * existing bounded permission RPC, never customer ownership or source discovery.
 */
export type JourneyPermissionSource = {
  version: "journey-permission-source-v1";
  projectRef: string; shop: string; posthogProject: string;
  from: string; until: string; approvalRef: string;
  validUntil: string; maxReadAgeSeconds: number;
};
export type ProductionBehaviorSource = BehaviorSource & {
  journeyPermissionSource?: JourneyPermissionSource;
};

export function validateJourneyPermissionSource(behavior: ProductionBehaviorSource, target: {
  projectRef: string; shop: string; mappingVersion: string;
}, evidence: FullBuildEvidence): JourneyPermissionSource | undefined {
  if (!Object.hasOwn(behavior, "journeyPermissionSource")) return undefined;
  const p = sourceObject(behavior.journeyPermissionSource);
  const fields = ["version", "projectRef", "shop", "posthogProject", "from", "until",
    "approvalRef", "validUntil", "maxReadAgeSeconds"];
  if (Object.keys(p).length !== fields.length || fields.some(k => !Object.hasOwn(p, k)) ||
      p.version !== "journey-permission-source-v1" || p.projectRef !== target.projectRef ||
      p.shop !== target.shop || p.posthogProject !== behavior.project ||
      p.from !== behavior.from || p.until !== behavior.until ||
      typeof p.approvalRef !== "string" || !p.approvalRef.trim() || p.approvalRef.length > 256 ||
      typeof p.validUntil !== "string" || !Number.isInteger(p.maxReadAgeSeconds) ||
      Number(p.maxReadAgeSeconds) < 1 || Number(p.maxReadAgeSeconds) > 300 ||
      !target.mappingVersion.trim() ||
      !Object.values(behavior.families).some(f => f.identityNamespace === "lean_subject"))
    throw new Error("invalid_journey_permission_source");
  nyDate(p.validUntil);
  // A retained customer link in this namespace needs its own reviewed
  // intersection with current authority. Never overwrite or guess that link.
  if (evidence.identity.some(row => row.namespace === "lean_subject"))
    throw new Error("journey_permission_identity_collision");
  return p as JourneyPermissionSource;
}

/** Read current authority independently of Shopify/customer-history collection.
 * The capture clock is the invocation clock, NOT the historical event cutoff.
 * This does not create reconciliation proofs, campaign links or approval gates.
 */
export async function prepareProductionBehaviorEvidence(input: {
  behavior: ProductionBehaviorSource; evidence: FullBuildEvidence;
  projectRef: string; shop: string; mappingVersion: string;
  readKey?: string; sourceReadApproved?: boolean; request?: typeof fetch;
  clock?: () => string;
}): Promise<{ evidence: FullBuildEvidence; assertFresh: () => void }> {
  const p = validateJourneyPermissionSource(input.behavior, input, input.evidence);
  if (!p) return { evidence: input.evidence, assertFresh: () => {} };
  if (input.sourceReadApproved !== true || !input.readKey?.trim())
    throw new Error("journey_permission_source_not_authorized");
  const clock = input.clock ?? (() => new Date().toISOString());
  const capturedAt = clock();
  nyDate(capturedAt);
  if (Date.parse(capturedAt) >= Date.parse(p.validUntil))
    throw new Error("journey_permission_source_expired");
  const snapshot = await readJourneyPermissions({
    projectRef: p.projectRef, shop: p.shop, posthogProject: p.posthogProject,
    from: p.from, until: p.until, capturedAt,
  }, input.readKey, input.request);
  const assertFresh = () => {
    const at = clock();
    nyDate(at);
    if (Date.parse(at) < Date.parse(capturedAt) ||
        Date.parse(at) - Date.parse(capturedAt) > p.maxReadAgeSeconds * 1000 ||
        Date.parse(at) >= Date.parse(p.validUntil))
      throw new Error("journey_permission_source_stale");
  };
  assertFresh();
  const permissions = mapJourneyPermissions(snapshot, {
    ...p, asOf: capturedAt, mappingVersion: input.mappingVersion,
  });
  if (input.evidence.identity.length + permissions.length > 10000)
    throw new Error("journey_permission_identity_budget");
  return { evidence: { ...input.evidence, identity: [...input.evidence.identity, ...permissions] }, assertFresh };
}
