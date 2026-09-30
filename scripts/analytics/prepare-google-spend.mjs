/** Offline only. Reads an operator manifest and prints a PREPARED 038 payload.
 * Never loads credentials, opens a database, registers jobs or calls a source.
 */
import ts from "typescript";
import { readFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export function prepareGoogleSpendFile(inputPath) {
  if (statSync(inputPath).size > 16384) throw new Error("fresh_spend_input_too_large");
  const manifest = JSON.parse(readFileSync(inputPath, "utf8"));
  const scratch = mkdtempSync(join(tmpdir(), "analytics-fresh-spend-"));
  try {
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true, resolveJsonModule: true,
      strict: true, skipLibCheck: true, noEmitOnError: true, rootDir: join(root, "src"), outDir: scratch };
    const program = ts.createProgram([join(root, "src/lib/analytics/googleSpendRegistration.ts")], options);
    if (ts.getPreEmitDiagnostics(program).some(d => d.category === ts.DiagnosticCategory.Error) || program.emit().emitSkipped)
      throw new Error("fresh_spend_compile_failed");
    const require = createRequire(import.meta.url);
    return require(join(scratch, "lib/analytics/googleSpendRegistration.js")).prepareFreshGoogleSpend(manifest);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error("usage");
    console.log(JSON.stringify(prepareGoogleSpendFile(process.argv[2]), null, 2));
  } catch { console.error("fresh_spend_prepare_failed"); process.exitCode = 1; }
}
