/** Private offline evidence only. Does not fetch, register a source or load credentials. */
import ts from "typescript";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** JSON.parse alone silently accepts duplicate object members. Validate tokens first. */
export function parseEvidence(text) {
  if (Buffer.byteLength(text) > 16000000) throw new Error("invalid_evidence");
  let at = 0;
  const bad = () => { throw new Error("invalid_evidence"); };
  const space = () => { while (/[ \t\r\n]/.test(text[at] ?? "") && at < text.length) at++; };
  const string = () => {
    const start = at++;
    while (at < text.length) {
      if (text[at] === "\\") { at += 2; continue; }
      if (text[at++] === '"') return JSON.parse(text.slice(start, at));
    }
    return bad();
  };
  const value = depth => {
    if (depth > 32) bad();
    space();
    if (text[at] === '"') { string(); return; }
    const open = text[at];
    if (open === "{" || open === "[") {
      at++; space();
      const close = open === "{" ? "}" : "]", keys = new Set();
      if (text[at] === close) { at++; return; }
      for (;;) {
        space();
        if (open === "{") {
          if (text[at] !== '"') bad();
          const key = string();
          if (keys.has(key)) bad();
          keys.add(key); space();
          if (text[at++] !== ":") bad();
        }
        value(depth + 1); space();
        if (text[at] === close) { at++; return; }
        if (text[at++] !== ",") bad();
      }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));
    if (!match) bad();
    at += match[0].length;
  };
  value(0); space();
  if (at !== text.length) bad();
  return JSON.parse(text);
}

export function acceptProductionReportsFile(inputPath, outputPath) {
  const info = lstatSync(inputPath);
  if (!info.isFile() || info.size > 16000000) throw new Error("invalid_evidence");
  const input = parseEvidence(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(inputPath)));
  const scratch = mkdtempSync(join(tmpdir(), "analytics-production-acceptance-"));
  try {
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true,
      strict: true, skipLibCheck: true, noEmitOnError: true, rootDir: join(root, "src"), outDir: scratch };
    const program = ts.createProgram([join(root, "src/lib/analytics/productionDestinationAcceptance.ts")], options);
    if (ts.getPreEmitDiagnostics(program).some(d => d.category === ts.DiagnosticCategory.Error) || program.emit().emitSkipped)
      throw new Error("acceptance_compile_failed");
    const require = createRequire(import.meta.url);
    const receipt = require(join(scratch, "lib/analytics/productionDestinationAcceptance.js"))
      .acceptProductionDestination(input);
    // mkdir is exclusive, including empty directories and symlinks. Never remove output on failure.
    mkdirSync(outputPath, { mode: 0o700 });
    writeFileSync(join(outputPath, "destination-validation.json"), JSON.stringify(receipt, null, 2) + "\n",
      { flag: "wx", mode: 0o600 });
    return { state: receipt.state, hostedCalls: 0, metricAcceptance: false,
      liveDeliveryVerified: false, atomicCrossResourceRefresh: false };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error("usage");
    console.log(JSON.stringify(acceptProductionReportsFile(process.argv[2], process.argv[3])));
  } catch {
    console.error("production_destination_acceptance_failed: check private evidence and a new output directory; no hosted action performed");
    process.exitCode = 1;
  }
}
