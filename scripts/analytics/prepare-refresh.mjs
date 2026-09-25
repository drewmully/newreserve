/** Offline preparation only. Compiles reviewed repository modules into an
 * isolated temporary directory, validates JSON input and writes a disabled-job
 * bundle plus diagnostic HogQL. No database, vendor call or activation.
 */
import ts from "typescript";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export function prepareFile(inputPath, outputPath) {
  if (statSync(inputPath).size > 8000000) throw new Error("refresh_input_too_large");
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  const scratch = mkdtempSync(join(tmpdir(), "analytics-prepare-"));
  try {
    const entry = join(root, "src/lib/analytics/refreshPlan.ts");
    const view = join(root, "src/lib/analytics/behaviorView.ts");
    const mully = join(root, "src/lib/analytics/mymullyRefresh.ts");
    const options = {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true,
      resolveJsonModule: true, skipLibCheck: true, noEmitOnError: true,
      strict: true, rootDir: join(root, "src"), outDir: scratch,
    };
    const program = ts.createProgram([entry, view, mully], options);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.some(d => d.category === ts.DiagnosticCategory.Error))
      throw new Error("refresh_preparation_compile_failed");
    if (program.emit().emitSkipped) throw new Error("refresh_preparation_compile_failed");
    // Only trusted repository code is executed; JSON cannot specify modules.
    const require = createRequire(import.meta.url);
    const compiled = source => join(scratch, relative(options.rootDir, source).replace(/\.ts$/, ".js"));
    if (!compiled(entry).startsWith(scratch + sep)) throw new Error("invalid_preparation_path");
    const customerSource = input.kind === "mully-source-v1"
      ? require(compiled(mully)).prepareMullyRefresh(input, { checkoutSecret: process.env.LEAN_CHECKOUT_CONTEXT_SECRET }) : null;
    const bundle = customerSource?.bundle ?? require(compiled(entry)).prepareRefresh(input);
    const diagnostic = bundle.full.policy.behaviorMode === "excluded"
      ? { state: "excluded", materialize: false, query: null,
        reason: "Explicit commerce-only scope; behavioral metrics remain withheld." }
      : require(compiled(view)).behaviorDiagnosticView(
        customerSource ? customerSource.refresh.behavior : input.behavior);
    mkdirSync(outputPath, { recursive: true, mode: 0o700 });
    // Never silently overwrite an existing reviewed bundle.
    writeFileSync(join(outputPath, "refresh-bundle.json"), JSON.stringify(bundle, null, 2) + "\n",
      { flag: "wx", mode: 0o600 });
    writeFileSync(join(outputPath, "analytics-events-view.json"), JSON.stringify(diagnostic, null, 2) + "\n",
      { flag: "wx", mode: 0o600 });
    return { runId: bundle.runId, state: "prepared_only", registered: false, enabled: false };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error("usage");
    console.log(JSON.stringify(prepareFile(process.argv[2], process.argv[3])));
  } catch {
    console.error("refresh_preparation_failed: provide reviewed input JSON and a new private output directory");
    process.exitCode = 1;
  }
}
