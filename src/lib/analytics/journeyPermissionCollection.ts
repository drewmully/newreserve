import { evidenceDigest, validateRetainedEvidence, type EvidenceBinding, type EvidencePacket } from "./evidenceIntake";
import { mapJourneyPermissions, type JourneyPermissions } from "./journeyPermissions";
import type { RefreshInput } from "./refreshPlan";

export type JourneyPermissionCollection = {
  /** Digest of {packet, binding}, including the original authority and capture. */
  retainedIdentityDigest: string;
  binding: Pick<EvidenceBinding, "sourceId" | "schemaVersion" | "approvalRef" | "maxAgeSeconds">;
};
const text = (value: unknown) => typeof value === "string" && !!value.trim() && value.length <= 512;
/** Validate the exact reviewed history before reading grants. This composition
 * is permission-specific; it cannot update customer consent/removal/history. */
export function planJourneyPermissionCollection(refresh: RefreshInput, option: JourneyPermissionCollection,
  commerceSourceId: string, env: Record<string, string | undefined>, asOf: string) {
  if (!option || typeof option !== "object" || Array.isArray(option) ||
      Object.keys(option).some(k => !["retainedIdentityDigest", "binding"].includes(k)))
    throw new Error("journey_collection_option");
  const b = option.binding;
  if (!b || Object.keys(b).some(k => !["sourceId", "schemaVersion", "approvalRef", "maxAgeSeconds"].includes(k)) ||
      !text(b.sourceId) || !text(b.schemaVersion) || !text(b.approvalRef) ||
      !Number.isSafeInteger(b.maxAgeSeconds) || b.maxAgeSeconds < 1 || b.maxAgeSeconds > 604800 ||
      b.sourceId === commerceSourceId || refresh.intake.bindings.some(prior => prior.sourceId === b.sourceId))
    throw new Error("journey_collection_binding");
  validateRetainedEvidence({ ...refresh.intake, asOf }, ["orderIdentities", "checkout"]);
  const packet = refresh.intake.packets.find(p => p.section === "identity")! as EvidencePacket<"identity">;
  const binding = refresh.intake.bindings.find(b => b.sourceId === packet.sourceId)!;
  if (option.retainedIdentityDigest !== evidenceDigest({ packet, binding }))
    throw new Error("journey_collection_retained_mismatch");
  if (packet.payload.some(row => row.namespace === "lean_subject"))
    throw new Error("journey_permission_namespace_collision");
  const { from, until } = refresh.behavior, posthogProject = refresh.policy.project;
  if (posthogProject !== env.LEAN_POSTHOG_PROJECT_ID || refresh.behavior.project !== posthogProject ||
      !/^[1-9]\d{0,9}$/.test(posthogProject) || !env.LEAN_MULLY_SOURCE_READ_KEY?.trim() ||
      !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(until)) ||
      Date.parse(from) >= Date.parse(until) || Date.parse(until) > Date.parse(asOf) ||
      Date.parse(until) - Date.parse(from) > 93 * 86400000)
    throw new Error("journey_collection_scope");
  const ageAtExpiry = Date.parse(refresh.expiresAt) - Date.parse(packet.capturedAt);
  if (!Number.isFinite(ageAtExpiry) || ageAtExpiry > Math.min(binding.maxAgeSeconds, b.maxAgeSeconds) * 1000)
    throw new Error("refresh_outlives_evidence");
  return structuredClone({ packet, binding, compositeBinding: b, config: {
    projectRef: refresh.intake.scope.projectRef, shop: refresh.intake.scope.shop, posthogProject, from, until,
  } });
}

/** Append anonymous grants ONCE, outside partition order scoping. Preserve every
 * original row, bind both source authorities, and use the older capture time. */
export function composeCollectedJourneyPermissions(refresh: RefreshInput,
  plan: ReturnType<typeof planJourneyPermissionCollection>, snapshot: JourneyPermissions) {
  const prior = refresh.intake.packets.find(p => p.section === "identity");
  if (evidenceDigest(prior) !== evidenceDigest(plan.packet)) throw new Error("journey_collection_retained_changed");
  const rows = mapJourneyPermissions(snapshot, { ...plan.config, asOf: refresh.intake.asOf,
    mappingVersion: refresh.policy.mappingVersion });
  const capturedAt = new Date(Math.min(Date.parse(plan.packet.capturedAt), Date.parse(snapshot.capturedAt))).toISOString();
  if (Date.parse(refresh.expiresAt) - Date.parse(plan.packet.capturedAt) > plan.binding.maxAgeSeconds * 1000 ||
      Date.parse(refresh.expiresAt) - Date.parse(capturedAt) > plan.compositeBinding.maxAgeSeconds * 1000)
    throw new Error("refresh_outlives_evidence");
  const payload = [...plan.packet.payload, ...rows];
  const packet: EvidencePacket<"identity"> = { section: "identity",
    sourceId: plan.compositeBinding.sourceId, schemaVersion: plan.compositeBinding.schemaVersion,
    scope: refresh.intake.scope, capturedAt, payload, sha256: evidenceDigest(payload),
    sourceRecordRef: `journey-composite:sha256:${evidenceDigest({
      retained: { packet: plan.packet, binding: plan.binding }, snapshot,
    })}` };
  refresh.intake.packets = [...refresh.intake.packets.filter(p => p.section !== "identity"), packet];
  refresh.intake.bindings = [...refresh.intake.bindings.map(b => ({
    ...b, sections: b.sections.filter(s => s !== "identity"),
  })).filter(b => b.sections.length), { ...plan.compositeBinding, sections: ["identity"], independentControlSource: false }];
  return packet;
}
