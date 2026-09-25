import { evidenceDigest } from "./evidenceIntake";
import { prepareRefresh, type RefreshInput } from "./refreshPlan";
import { mapMullySource, mullySourcePackets } from "./mymullySource";
import { mapApprovedShopifyCash, type ShopifyCashPolicy } from "./shopifyCash";

export type MullyRefreshInput = {
  refresh: RefreshInput;
  source: Parameters<typeof mapMullySource>[0];
  binding: { sourceId: string; schemaVersion: string; approvalRef: string; maxAgeSeconds: number };
  cashPolicy?: ShopifyCashPolicy;
};
/** Connect the customer adapter to the existing refresh graph. No side effects.
 * Only the five adapter-owned sections are replaced. Reviewed controls, commerce,
 * checkout, cash and campaign evidence cannot be manufactured by the adapter.
 */
export function prepareMullyRefresh(input: MullyRefreshInput) {
  const refresh = structuredClone(input.refresh), b = input.binding;
  if (input.source.mappingVersion !== refresh.policy.mappingVersion)
    throw new Error("mully_refresh_mapping_version");
  const packets = mullySourcePackets(input.source, { scope: refresh.intake.scope,
    sourceId: b.sourceId, schemaVersion: b.schemaVersion });
  if (input.cashPolicy) {
    if (input.cashPolicy.asOf !== refresh.intake.asOf) throw new Error("mully_cash_asof_mismatch");
    const payload = mapApprovedShopifyCash(input.source.orders, input.cashPolicy);
    packets.push({ section: "settlements", sourceId: b.sourceId, schemaVersion: b.schemaVersion,
      sourceRecordRef: `shopify-transactions:sha256:${evidenceDigest(input.source.orders)}`,
      scope: refresh.intake.scope, capturedAt: input.source.snapshot.capturedAt,
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
