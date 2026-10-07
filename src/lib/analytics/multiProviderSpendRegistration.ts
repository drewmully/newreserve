import { prepareMetaSpendDay, spendRef, type MetaSpendPacket } from "./metaSpendInput";
import type { FreshSpendMarketingInventory } from "./googleSpendReportInput";

/** Owner-only preparation. Both SQL registrations remain disabled; returned
 * arguments are not evidence that any authority or source has been verified. */
export function prepareMetaSpendRegistration(packet: MetaSpendPacket, timing: {
  freshnessCutoffAt: string; asOf: string;
}) {
  prepareMetaSpendDay(packet, { projectRef: packet.projectRef, shop: packet.shop,
    publication: "private:meta-preparation", ...timing });
  if (!/^[a-z]{20}$/.test(packet.projectRef) ||
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(packet.shop) ||
    Buffer.byteLength(JSON.stringify(packet)) > 1000000) throw new Error("meta_registration_target_or_budget");
  return { state: "prepared", enabled: false, registered: false, metricAcceptance: false,
    registration: { rpc: packet.version === 2 ? "lean_marketing_spend_hourly_register" : "lean_marketing_spend_day_register",
      args: { p_packet: structuredClone(packet) } } };
}
export function prepareMultiProviderSpendBinding(input: {
  runId: string; projectRef: string; generationIds: string[];
  inventory: FreshSpendMarketingInventory; approvalRef: string; actorRef: string;
}) {
  if (!spendRef(input.runId) || input.runId.length > 128 || !/^[a-z]{20}$/.test(input.projectRef) ||
    ![input.approvalRef, input.actorRef].every(spendRef) || !Array.isArray(input.generationIds) ||
    input.generationIds.length < 1 || input.generationIds.length > 49 ||
    new Set(input.generationIds).size !== input.generationIds.length ||
    input.generationIds.some(id => !spendRef(id) || !/^[A-Za-z0-9:_-]{1,128}$/.test(id)) ||
    !input.inventory || Buffer.byteLength(JSON.stringify(input.inventory)) > 64000)
    throw new Error("marketing_binding_scope");
  return { state: "prepared", enabled: false, registered: false, metricAcceptance: false,
    registration: { rpc: "lean_marketing_spend_bind", args: {
      p_run: input.runId, p_project_ref: input.projectRef, p_generations: [...input.generationIds],
      p_inventory: structuredClone(input.inventory), p_approval_ref: input.approvalRef, p_actor_ref: input.actorRef,
    } } };
}
