/** Explicit read-only check. No activation, DB, scheduler or vendor call on import. */
import ts from "typescript";
import { readFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export async function readGoogleCheck(inputPath, env = process.env, fetcher = fetch) {
  if (env.LEAN_ANALYTICS_GOOGLE_CHECK_ENABLED !== "true") throw new Error("google_check_disabled");
  if (statSync(inputPath).size > 8192) throw new Error("google_check_input_too_large");
  const scope = JSON.parse(readFileSync(inputPath, "utf8"));
  const scratch = mkdtempSync(join(tmpdir(), "analytics-google-check-"));
  try {
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true, resolveJsonModule: true,
      strict: true, skipLibCheck: true, noEmitOnError: true, rootDir: join(root, "src"), outDir: scratch };
    const program = ts.createProgram([join(root, "src/lib/analytics/googleSpendCheck.ts")], options);
    if (ts.getPreEmitDiagnostics(program).some(d => d.category === ts.DiagnosticCategory.Error) || program.emit().emitSkipped)
      throw new Error("google_check_compile_failed");
    const require = createRequire(import.meta.url);
    const auth = require(join(scratch, "lib/analytics/googleSpendSource.js")).googleSpendAuthFromEnv(env);
    return await require(join(scratch, "lib/analytics/googleSpendCheck.js")).checkGoogleSpend({
      scope, auth, developerToken: env.LEAN_GOOGLE_ADS_DEVELOPER_TOKEN ?? "", fetcher,
    });
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error("usage");
    const result = await readGoogleCheck(process.argv[2]);
    console.log(JSON.stringify(result));
    if (result.state !== "sample_amounts_match") process.exitCode = 2;
  } catch { console.error("google_check_failed"); process.exitCode = 1; }
}
