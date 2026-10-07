#!/usr/bin/env node
// Private finite source operator. No DB call, token file, retry, activation,
// provider-wide scan or custom query. The two exact connector reads occur between
// `queries` and `capture`, inside the same server-claimed absolute deadline.
import { readFileSync, writeFileSync, mkdirSync, realpathSync, lstatSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const sha = b => createHash("sha256").update(b).digest("hex");
const fail = () => { throw Error("sales_event_operator_refused"); };
const json = path => JSON.parse(readFileSync(path, "utf8"));
const exact = (o, fields) => { if (!o || typeof o !== "object" || Array.isArray(o) ||
  JSON.stringify(Object.keys(o).sort()) !== JSON.stringify([...fields].sort())) fail(); return o; };
let token = "", stage = "arguments", output;
try {
  const [action, claimPath, runtimePath, locatorPath, paymentsPath, outputPath, ...extra] = process.argv.slice(2);
  if (extra.length || !["queries", "capture"].includes(action) || !claimPath || !runtimePath ||
      action === "capture" && (!locatorPath || !paymentsPath || !outputPath) ||
      action === "queries" && [locatorPath, paymentsPath, outputPath].some(Boolean)) fail();
  const claim = json(claimPath), pins = claim.customerCyclePins;
  const remaining = Date.parse(claim.deadline) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 300000) fail();
  // A finite hard guard also covers slow stdin and private serialization. The
  // readers use this same absolute deadline, with their smaller local limits.
  setTimeout(() => { console.error(JSON.stringify({ state: "held", stage: "deadline", enabled: false }));
    process.exit(1); }, remaining + 1000).unref();
  stage = "runtime_integrity";
  const root = realpathSync(runtimePath), manifestPath = join(root, "runtime-closure.json");
  const bytes = readFileSync(manifestPath), manifest = JSON.parse(bytes.toString("utf8"));
  if (sha(bytes) !== pins.captureClosureSha256 || !Array.isArray(manifest) || manifest.length > 150) fail();
  for (const row of manifest) {
    const operator = row.path === "scripts/analytics/sales-event-cycle-operator.mjs" && row.emitted === row.path;
    if ((!operator && (!/^src\/[A-Za-z0-9_./-]+\.(ts|json)$/.test(row.path) ||
        !/^src\/[A-Za-z0-9_./-]+\.(js|json)$/.test(row.emitted))) || row.path.includes("..") || row.emitted.includes("..")) fail();
    const file = join(root, "runtime", row.emitted);
    if (lstatSync(file).isSymbolicLink() || !realpathSync(file).startsWith(root + sep) || sha(readFileSync(file)) !== row.emittedSha256) fail();
  }
  const reader = manifest.find(r => r.path === "src/lib/analytics/customerScopedPurchaseSource.ts");
  if (!reader || reader.sha256 !== pins.sourceReaderSha256 || reader.emittedSha256 !== pins.sourceReaderEmissionSha256) fail();
  const operator = manifest.find(r => r.path === "scripts/analytics/sales-event-cycle-operator.mjs");
  if (!operator || operator.sha256 !== sha(readFileSync(fileURLToPath(import.meta.url)))) fail();
  const require = createRequire(import.meta.url);
  const originals = require(join(root, "runtime/src/lib/analytics/salesEventWindowCapture.js"));
  const customers = require(join(root, "runtime/src/lib/analytics/salesEventCustomerCapture.js"));
  const preparation = require(join(root, "runtime/src/lib/analytics/salesEventCyclePreparation.js"));
  if (action === "queries") {
    console.log(JSON.stringify({ cycleId: claim.cycleId, reportDate: claim.reportDate, deadline: claim.deadline,
      maxConnectorRequests: 2, queries: originals.salesEventCaptureQueries(claim.reportDate) }));
  } else {
    stage = "credentials";
    const chunks = []; let size = 0;
    for await (const b of process.stdin) { size += b.length; if (size > 8192) fail(); chunks.push(b); }
    const buffer = Buffer.concat(chunks), credentials = exact(JSON.parse(buffer.toString("utf8")), ["shop", "accessToken"]);
    if (credentials.shop !== claim.shop || typeof credentials.accessToken !== "string" ||
        !/^[A-Za-z0-9_-]{16,4096}$/.test(credentials.accessToken)) fail();
    token = credentials.accessToken; buffer.fill(0);
    stage = "originals";
    const native = await originals.captureSalesEventWindowOriginals({ claim, locator: json(locatorPath),
      paymentControls: json(paymentsPath), accessToken: token });
    let result = { native, state: native.state };
    if (native.state === "source_complete") {
      let source = native.source;
      const cycle = { cycleId: claim.cycleId, grantId: claim.grantId, grantRevision: claim.grantRevision,
        projectRef: claim.projectRef, shop: claim.shop, reportDate: claim.reportDate, startedAt: claim.startedAt,
        deadline: claim.deadline, authorizationRef: claim.authorizationRef, ...pins };
      stage = "customers";
      const customer = await customers.captureSalesEventCustomers({ source, cycle, accessToken: token });
      result = { native, customer, state: customer.state };
      if (customer.state === "source_complete") source = preparation.withCycleCustomers(source, customer.customers);
      if (["source_complete", "not_required"].includes(customer.state)) {
        stage = "preparation";
        const prepared = preparation.prepareSalesEventCycle({ claim, source, asOf: new Date().toISOString() });
        result = { ...result, state: "prepared_disabled", prepared };
      }
    }
    const sourceUsage = {
      connectorRequests: 2,
      connectorBytes: Buffer.byteLength(json(locatorPath).json) + Buffer.byteLength(json(paymentsPath).json),
      originalRequests: native.attemptedRequests,
      originalBytes: native.requests.reduce((n, r) => n + r.responseBytes, 0),
      customerRequests: result.customer?.requests ?? 0,
      customerBytes: result.customer?.responseBytes ?? 0,
      completeByteAudit: result.state === "prepared_disabled",
    };
    sourceUsage.totalRequests = sourceUsage.connectorRequests + sourceUsage.originalRequests + sourceUsage.customerRequests;
    sourceUsage.totalBytes = sourceUsage.connectorBytes + sourceUsage.originalBytes + sourceUsage.customerBytes;
    if (sourceUsage.totalRequests > 87 || sourceUsage.totalBytes > 87886080 || Date.now() >= Date.parse(claim.deadline)) fail();
    result = { ...result, sourceUsage };
    stage = "private_retention";
    const body = JSON.stringify(result, null, 2) + "\n";
    if (body.includes(token) || Buffer.byteLength(body) > 134217728) fail();
    output = resolve(outputPath); mkdirSync(output, { mode: 0o700 });
    writeFileSync(join(output, "source-and-preparation.private.json"), body, { flag: "wx", mode: 0o600 });
    token = "";
    console.log(JSON.stringify({ state: result.state, registered: false, enabled: false, sourceRetained: true }));
    if (result.state !== "prepared_disabled") process.exitCode = 1;
  }
} catch {
  token = "";
  console.error(JSON.stringify({ state: "held", stage, registered: false, enabled: false }));
  process.exitCode = 1;
}
