/** Offline fixed /reports/workbook observer. No receipt path substitution. */
import ts from "typescript";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEvidence } from "./accept-production-reports.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function acceptWorkbookRuntimeReportsFile(inputPath, outputPath) {
  const info = lstatSync(inputPath);
  if (!info.isFile() || info.size > 16000000) throw new Error("invalid_evidence");
  const input = parseEvidence(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(inputPath)));
  const scratch = mkdtempSync(join(tmpdir(), "analytics-workbook-runtime-acceptance-"));
  try {
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true,
      strict: true, skipLibCheck: true, noEmitOnError: true, rootDir: join(root, "src"), outDir: scratch };
    const program = ts.createProgram([join(root, "src/lib/analytics/workbookDestinationAcceptance.ts")], options);
    if (ts.getPreEmitDiagnostics(program).some(d => d.category === ts.DiagnosticCategory.Error) || program.emit().emitSkipped)
      throw new Error("acceptance_compile_failed");
    const require = createRequire(import.meta.url);
    const receipt = require(join(scratch, "lib/analytics/workbookDestinationAcceptance.js")).acceptWorkbookRuntimeDestination(input);
    mkdirSync(outputPath, { mode: 0o700 });
    writeFileSync(join(outputPath, "workbook-runtime-destination-validation.json"), JSON.stringify(receipt, null, 2) + "\n",
      { flag: "wx", mode: 0o600 });
    return { state: receipt.state, hostedCalls: 0, metricAcceptance: false,
      liveDeliveryVerified: false, atomicCrossResourceRefresh: false };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error("usage");
    const result = acceptWorkbookRuntimeReportsFile(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(result));
    if (result.state === "not_accepted") process.exitCode = 1;
  } catch {
    console.error("workbook_runtime_destination_not_accepted: check private evidence and a new output directory; no hosted action performed");
    process.exitCode = 1;
  }
}
