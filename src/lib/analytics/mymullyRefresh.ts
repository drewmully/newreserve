import { assembleEvidence, evidenceDigest } from "./evidenceIntake";
import { prepareRefresh, type RefreshInput } from "./refreshPlan";
import { mapMullySource, mullySourcePackets } from "./mymullySource";
import { mapApprovedShopifyCash, type ShopifyCashPolicy } from "./shopifyCash";
import { mapJourneyCheckout, type JourneySnapshot } from "./journeySource";
import { mapDraftJourney, type DraftJourneySnapshot } from "./draftJourneySource";
import { mapShopifyOffers, mapShopifyLineDiscounts, type OfferRegistry } from "./shopifyOffers";
import { mullyCustomerId } from "./mymullySource";
import { mapJourneyPermissions, type JourneyPermissions } from "./journeyPermissions";
import type { FullBuildEvidence } from "./fullReportBuild";
import { mapShopifyAgreements, type AgreementDocument, type AgreementPolicy } from "./shopifyAgreements";

export type MullyRefreshInput = {
  refresh: RefreshInput;
  source: Parameters<typeof mapMullySource>[0];
  binding: { sourceId: string; schemaVersion: string; approvalRef: string; maxAgeSeconds: number };
  cashPolicy?: ShopifyCashPolicy;
  /** Source-bound original sales agreements for edited/refunded orders. The
   * replacement is derived here; callers cannot inject arbitrary ledger rows. */
  originalPurchases?: { orderGid: string; document: AgreementDocument; policy: AgreementPolicy }[];
  journey?: JourneySnapshot;
  draftJourney?: DraftJourneySnapshot;
  journeyPermissions?: JourneyPermissions;
  offers?: OfferRegistry;
  /** Explicitly retain independently reviewed historical evidence. Current
   * permission/removals always come from the fresh authority snapshot. */
  retainReviewed?: Partial<Record<"identity" | "customerHistory", string>>;
};
/** Connect the customer adapter to the existing refresh graph. No side effects.
 * Only the five adapter-owned sections are replaced. Reviewed controls, commerce,
 * checkout, cash and campaign evidence cannot be manufactured by the adapter.
 */
