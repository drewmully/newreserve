import type { IdentityResolution } from "./identity";
import { nyDate, type Row } from "./primitives";

/** Explicit source-schema opt-in, not a caller boolean or a browser grant.
 * These fields come from the existing locked SQL authority reader. Its immutable
 * source/schema/scope, revision and fingerprint remain mandatory outer fences.
 */
export const PURCHASE_PROCESSING_SCHEMA = "customer-purchase-processing-v1";
export const PURCHASE_OWNERSHIP_EVIDENCE = "original_shopify_order_ownership";
type Authority = {
  schemaVersion: string; sourceId: string; scopeRef: string; evidenceRef: string;
};
const instant = (value: string) => {
  nyDate(value);
  return value.replace(/(?:\.(\d+))?Z$/, (_, digits: string | undefined) =>
    `.${(digits ?? "").padEnd(6, "0")}Z`);
};

/** Resolve factual purchase-time ownership using current purchase-processing
 * authorization. Historical consent stays unchanged, including unknown.
 * Explicit denial/removal, unresolved ownership and missing provenance refuse.
 * Never use this for browser observations, sessions or attribution identity.
 */
export function resolvePurchaseHistoryOwnership(input: {
  authority: Authority;
  namespace: string; identifier: string; occurredAt: string; version: string; publication: string;
  mappings: Row[]; currentlyPermitted: ReadonlySet<string>; removedCustomers: ReadonlySet<string>;
}): IdentityResolution {
  const a = input.authority;
  if (a.schemaVersion !== PURCHASE_PROCESSING_SCHEMA || !a.scopeRef.startsWith("purchase-history:") ||
    a.scopeRef.length <= "purchase-history:".length || !a.sourceId.trim() || !a.evidenceRef.trim() ||
    input.namespace !== "shopify_customer" || !/^[1-9]\d*$/.test(input.identifier))
    throw new Error("purchase_history_authorization_scope");
  const at = instant(input.occurredAt);
  const rows = input.mappings.filter(m => m.source_namespace === input.namespace &&
    m.source_identifier === input.identifier && m.mapping_version === input.version &&
    m.publication_id === input.publication && instant(String(m.valid_from)) <= at &&
    (m.valid_to === null || at < instant(String(m.valid_to))));
  if (rows.some(m => m.removal_status === "removed" || m.resolution_status === "removed" ||
    input.removedCustomers.has(String(m.customer_id)))) return { customerId: null, status: "removed" };
  if (rows.some(m => m.resolution_status === "conflicting") ||
    new Set(rows.map(m => m.customer_id).filter(Boolean)).size > 1)
    return { customerId: null, status: "conflicting" };
  // A denied analytic decision is not overwritten by the purchase source opt-in.
  if (rows.some(m => m.consent_status === "denied")) return { customerId: null, status: "not_permitted" };
  if (!rows.length || rows.some(m => m.resolution_status !== "resolved" || !m.customer_id ||
    m.removal_status !== "active" || !["permitted", "unknown"].includes(String(m.consent_status)) ||
    m.evidence_type !== PURCHASE_OWNERSHIP_EVIDENCE || typeof m.evidence_ref !== "string" || !m.evidence_ref.trim()))
    return { customerId: null, status: "unresolved" };
  const customerId = String(rows[0].customer_id);
  if (!input.currentlyPermitted.has(customerId)) return { customerId: null, status: "not_permitted" };
  return { customerId, status: "resolved" };
}
