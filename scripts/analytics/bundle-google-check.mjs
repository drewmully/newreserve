/** Local build only: emits the reviewed reader plus its pure dependencies.
 * Generated bundle needs Node built-ins only; no runtime install or public API.
 */
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export function bundleGoogleCheck(output) {
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true, resolveJsonModule: true,
    strict: true, skipLibCheck: true, noEmitOnError: true, rootDir: join(root, "src"),
    outDir: join(root, ".google-check-virtual") };
  const program = ts.createProgram([join(root, "src/lib/analytics/googleSpendCheck.ts")], options);
  if (ts.getPreEmitDiagnostics(program).some(d => d.category === ts.DiagnosticCategory.Error))
    throw new Error("google_bundle_compile_failed");
  const modules = new Map();
  const result = program.emit(undefined, (file, text) => {
    modules.set(relative(options.outDir, file).replaceAll("\\", "/"), file.endsWith(".json")
      ? `module.exports = ${text};` : text);
  });
  if (result.emitSkipped) throw new Error("google_bundle_compile_failed");
  const hash = createHash("sha256");
  for (const file of program.getSourceFiles().filter(f => f.fileName.startsWith(options.rootDir + "/"))
    .map(f => f.fileName).sort()) {
    hash.update(relative(root, file)); hash.update("\0"); hash.update(readFileSync(file)); hash.update("\0");
  }
  const code = { commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    sourceSha256: hash.digest("hex") };
  const content = `"use strict";
const code = ${JSON.stringify(code)};
const definitions = {${[...modules].map(([name, text]) =>
    `${JSON.stringify(name)}: function(require,module,exports) {\n${text}\n}`).join(",\n")}};
const cache = {};
function load(name) {
  if (name.startsWith("node:")) return require(name);
  if (cache[name]) return cache[name].exports;
  if (!definitions[name]) throw new Error("google_bundle_unknown_module");
  const module = {exports:{}}; cache[name] = module;
  definitions[name](id => id.startsWith(".")
    ? load(require("node:path").posix.normalize(require("node:path").posix.join(
      require("node:path").posix.dirname(name), id)) + (/\\.(js|json)$/.test(id) ? "" : ".js"))
    : load(id), module, module.exports);
  return module.exports;
}
async function check(scope, env = process.env, fetcher = fetch) {
  if (env.LEAN_ANALYTICS_GOOGLE_CHECK_ENABLED !== "true") throw new Error("google_check_disabled");
  const auth = load("lib/analytics/googleSpendSource.js").googleSpendAuthFromEnv(env);
  const result = await load("lib/analytics/googleSpendCheck.js").checkGoogleSpend({
    scope, auth, developerToken: env.LEAN_GOOGLE_ADS_DEVELOPER_TOKEN || "", fetcher
  });
  return {...result, code};
}
module.exports = {check, code};
if (require.main === module) (async () => {
  if (process.argv.length < 3 || process.argv.length > 4) throw new Error("usage");
  const fs = require("node:fs");
  if (fs.statSync(process.argv[2]).size > 8192) throw new Error("input_too_large");
  const result = await check(JSON.parse(fs.readFileSync(process.argv[2], "utf8")));
  console.log(JSON.stringify(result));
  if (result.state !== "sample_amounts_match") process.exitCode = 2;
  if (process.argv[3]) {
    fs.mkdirSync(process.argv[3], {recursive:true});
    fs.writeFileSync(require("node:path").join(process.argv[3], "index.html"),
      "<!doctype html><title>Isolated validation</title><p>Validation completed. See the private build log.</p>\\n",
      {flag:"wx"});
  }
})().catch(() => {console.error("google_check_failed"); process.exitCode=1;});
`;
  writeFileSync(output, content, { flag: "wx", mode: 0o600 });
  return { ...code, bundleSha256: createHash("sha256").update(content).digest("hex"), modules: modules.size };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error("provide_new_output_file");
  console.log(JSON.stringify(bundleGoogleCheck(process.argv[2])));
}
