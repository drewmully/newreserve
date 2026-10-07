import { isDeepStrictEqual } from "node:util";
import { amendedPipelinePolicy } from "./pipelineIngestionAmendment";
import { mappingPolicy, PIPELINE_VERSION, type PipelinePolicy } from "./shopifyPipeline";
import { composeRetainedOrderReports } from "./shopifyRetainedOrder";
import { projectPilotRetention } from "./shopifyRetention";
import type { PilotSource } from "./shopifyPilotSource";

/** Offline only. No fetch, database client, retry, claim or dispatch capability.
 * SQL owns the current binding and PostgreSQL-JSONB output digest checks.
 * The original policy and retained source are inputs, never rewritten.
 */
export function prepareHistoricalRecovery(input: {
  operationId: string; originalWorkId: string; source: PilotSource;
  policy: PipelinePolicy; admission: unknown; fromTime: string; untilTime: string;
}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.operationId) ||
      !/^[1-9][0-9]*$/.test(input.originalWorkId)) throw new Error("recovery_identity_invalid");
  if (!isDeepStrictEqual(input.source, projectPilotRetention(input.source)))
    throw new Error("recovery_retained_shape_mismatch");
  const created = Date.parse(String(input.source.commerce.order.createdAt));
  const from = Date.parse(input.fromTime), until = Date.parse(input.untilTime);
  if (![created, from, until].every(Number.isFinite) || from >= until || created < from || created >= until)
    throw new Error("recovery_outside_approved_window");
  const amended = amendedPipelinePolicy(input.source, input.policy, input.admission);
  if (!amended.admission || !amended.admission.retainedSourceSha256)
    throw new Error("recovery_amendment_required");
  const output = composeRetainedOrderReports(input.source, mappingPolicy(input.source, amended.policy),
    `recovery:${input.operationId.toLowerCase()}`,
    `lean_private.pipeline_snapshots/${input.originalWorkId}`, PIPELINE_VERSION,
    input.policy.orderSize ? { orderSizeSidecar: true } : undefined);
  return {
    facts: output.facts, reports: output.reports, productReports: output.productReports,
    orderItemSizes: output.order_item_sizes ?? null,
  };
}
