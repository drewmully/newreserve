import { checked, nyDate, type Row } from "./primitives";
export type IdentityEvidence = {
  namespace: string; identifier: string; customerId: string | null;
  from: string; to: string | null; type: string; evidenceRef: string; mappingVersion: string;
  resolution: "resolved" | "unresolved" | "conflicting" | "removed";
  consent: "permitted" | "denied" | "unknown";
  removal: "active" | "removed";
};
/** Preserve microsecond interval boundaries rather than Date's millisecond truncation. */
function instant(t: string): string {
  nyDate(t);
  return t.replace(/(?:\.(\d+))?Z$/, (_, digits: string | undefined) => `.${(digits ?? "").padEnd(6, "0")}Z`);
}
export function normalizeIdentity(e: IdentityEvidence, publication: string): Row {
  if (e.to && instant(e.to) <= instant(e.from)) throw new Error("invalid_identity_interval");
  if (e.customerId && (!/^[a-zA-Z0-9_:-]{8,128}$/.test(e.customerId) || /^\d+$/.test(e.customerId))) throw new Error("non_surrogate_customer_id");
  if (e.resolution === "resolved" && !e.customerId) throw new Error("missing_canonical_customer");
  return checked("identity_map", {
    source_namespace: e.namespace, source_identifier: e.identifier, customer_id: e.customerId,
    valid_from: e.from, valid_to: e.to, evidence_type: e.type, evidence_ref: e.evidenceRef,
    mapping_version: e.mappingVersion, resolution_status: e.resolution,
    consent_status: e.consent, removal_status: e.removal, publication_id: publication,
  });
}
export type IdentityResolution = { customerId: string | null; status: "resolved" | "unresolved" | "conflicting" | "removed" | "not_permitted" };
export function resolveTemporalIdentity(input: {
  namespace: string; identifier: string; occurredAt: string; version: string; publication: string;
  mappings: Row[]; currentlyPermitted: ReadonlySet<string>; removedCustomers: ReadonlySet<string>;
}): IdentityResolution {
  const at = instant(input.occurredAt);
  const mappings = input.mappings.filter(m => m.source_namespace === input.namespace &&
    m.source_identifier === input.identifier && m.mapping_version === input.version && m.publication_id === input.publication &&
    instant(m.valid_from as string) <= at && (m.valid_to === null || at < instant(m.valid_to as string)));
  if (mappings.some(m => m.removal_status === "removed" || m.resolution_status === "removed" ||
      input.removedCustomers.has(m.customer_id as string))) return { customerId: null, status: "removed" };
  if (mappings.some(m => m.resolution_status === "conflicting") ||
      new Set(mappings.map(m => m.customer_id).filter(Boolean)).size > 1) return { customerId: null, status: "conflicting" };
  // An anonymous/unresolved subject can withdraw too. Do not let the absence
  // of a canonical customer bypass an explicit analytics denial.
  if (mappings.some(m => m.consent_status !== "permitted")) return { customerId: null, status: "not_permitted" };
  if (!mappings.length || mappings.some(m => m.resolution_status !== "resolved" || !m.customer_id)) return { customerId: null, status: "unresolved" };
  const id = mappings[0].customer_id as string;
  if (!input.currentlyPermitted.has(id) || mappings.some(m => m.consent_status !== "permitted")) return { customerId: null, status: "not_permitted" };
  return { customerId: id, status: "resolved" };
}
export type HistoryEvidence = {
  expectedSources: string[]; completeSources: string[]; approvalRef: string | null;
  migrationsReconciled: boolean;
};
export function buildCustomer(customerId: string, resolution: IdentityResolution["status"],
  permitted: boolean, evidence: HistoryEvidence, orders: Row[], publication: string): Row {
  const ready = resolution === "resolved" && permitted && !!evidence.approvalRef &&
    evidence.migrationsReconciled && evidence.expectedSources.length > 0 &&
    evidence.expectedSources.every(s => evidence.completeSources.includes(s));
  const eligible = ready ? orders.filter(o => o.publication_id === publication && o.customer_id === customerId &&
    o.eligibility_status === "eligible" && typeof o.paid_at === "string") : [];
  eligible.sort((a, b) => instant(a.paid_at as string).localeCompare(instant(b.paid_at as string)) ||
    String(a.order_id).localeCompare(String(b.order_id)));
  const first = eligible[0];
  return checked("customers", {
    customer_id: customerId, publication_id: publication,
    identity_status: resolution === "not_permitted" ? "unresolved" : resolution,
    analytics_permitted: permitted && resolution === "resolved", history_complete: ready,
    first_eligible_order_id: first?.order_id ?? null, first_eligible_order_at: first?.paid_at ?? null,
    acquisition_date: first ? nyDate(first.paid_at as string) : null,
  });
}