export function prepareMullyRefresh(input: MullyRefreshInput, secrets: { checkoutSecret?: string } = {}) {
  const refresh = structuredClone(input.refresh), b = input.binding;
  if (input.source.mappingVersion !== refresh.policy.mappingVersion)
    throw new Error("mully_refresh_mapping_version");
  let packets = mullySourcePackets(input.source, { scope: refresh.intake.scope,
    sourceId: b.sourceId, schemaVersion: b.schemaVersion });
  for (const [section, sourceId] of Object.entries(input.retainReviewed ?? {})) {
    if (!["identity", "customerHistory"].includes(section) || !sourceId?.trim())
      throw new Error("mully_invalid_retained_section");
    const prior = refresh.intake.packets.filter(p => p.section === section && p.sourceId === sourceId);
    if (prior.length !== 1 || sourceId === b.sourceId) throw new Error("mully_missing_reviewed_packet");
    // Keep the original capture time, binding, source reference and hash. The
    // intake validates these; we must never relabel stale evidence as fresh.
    const ids = new Set(input.source.snapshot.customers.map(c =>
      mullyCustomerId(input.source.snapshot.projectRef, input.source.snapshot.shop, c.id)));
    const referenced = section === "customerHistory" ? Object.keys(prior[0].payload as object)
      : (prior[0].payload as { customerId: string | null }[]).map(row => row.customerId).filter((id): id is string => id !== null);
    if (referenced.some(id => !ids.has(id))) throw new Error("mully_reviewed_customer_scope");
    packets = packets.filter(p => p.section !== section);
  }
  if (input.journeyPermissions) {
    const rows = mapJourneyPermissions(input.journeyPermissions, { ...refresh.intake.scope,
      posthogProject: refresh.policy.project, from: refresh.behavior.from, until: refresh.behavior.until,
      asOf: refresh.intake.asOf, mappingVersion: refresh.policy.mappingVersion });
    let original = packets.find(p => p.section === "identity");
    if (!original) {
      // Retained identity keeps its reviewed binding and freshness checks before
      // composition; the composite packet never launders unvalidated history.
      assembleEvidence(refresh.intake);
      original = refresh.intake.packets.find(p => p.section === "identity")!;
      const binding = refresh.intake.bindings.find(b => b.sourceId === original!.sourceId)!;
      if (Date.parse(refresh.expiresAt) - Date.parse(original.capturedAt) > binding.maxAgeSeconds * 1000)
        throw new Error("refresh_outlives_evidence");
    }
    const identity = original.payload as FullBuildEvidence["identity"];
    if (identity.some(row => row.namespace === "lean_subject")) throw new Error("journey_permission_namespace_collision");
    const payload = [...identity, ...rows];
    packets = packets.filter(p => p.section !== "identity");
    packets.push({ section: "identity", sourceId: b.sourceId, schemaVersion: b.schemaVersion,
      sourceRecordRef: `composite:sha256:${evidenceDigest([original, input.journeyPermissions.digest])}`,
      scope: refresh.intake.scope, capturedAt: new Date(Math.min(Date.parse(original.capturedAt),
        Date.parse(input.journeyPermissions.capturedAt))).toISOString(), sha256: evidenceDigest(payload), payload });
  }
  if (input.journey || input.draftJourney) {
    const config = {
      projectRef: refresh.intake.scope.projectRef, shop: refresh.intake.scope.shop,
      posthogProject: refresh.policy.project, sessionVersion: refresh.policy.sessionVersion,
      asOf: refresh.intake.asOf,
    };
    const payload = [
      ...(input.journey ? mapJourneyCheckout(input.source.orders, input.journey, config, secrets.checkoutSecret ?? "") : []),
      ...(input.draftJourney ? mapDraftJourney(input.source.orders, input.draftJourney, config, secrets.checkoutSecret ?? "") : []),
    ];
    packets.push({ section: "checkout", sourceId: b.sourceId, schemaVersion: b.schemaVersion,
      sourceRecordRef: `journey-receipts:sha256:${evidenceDigest([input.journey?.digest ?? null, input.draftJourney?.digest ?? null])}`,
      scope: refresh.intake.scope, capturedAt: new Date(Math.min(...[input.journey, input.draftJourney]
        .filter((s): s is JourneySnapshot | DraftJourneySnapshot => !!s).map(s => Date.parse(s.capturedAt)))).toISOString(),
      sha256: evidenceDigest(payload), payload });
  }
  {
    // Current edited-line discounts are not original-purchase offer evidence.
    const replaced = new Set(input.originalPurchases?.map(v => v.orderGid) ?? []);
    const offerOrders = input.source.orders.filter(o => !replaced.has(String(o.order.id)));
    const payload = [...mapShopifyLineDiscounts(offerOrders, refresh.intake.scope.shop),
      ...(input.offers ? mapShopifyOffers(offerOrders, input.offers) : [])];
    packets.push({ section: "offers", sourceId: b.sourceId, schemaVersion: b.schemaVersion,
      sourceRecordRef: `shopify-offers:sha256:${evidenceDigest({ orders: input.source.orders, registry: input.offers ?? null })}`,
      scope: refresh.intake.scope, capturedAt: input.source.snapshot.capturedAt,
      sha256: evidenceDigest(payload), payload });
  }
  if (input.cashPolicy) {
    if (input.cashPolicy.asOf !== refresh.intake.asOf) throw new Error("mully_cash_asof_mismatch");
    const payload = mapApprovedShopifyCash(input.source.orders, input.cashPolicy);
    packets.push({ section: "settlements", sourceId: b.sourceId, schemaVersion: b.schemaVersion,
      sourceRecordRef: `shopify-transactions:sha256:${evidenceDigest(input.source.orders)}`,
      scope: refresh.intake.scope, capturedAt: input.source.snapshot.capturedAt,
      sha256: evidenceDigest(payload), payload });
  }
  if (input.originalPurchases) {
    if (!input.originalPurchases.length || input.originalPurchases.length > 100)
      throw new Error("mully_original_purchase_budget");
    // Do not silently discard a reviewed replacement packet, or rebind/re-date
    // evidence from a different source. Mixed source sets need explicit review.
    const prior = refresh.intake.packets.find(p => p.section === "replacements");
    if (!prior || !Array.isArray(prior.payload) || prior.payload.length)
      throw new Error("mully_existing_replacements_require_review");
    const orders = new Map(input.source.orders.map(order => [String(order.order.id), order]));
    const seen = new Set<string>(), payload: FullBuildEvidence["replacements"] = [];
    for (const item of input.originalPurchases) {
      if (seen.has(item.orderGid)) throw new Error("mully_duplicate_original_purchase");
      seen.add(item.orderGid);
      const order = orders.get(item.orderGid);
      if (!order) throw new Error("mully_original_purchase_scope");
      payload.push(mapShopifyAgreements(order, item.document, item.policy));
    }
    const deferred = input.originalPurchases.map(item => ({
      orderGid: item.orderGid, sourceUpdatedAt: item.document.sourceUpdatedAt,
      evidenceRef: item.policy.sourceEvidenceRef,
    }));
    if (refresh.commercePolicy.deferredOrders?.length)
      throw new Error("mully_existing_deferred_orders_require_review");
    refresh.commercePolicy.deferredOrders = deferred;
    packets.push({ section: "replacements", sourceId: b.sourceId, schemaVersion: b.schemaVersion,
      sourceRecordRef: `shopify-agreements:sha256:${evidenceDigest(input.originalPurchases.map(v => v.document))}`,
      scope: refresh.intake.scope, capturedAt: new Date(Math.min(...input.originalPurchases
        .map(v => Date.parse(v.document.capturedAt)))).toISOString(),
      sha256: evidenceDigest(payload), payload });
  }
  const sections = new Set(packets.map(p => p.section));
  if (refresh.intake.bindings.some(prior => prior.sourceId === b.sourceId))
    throw new Error("mully_refresh_source_id_collision");
  refresh.intake.packets = [...refresh.intake.packets.filter(p => !sections.has(p.section)), ...packets];
  refresh.intake.bindings = [
    ...refresh.intake.bindings.map(prior => ({ ...prior, sections: prior.sections.filter(s => !sections.has(s)) }))
      .filter(prior => prior.sections.length),
    { ...b, sections: packets.map(p => p.section), independentControlSource: false },
  ];
  const bundle = prepareRefresh(refresh);
  return { bundle, sourceDigest: evidenceDigest(input.source), refresh };
}
