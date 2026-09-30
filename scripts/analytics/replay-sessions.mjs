/** Local-only replay of reviewed evidence and a saved PostHog response.
 * No hosted client, RPC, credentials, source collection, registration or release.
 * Expected aggregates must be supplied independently; they are never derived
 * from the candidate. A match is not certification of the supplied authority.
 */
import ts from "typescript";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fields = ["report_date", "stage_id", "measured_sessions", "mature_sessions",
  "converted_sessions", "session_conversion_rate"];
const acquisitionFields = ["report_date", "channel", "campaign_bucket", "model_version",
  "attributed_purchase_merchandise_net_usd", "credited_orders", "spend_usd", "first_party_roas"];
const attributionFields = ["order_id", "model_version", "acquisition_session_key", "touch_event_key",
  "channel", "campaign_id", "attribution_status", "lookback_days", "conversion_time_basis",
  "credit_weight", "conversion_date", "attribution_complete"];
const exactRows = (rows, columns) => Array.isArray(rows) && rows.length <= 20000 &&
  rows.every(row => row && typeof row === "object" &&
    Object.keys(row).sort().join() === [...columns].sort().join());
const requiredRef = value => typeof value === "string" && !!value.trim();
function canonicalRows(rows, columns, keys) {
  const seen = new Set();
  return rows.map(row => {
    const key = JSON.stringify(keys.map(name => row[name]));
    if (seen.has(key)) throw new Error("replay_duplicate_expected_or_actual_key");
    seen.add(key);
    return { key, row: Object.fromEntries(columns.map(name => [name, row[name]])) };
  }).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(value => value.row);
}
const project = row => Object.fromEntries(fields.map(key => [key, row[key]]));
const sort = rows => rows.sort((a, b) =>
  JSON.stringify([a.report_date, a.stage_id]).localeCompare(JSON.stringify([b.report_date, b.stage_id])));

