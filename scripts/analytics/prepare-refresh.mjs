/** Offline preparation by default. Compiles reviewed repository modules into an
 * isolated temporary directory, validates JSON input and writes a disabled-job
 * bundle plus diagnostic HogQL. --collect-sources is separately approved,
 * bounded read-only collection; neither mode registers or activates anything.
 */
import ts from "typescript";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, statSync, existsSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export function prepareFile(inputPath, outputPath) {
  if (statSync(inputPath).size > 8000000) throw new Error("refresh_input_too_large");
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  if (["mully-collect-v1", "mully-partition-collect-v1"].includes(input.kind)) throw new Error("refresh_collection_requires_explicit_flag");
  const scratch = mkdtempSync(join(tmpdir(), "analytics-prepare-"));
  try {
    const entry = join(root, "src/lib/analytics/refreshPlan.ts");
    const view = join(root, "src/lib/analytics/behaviorView.ts");
    const mully = join(root, "src/lib/analytics/mymullyRefresh.ts");
    const partition = join(root, "src/lib/analytics/partitionRefresh.ts");
    const options = {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true,
      resolveJsonModule: true, skipLibCheck: true, noEmitOnError: true,
      strict: true, rootDir: join(root, "src"), outDir: scratch,
    };
    const program = ts.createProgram([entry, view, mully, partition], options);
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
    const bundle = input.kind === "mully-partition-prepared-v1"
      ? require(compiled(partition)).preparePartitionRefresh(input)
      : customerSource?.bundle ?? require(compiled(entry)).prepareRefresh(input);
    const diagnostic = bundle.full.policy.behaviorMode === "excluded"
      ? { state: "excluded", materialize: false, query: null,
        reason: "Explicit commerce-only scope; behavioral metrics remain withheld." }
      : require(compiled(view)).behaviorDiagnosticView(
        customerSource ? customerSource.refresh.behavior :
          input.kind === "mully-partition-prepared-v1" ? input.refresh.behavior : input.behavior);
    mkdirSync(outputPath, { recursive: true, mode: 0o700 });
    // Never silently overwrite an existing reviewed bundle.
    writeFileSync(join(outputPath, "refresh-bundle.json"), JSON.stringify(bundle, null, 2) + "\n",
      { flag: "wx", mode: 0o600 });
    writeFileSync(join(outputPath, "analytics-events-view.json"), JSON.stringify(diagnostic, null, 2) + "\n",
      { flag: "wx", mode: 0o600 });
    return { runId: bundle.runId, state: "prepared_only", registered: false, enabled: false };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
/** Same preparation entry point, explicit network opt-in. The source manifest,
 * refresh input and bundle are published locally together only after validation.
 * Injected transport/clock support synthetic tests without customer source calls. */
export async function prepareCollectedFile(inputPath, outputPath, env = process.env, request = fetch,
  clock = () => new Date().toISOString()) {
  if (env.LEAN_REFRESH_SOURCE_COLLECTION_APPROVED !== "true" ||
      env.LEAN_MULLY_SOURCE_READ_APPROVED !== "true") throw new Error("refresh_collection_disabled");
  if (statSync(inputPath).size > 8000000 || existsSync(outputPath)) throw new Error("refresh_collection_file_budget");
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  if (!["mully-collect-v1", "mully-partition-collect-v1"].includes(input.kind)) throw new Error("refresh_collection_kind");
  const scratch = mkdtempSync(join(tmpdir(), "analytics-collect-"));
  let stage;
  try {
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true,
      resolveJsonModule: true, skipLibCheck: true, noEmitOnError: true,
      strict: true, rootDir: join(root, "src"), outDir: scratch };
    const program = ts.createProgram(["collectRefresh", "partitionRefresh", "behaviorView"].map(name =>
      join(root, `src/lib/analytics/${name}.ts`)), options);
    if (ts.getPreEmitDiagnostics(program).some(d => d.category === ts.DiagnosticCategory.Error) ||
        program.emit().emitSkipped) throw new Error("refresh_preparation_compile_failed");
    const require = createRequire(import.meta.url);
    const result = input.kind === "mully-partition-collect-v1"
      ? await require(join(scratch, "lib/analytics/partitionRefresh.js")).collectPartitionRefresh(input, env, request, clock)
      : await require(join(scratch, "lib/analytics/collectRefresh.js")).collectRefresh(input, env, request, clock);
    const diagnostic = result.bundle.full.policy.behaviorMode === "excluded"
      ? { state: "excluded", materialize: false, query: null,
        reason: "Explicit commerce-only scope; behavioral metrics remain withheld." }
      : require(join(scratch, "lib/analytics/behaviorView.js")).behaviorDiagnosticView(
        input.kind === "mully-partition-collect-v1" ? result.refresh.refresh.behavior : result.refresh.behavior);
    mkdirSync(dirname(resolve(outputPath)), { recursive: true, mode: 0o700 });
    stage = mkdtempSync(join(dirname(resolve(outputPath)), ".analytics-collected-"));
    const outputs = {
      "refresh-bundle.json": result.bundle, "analytics-events-view.json": diagnostic,
      "refresh-input.json": result.refresh, "collected-sources.json": result.sources,
      "source-collection-audit.json": result.audit,
    };
    for (const [file, value] of Object.entries(outputs))
      writeFileSync(join(stage, file), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    if (existsSync(outputPath)) throw new Error("refresh_collection_file_budget");
    renameSync(stage, outputPath); stage = undefined;
    return { runId: result.bundle.runId, state: "prepared_only", calls: result.audit.calls,
      registered: false, enabled: false };
  } finally {
    if (stage) rmSync(stage, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length === 5 && process.argv[2] === "--collect-sources")
      console.log(JSON.stringify(await prepareCollectedFile(process.argv[3], process.argv[4])));
    else if (process.argv.length === 4)
      console.log(JSON.stringify(prepareFile(process.argv[2], process.argv[3])));
    else throw new Error("usage");
  } catch {
    console.error("refresh_preparation_failed: provide reviewed input JSON and a new private output directory");
    process.exitCode = 1;
  }
}
