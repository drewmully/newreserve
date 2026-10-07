import { expect, it, vi } from "vitest";
import { prepareGoogleDeliveryReport } from "@/lib/analytics/googleDeliveryReport";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import { normalizeSpendBase } from "@/lib/analytics/spend";
import { googleDeliveryFixture } from "../fixtures/analyticsGoogleDelivery";

it("calculates the Google-only ratio of sums without promoting the incomplete marketing inventory", () => {
  const f = googleDeliveryFixture();
  expect(prepareGoogleDeliveryReport(f.input)).toMatchObject({ spend_usd: "12.000000", clicks: "4",
    impressions: "20", ctr: "0.200000", cpc_usd: "3.000000", cpm_usd: "600.000000",
    report_scope: "single_google_account", readiness: { ctr: "observed_unverified" }, is_stale: true });
  expect(f.fresh.marketingInventory.complete).toBe(false);
});
it.each(["clicks", "impressions"] as const)("withholds a %s mismatch even when the account total agrees", field => {
  const f = googleDeliveryFixture();
  f.binding.control.campaigns[0][field] = "0";
  f.binding.control.campaigns[1][field] = field === "clicks" ? "4" : "20";
  const row = prepareGoogleDeliveryReport(f.input);
  expect(row[field]).toBeNull(); expect(row.ctr).toBeNull();
  expect(field === "clicks" ? row.cpm_usd : row.cpc_usd).not.toBeNull();
});
it("keeps supported CPM while unknown clicks withhold CTR/CPC", () => {
  const f = googleDeliveryFixture(); delete f.fresh.bases[0].rows[0].clicks;
  expect(prepareGoogleDeliveryReport(f.input)).toMatchObject({
    clicks: null, ctr: null, cpc_usd: null, cpm_usd: "600.000000", spend_usd: "12.000000" });
});
it("keeps explicit zero counts and null zero-denominator ratios", () => {
  const f = googleDeliveryFixture();
  for (const r of f.fresh.bases[0].rows) { r.clicks = "0"; r.impressions = "0"; }
  for (const r of f.binding.control.campaigns) { r.clicks = "0"; r.impressions = "0"; }
  f.binding.control.clicks = "0"; f.binding.control.impressions = "0";
  expect(prepareGoogleDeliveryReport(f.input)).toMatchObject({
    clicks: "0", impressions: "0", ctr: null, cpc_usd: null, cpm_usd: null });
});
it("does not invent zero delivery from an independently verified empty monetary day", () => {
  const f = googleDeliveryFixture();
  f.fresh.bases[0].rows = []; f.fresh.bases[0].verifiedEmpty = true;
  Object.assign(f.fresh.controls[0], { campaigns: [], totalCostMicros: "0", verifiedEmpty: true });
  Object.assign(f.binding.control, { campaigns: [], clicks: "0", impressions: "0" });
  expect(prepareGoogleDeliveryReport(f.input)).toMatchObject({
    spend_usd: "0.000000", clicks: null, impressions: null, ctr: null, cpc_usd: null, cpm_usd: null });
});
it.each(["stale", "cost_mismatch", "incomplete"] as const)("withholds amounts and rates for %s source evidence", bad => {
  const f = googleDeliveryFixture();
  if (bad === "stale") f.fresh.bases[0].completedAt = new Date(Date.now() - 3600000).toISOString();
  if (bad === "cost_mismatch") f.fresh.controls[0].totalCostMicros = "1";
  if (bad === "incomplete") f.fresh.bases[0].paginationComplete = false;
  expect(prepareGoogleDeliveryReport(f.input)).toMatchObject({
    spend_usd: null, clicks: null, impressions: null, ctr: null, cpc_usd: null, cpm_usd: null });
});
it.each(["-1", "9007199254740992", "1.5"])("rejects invalid count %s without rounding", count => {
  const f = googleDeliveryFixture(); f.binding.control.clicks = count;
  expect(() => prepareGoogleDeliveryReport(f.input)).toThrow();
});
it.each(["account", "date", "extra", "future_control", "same_evidence"] as const)("rejects or withholds %s control", bad => {
  const f = googleDeliveryFixture();
  if (bad === "account") f.binding.accountId = "9999999999";
  if (bad === "date") f.input.throughDate = "2026-01-02";
  if (bad === "extra") Object.assign(f.binding, { enabled: true });
  if (bad === "future_control") f.binding.control.capturedAt = new Date(Date.now() + 50000).toISOString();
  if (bad === "same_evidence") f.binding.control.evidenceRef = f.fresh.bases[0].evidenceRef;
  if (bad === "future_control" || bad === "same_evidence")
    expect(prepareGoogleDeliveryReport(f.input)).toMatchObject({ clicks: null, impressions: null });
  else expect(() => prepareGoogleDeliveryReport(f.input)).toThrow();
});

async function run(optional: boolean, rejectFinish = false) {
  const f = googleDeliveryFixture();
  const facts = f.full.base;
  facts.marketing_spend_daily = normalizeSpendBase(f.fresh.bases[0], "observed:google-base");
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const input = { state: "ready", publication: f.input.publication, shop: f.input.shop,
    fromDate: f.input.fromDate, throughDate: f.input.throughDate, inputHash: "fixture-input",
    policy: { ...f.packet.fullPolicy, ...(optional ? { googleDelivery: f.binding } : {}) },
    facts, evidence: f.full.evidence, behavior: {}, freshGoogleSpend: f.fresh, deferredOrders: [] };
  const request = vi.fn(() => { throw new Error("no_source_requests"); });
  const client = { async rpc(name: string, args: Record<string, unknown>) {
    calls.push({ name, args });
    if (name === "lean_full_inputs") return { data: input, error: null };
    if (name.includes("finish") && rejectFinish) throw new Error("ambiguous_finish");
    return { data: true, error: null };
  } };
  const execution = runFullReportJob({ client, projectRef: f.input.projectRef,
    databaseUrl: `https://${f.input.projectRef}.supabase.co`, runId: "google-fixture", posthogKey: "", request });
  return { execution, calls, request };
}
it("sends one atomic optional finish and leaves the five core reports unchanged", async () => {
  const r = await run(true);
  expect(await r.execution).toMatchObject({ state: "complete" });
  expect(r.calls.map(c => c.name)).toEqual(["lean_full_inputs", "lean_full_claim", "lean_google_delivery_finish"]);
  const args = r.calls[2].args;
  expect(Object.keys(args.p_reports as object)).toHaveLength(5);
  expect(args.p_google_report).toMatchObject({ spend_usd: "12.000000" });
  expect((args.p_reports as Record<string, Record<string, unknown>[]>).store_daily[0])
    .toMatchObject({ spend_usd: null, ncac_usd: null, mer: null });
  expect(r.request).not.toHaveBeenCalled();
});
it("preserves the unbound original finish call, payload fields and output", async () => {
  const r = await run(false);
  expect(await r.execution).toMatchObject({ state: "complete" });
  expect(r.calls.map(c => c.name)).toEqual(["lean_full_inputs", "lean_full_claim", "lean_full_finish"]);
  expect(Object.keys(r.calls[2].args).sort()).toEqual(
    ["p_run", "p_project_ref", "p_token", "p_input_hash", "p_facts", "p_reports", "p_manifest"].sort());
});
it("does not fail, retry or write again after an ambiguous optional finish", async () => {
  const r = await run(true, true); await expect(r.execution).rejects.toThrow("pipeline_storage_unavailable");
  expect(r.calls.map(c => c.name)).toEqual(["lean_full_inputs", "lean_full_claim", "lean_google_delivery_finish"]);
});
