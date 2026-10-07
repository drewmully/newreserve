import { metaHourlyPacketFromCaptures, type MetaGraphCapture } from "./metaHourlySpendInput";
import { sourceObject, sourceString } from "./shopifySource";

/** Parse genuine typed native receipts from the fixed three-request Computer
 * transport. No input accepts a packet, complete flag, row hash or desired sum. */
export function prepareAutomaticMeta(claim: unknown, raw: unknown, asOf = new Date().toISOString()) {
  const c = sourceObject(claim), b = sourceObject(c.binding), r = sourceObject(raw);
  if (c.state !== "meta_capture" || b.provider !== "meta" || b.accountId !== "2796962933960445" ||
    b.projectRef !== "xnfjdbpjuaezxjgargto" || b.shop !== "mullybox-store.myshopify.com" ||
    b.currency !== "USD" || b.timezone !== "America/Los_Angeles" || b.apiVersion !== "v25.0" ||
    b.maxRequests !== 3 || b.accountLimit !== 49 || b.campaignLimit !== 1001 ||
    Object.keys(r).sort().join(",") !== "accountHours,campaignHours,metadata" ||
    b.notBefore !== b.freshnessCutoffAt || Date.now() >= Date.parse(sourceString(b.deadline)))
    throw new Error("automatic_meta_binding");
  const receipts = [r.metadata, r.accountHours, r.campaignHours].map(sourceObject);
  if (receipts.some(x => Date.parse(sourceString(x.startedAt)) < Date.parse(sourceString(b.notBefore)) ||
    Date.parse(sourceString(x.finishedAt)) > Date.parse(sourceString(b.deadline))) ||
    receipts.reduce((sum, x) => sum + Number(x.bodyBytes), 0) > Number(b.maxBytes))
    throw new Error("automatic_meta_capture_window");
  // Metadata native id retains the act_ prefix. Never relabel the numeric scope.
  const accountId = sourceString(sourceObject(sourceObject(r.metadata).response).id);
  if (accountId !== "act_2796962933960445") throw new Error("automatic_meta_account");
  return metaHourlyPacketFromCaptures({
    projectRef: sourceString(b.projectRef), shop: sourceString(b.shop),
    generationId: `auto_meta_${sourceString(b.cycleId)}`, accountId, date: sourceString(b.date),
    approvalRef: sourceString(b.approvalRef), actorRef: sourceString(b.actorRef),
    controlApprovalRef: sourceString(b.controlApprovalRef),
    freshnessCutoffAt: sourceString(b.freshnessCutoffAt), asOf,
    metadata: r.metadata as MetaGraphCapture, accountHours: r.accountHours as MetaGraphCapture,
    campaignHours: r.campaignHours as MetaGraphCapture,
  });
}
