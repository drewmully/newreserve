/** Explicit read-only extraction. This never registers, enables or runs jobs. */
import ts from "typescript";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export async function readAgreementFile(inputPath, outputPath, env = process.env, request = fetch) {
  if (env.LEAN_SHOPIFY_AGREEMENTS_READ_APPROVED !== "true") throw new Error("agreement_read_disabled");
  if (statSync(inputPath).size > 100000 || existsSync(outputPath)) throw new Error("agreement_file_budget");
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  if (input.kind !== "shopify-agreements-v1" || !input.approvalRef?.trim() ||
      input.shop !== env.LEAN_SHOPIFY_SHOP_DOMAIN || !env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN?.trim())
    throw new Error("agreement_read_target");
  const scratch = mkdtempSync(join(tmpdir(), "shopify-agreements-"));
  try {
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true,
      resolveJsonModule: true, skipLibCheck: true, noEmitOnError: true,
      strict: true, rootDir: join(root, "src"), outDir: scratch };
    const program = ts.createProgram([join(root, "src/lib/analytics/shopifyAgreements.ts")], options);
    if (ts.getPreEmitDiagnostics(program).some(d => d.category === ts.DiagnosticCategory.Error) ||
        program.emit().emitSkipped) throw new Error("agreement_compile_failed");
    const require = createRequire(import.meta.url);
    const { readShopifyAgreements } = require(join(scratch, "lib/analytics/shopifyAgreements.js"));
    const snapshot = await readShopifyAgreements({ shop: input.shop, orderGid: input.orderGid,
      sourceUpdatedAt: input.sourceUpdatedAt, maxRequests: input.maxRequests,
      accessToken: env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN, fetcher: request });
    writeFileSync(outputPath, JSON.stringify(snapshot, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    return { state: "snapshot_only", agreements: snapshot.agreements.length, registered: false, enabled: false };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error("usage");
    console.log(JSON.stringify(await readAgreementFile(process.argv[2], process.argv[3])));
  } catch {
    console.error("agreement_read_failed: verify the approved shop, scoped read token and input");
    process.exitCode = 1;
  }
}