/** Dependencies are trusted compiled repository modules, never input paths. */
export async function replaySessions(input, modules) {
  const { prepareRefresh, readPosthogBehavior, boundBehaviorEvidence, buildFullReports, evidenceDigest,
    deferredOrders, verifyDeferredReplacements } = modules;
  if (input.version !== 1 || input.expected?.independentlyExtracted !== true ||
      typeof input.expected.evidenceRef !== "string" || !input.expected.evidenceRef.trim() ||
      !Array.isArray(input.expected.funnel) || !input.expected.funnel.length ||
      input.expected.funnel.length > 20000 ||
      input.expected.funnel.some(row => !row || Object.keys(row).sort().join() !== [...fields].sort().join()))
    throw new Error("replay_expected_evidence_required");
  // Optional acquisition validation is additional to the unchanged funnel
  // invocation. Require exact independent order-credit AND aggregate controls;
  // a ratio-only check cannot establish which touch/campaign received credit.
  const acquisition = input.expected.acquisition;
  if (acquisition !== undefined && (!acquisition ||
      Object.keys(acquisition).sort().join() !== "daily,evidenceRef,independentlyExtracted,orders" ||
      acquisition.independentlyExtracted !== true || !requiredRef(acquisition.evidenceRef) ||
      !exactRows(acquisition.orders, attributionFields) || !exactRows(acquisition.daily, acquisitionFields)))
    throw new Error("replay_acquisition_evidence_required");
  const expectedOrders = acquisition && canonicalRows(acquisition.orders, attributionFields, ["order_id", "model_version"]);
  const acquisitionKeys = ["report_date", "channel", "campaign_bucket", "model_version"];
  const expectedAcquisition = acquisition && canonicalRows(acquisition.daily, acquisitionFields, acquisitionKeys);
  const bundle = prepareRefresh(input.refresh);
  const { policy, behavior, evidence } = bundle.full;
  if (!Array.isArray(input.deferredOrders)) throw new Error("replay_deferred_inventory_required");
  verifyDeferredReplacements(deferredOrders(input.deferredOrders), evidence, bundle.base.shop);
  if ((policy.behaviorMode ?? "required") !== "required")
    throw new Error("replay_behavior_required");
  // Same report-job boundary: no future window or unmapped/missing families.
  if (behavior.project !== policy.project || Date.parse(behavior.until) > Date.parse(policy.asOf) ||
      Object.values(policy.stages).some(f => !Object.hasOwn(behavior.families, f)) ||
      Object.keys(behavior.families).some(f => !Object.values(policy.stages).includes(f)))
    throw new Error("full_behavior_policy_mismatch");
  let replayReads = 0;
  const events = await readPosthogBehavior(behavior, "offline-replay-not-a-credential", async (url, init) => {
    if (url !== `${behavior.host}/api/projects/${behavior.project}/query/` ||
        init?.method !== "POST" || ++replayReads !== 1) throw new Error("replay_transport_scope");
    return Response.json(input.posthogResponse);
  });
  const result = buildFullReports({
    base: input.base, publication: `full:${bundle.runId}`, shop: bundle.base.shop,
    fromDate: bundle.base.fromDate, throughDate: bundle.base.throughDate, policy,
    evidence: boundBehaviorEvidence(evidence, behavior, policy, input.base), events,
  });
  const actual = sort(result.reports.funnel_daily.map(project));
  const expected = sort(input.expected.funnel.map(project));
  if (evidenceDigest(actual) !== evidenceDigest(expected)) throw new Error("replay_funnel_mismatch");
  let acquisitionReceipt;
  if (acquisition) {
    const orders = canonicalRows(result.facts.order_attribution, attributionFields, ["order_id", "model_version"]);
    const daily = canonicalRows(result.reports.acquisition_daily, acquisitionFields, acquisitionKeys);
    if (evidenceDigest(orders) !== evidenceDigest(expectedOrders)) throw new Error("replay_attribution_mismatch");
    if (evidenceDigest(daily) !== evidenceDigest(expectedAcquisition)) throw new Error("replay_acquisition_mismatch");
    acquisitionReceipt = {
      comparedOrders: orders.length, attributionDigest: evidenceDigest(orders),
      expectedDigest: evidenceDigest(acquisition),
      numericRoasRows: daily.filter(row => row.first_party_roas !== null).length,
      nullRoasRows: daily.filter(row => row.first_party_roas === null).length,
      daily,
    };
  }
  // Never write facts, event/identity/order/session IDs, or source payloads.
  return {
    state: "offline_expected_match", certified: false, registered: false, enabled: false,
    hostedCalls: 0, replayReads, inputDigest: evidenceDigest(input),
    evidenceDigest: bundle.evidenceDigest, expectedDigest: evidenceDigest(input.expected),
    definition: policy.definition, funnelVersion: policy.funnelVersion,
    conversionWindowDays: policy.conversionWindowDays ?? 7, asOf: policy.asOf,
    caveat: "Saved-input comparison only; permission, coverage and expected-result authority require source review.",
    funnel: actual,
    // Exact private order/session/event linkage is compared above, not emitted.
    ...(acquisitionReceipt ? { acquisition: acquisitionReceipt } : {}),
  };
}

export async function replaySessionFile(inputPath, outputPath) {
  if (statSync(inputPath).size > 16000000 || existsSync(outputPath))
    throw new Error("replay_file_budget_or_existing_output");
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  const scratch = mkdtempSync(join(tmpdir(), "analytics-session-replay-"));
  try {
    const names = ["refreshPlan", "posthogSource", "fullReportJob", "fullReportBuild", "evidenceIntake", "deferredCommerce"];
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true,
      resolveJsonModule: true, skipLibCheck: true, noEmitOnError: true,
      strict: true, rootDir: join(root, "src"), outDir: scratch };
    const program = ts.createProgram(names.map(n => join(root, `src/lib/analytics/${n}.ts`)), options);
    if (ts.getPreEmitDiagnostics(program).some(d => d.category === ts.DiagnosticCategory.Error) ||
        program.emit().emitSkipped) throw new Error("replay_compile_failed");
    const require = createRequire(import.meta.url);
    const modules = Object.assign({}, ...names.map(n => require(join(scratch, `lib/analytics/${n}.js`))));
    const result = await replaySessions(input, modules);
    // Exclusive directory creation: no overwrite and no partial candidate on mismatch.
    mkdirSync(outputPath, { mode: 0o700 });
    writeFileSync(join(outputPath, "session-validation.json"), JSON.stringify(result, null, 2) + "\n",
      { flag: "wx", mode: 0o600 });
    return { state: result.state, hostedCalls: 0, registered: false, enabled: false };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error("usage");
    console.log(JSON.stringify(await replaySessionFile(process.argv[2], process.argv[3])));
  } catch {
    // Avoid leaking input identifiers or parser contents into shell logs.
    console.error("session_replay_failed: check reviewed inputs and a new output directory; no hosted action performed");
    process.exitCode = 1;
  }
}
