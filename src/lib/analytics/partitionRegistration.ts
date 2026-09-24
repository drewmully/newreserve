import type { AnalyticsRpcClient } from "./rpcStore";
import { pipelineRpc, validatePipelineTarget } from "./shopifyPipeline";
import { assemblePartitionPages, validatePartitionInventory, type PartitionPage } from "./partitionInventory";
import { sourceString } from "./shopifySource";
import { assembleEvidence, type EvidenceBinding, type EvidencePacket, type EvidenceScope } from "./evidenceIntake";

/** Explicit owner path. Registration/staging stays disabled and cannot be called
 * by read-only preparation or the runtime service role. Activation is separate. */
export async function registerPartitionRefresh(options: {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string;
  bundle: Record<string, unknown>; pages: PartitionPage[];
}) {
  validatePipelineTarget(options.projectRef, options.databaseUrl);
  const base = options.bundle.base as Record<string, unknown>;
  const policy = base.policy as Record<string, unknown>;
  const manifest = validatePartitionInventory(policy.partitionInventory, {
    projectRef: options.projectRef, shop: sourceString(base.shop),
  });
  assemblePartitionPages(manifest, options.pages);
  const full = options.bundle.full as { policy: { asOf: string }; evidence: Record<string, EvidencePacket["payload"]> };
  const assembled = assembleEvidence({ scope: options.bundle.evidenceScope as EvidenceScope,
    bindings: options.bundle.evidenceBindings as EvidenceBinding[], asOf: full.policy.asOf,
    packets: (options.bundle.lineage as EvidencePacket[]).map(p => ({ ...p, payload: full.evidence[p.section] })) });
  if (assembled.digest !== manifest.evidenceDigest) throw new Error("partition_evidence_binding");
  if (Buffer.byteLength(JSON.stringify({ p_bundle: options.bundle })) > 8000000 ||
      options.pages.some(p => Buffer.byteLength(JSON.stringify({ p_run: base.runId,
        p_project_ref: options.projectRef, p_child: p.child, p_number: p.number, p_payload: p.payload })) > 8000000))
    throw new Error("partition_rpc_byte_budget");
  const registered = await pipelineRpc(options.client, "lean_refresh_register", { p_bundle: options.bundle });
  if (registered !== options.bundle.runId) throw new Error("partition_registration_changed");
  for (const child of manifest.children) for (const page of child.pages) {
    const source = options.pages.find(p => p.child === child.id && p.number === page.number)!;
    const result = await pipelineRpc(options.client, "lean_partition_stage_page", {
      p_run: base.runId, p_project_ref: options.projectRef, p_child: child.id,
      p_number: page.number, p_payload: source.payload,
    });
    if (result !== true) throw new Error("partition_stage_changed");
  }
  return { runId: String(options.bundle.runId), state: "registered_disabled",
    pages: options.pages.length, enabled: false, published: false };
}
