/** Explicitly gated read-only source extraction. This command is never invoked
 * by preparation, application startup or a scheduler. It creates a private
 * snapshot for review; no database mutation or pipeline activation is possible.
 */
import ts from "typescript";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export async function readSourceFile(inputPath, outputPath, env = process.env, request = fetch) {
  if (env.LEAN_MULLY_SOURCE_READ_APPROVED !== "true") throw new Error("mully_source_read_disabled");
  if (!env.LEAN_MULLY_SOURCE_READ_KEY?.trim()) throw new Error("mully_source_read_key_required");
  if (statSync(inputPath).size > 8000000 || existsSync(outputPath)) throw new Error("mully_source_file_budget");
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  if (input.kind !== undefined && !["journey-receipts-v1", "journey-permissions-v1"].includes(input.kind))
    throw new Error("mully_source_kind");
  if (!input.approvalRef?.trim() || input.projectRef !== env.LEAN_MULLY_SOURCE_PROJECT_REF ||
      input.shop !== env.LEAN_SHOPIFY_SHOP_DOMAIN) throw new Error("mully_source_target_mismatch");
  const scratch = mkdtempSync(join(tmpdir(), "mully-source-"));
  try {
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true,
      resolveJsonModule: true, skipLibCheck: true, noEmitOnError: true,
      strict: true, rootDir: join(root, "src"), outDir: scratch };
    const journey = input.kind === "journey-receipts-v1";
    const permissions = input.kind === "journey-permissions-v1";
    const program = ts.createProgram([join(root, `src/lib/analytics/${permissions ? "journeyPermissions" : journey ? "journeySource" : "mymullySource"}.ts`)], options);
    if (ts.getPreEmitDiagnostics(program).some(d => d.category === ts.DiagnosticCategory.Error) ||
        program.emit().emitSkipped) throw new Error("mully_source_compile_failed");
    const require = createRequire(import.meta.url);
    if (!permissions && (!Array.isArray(input.orders) || input.orders.some(doc => doc.shop !== input.shop)))
      throw new Error("mully_order_shop_mismatch");
    const common = { projectRef: input.projectRef, shop: input.shop, capturedAt: new Date().toISOString() };
    let snapshot;
    if (permissions) {
      const { readJourneyPermissions } = require(join(scratch, "lib/analytics/journeyPermissions.js"));
      if (input.posthogProject !== env.LEAN_POSTHOG_PROJECT_ID) throw new Error("journey_permission_project");
      snapshot = await readJourneyPermissions({ ...common, posthogProject: input.posthogProject,
        from: input.from, until: input.until }, env.LEAN_MULLY_SOURCE_READ_KEY, request);
    } else if (journey) {
      const { orderCartTokens, readJourneyReceipts } = require(join(scratch, "lib/analytics/journeySource.js"));
      snapshot = await readJourneyReceipts({ ...common, requestedCarts: orderCartTokens(input.orders) },
        env.LEAN_MULLY_SOURCE_READ_KEY, request);
    } else {
      const { orderCustomerIds, readMullyCustomers } = require(join(scratch, "lib/analytics/mymullySource.js"));
      snapshot = await readMullyCustomers({ ...common,
        entities: input.entities, customerIds: orderCustomerIds(input.orders),
      }, env.LEAN_MULLY_SOURCE_READ_KEY, request);
    }
    writeFileSync(outputPath, JSON.stringify(snapshot, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    return { state: "snapshot_only", ...(permissions ? { grants: snapshot.grants.length } :
      journey ? { receipts: snapshot.receipts.length } : { customers: snapshot.customers.length }), digest: snapshot.digest,
      registered: false, enabled: false };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error("usage");
    console.log(JSON.stringify(await readSourceFile(process.argv[2], process.argv[3])));
  } catch {
    console.error("mully_source_read_failed: verify the approved target and scoped source input");
    process.exitCode = 1;
  }
}
