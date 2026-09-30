/** Offline saved-input comparison only. No credentials, source or database client. */
import ts from "typescript";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export function acceptGoogleSpendFile(inputPath, outputPath) {
  if (statSync(inputPath).size > 16000000 || existsSync(outputPath))
    throw new Error("spend_acceptance_file_budget_or_existing_output");
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  const scratch = mkdtempSync(join(tmpdir(), "analytics-spend-acceptance-"));
  try {
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true, resolveJsonModule: true,
      strict: true, skipLibCheck: true, noEmitOnError: true, rootDir: join(root, "src"), outDir: scratch };
    const program = ts.createProgram([join(root, "src/lib/analytics/googleSpendAcceptance.ts")], options);
    if (ts.getPreEmitDiagnostics(program).some(d => d.category === ts.DiagnosticCategory.Error) || program.emit().emitSkipped)
      throw new Error("spend_acceptance_compile_failed");
    const require = createRequire(import.meta.url);
    const result = require(join(scratch, "lib/analytics/googleSpendAcceptance.js")).acceptGoogleSpend(input);
    mkdirSync(outputPath, { mode: 0o700 });
    writeFileSync(join(outputPath, "spend-validation.json"), JSON.stringify(result, null, 2) + "\n",
      { flag: "wx", mode: 0o600 });
    return { state: result.state, numericAcceptance: false, hostedCalls: 0, exportReady: false };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error("usage");
    const result = acceptGoogleSpendFile(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(result));
    if (result.state !== "offline_controls_match") process.exitCode = 2;
  } catch {
    console.error("spend_acceptance_failed: check reviewed inputs and a new output directory; no hosted action performed");
    process.exitCode = 1;
  }
}
