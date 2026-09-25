"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- offline CommonJS packaging script */
/** Mechanical, offline packaging only. Does not build/run the source operator. */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const C = require("./history-import-contract.cjs");
const root = path.resolve(__dirname, "../..");
const out = process.argv[2];
if (!out || !path.isAbsolute(out) || fs.existsSync(out)) throw new Error("provide a new absolute package directory");
fs.mkdirSync(out, { recursive: true });
for (const name of ["history-import-operator.cjs", "history-import-contract.cjs", "history-import-config.json"])
  fs.copyFileSync(path.join(__dirname, name), path.join(out, name));
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({
  name: "mymully-private-history-build-operator", private: true, version: "1.0.0", engines: { node: "24.x" },
}, null, 2) + "\n");
fs.writeFileSync(path.join(out, "vercel.json"), JSON.stringify({
  $schema: "https://openapi.vercel.sh/vercel.json", framework: null, installCommand: "",
  buildCommand: "node history-import-operator.cjs",
}, null, 2) + "\n");
const scope = { jobId: "mymully-whole-history-20260925", projectRef: C.PROJECT, shop: C.SHOP, appId: C.APP,
  installationId: C.INSTALLATION, apiVersion: C.VERSION, untilTime: C.CUTOFF, queryText: C.QUERY, queryHash: C.HASH,
  expectedOrders: 61821, expiresAt: "2026-09-26T08:00:00Z", purgeAfter: "2026-09-27T08:00:00Z",
  approvalRef: "", actorRef: "" };
fs.writeFileSync(path.join(out, "operator-registration.json"), JSON.stringify(scope, null, 2) + "\n");
fs.copyFileSync(path.join(root, "sql/analytics/040_shopify_history_import.sql"), path.join(out, "040_shopify_history_import.sql"));
fs.copyFileSync(path.join(root, "docs/analytics/HISTORY_IMPORT_OPERATOR.md"), path.join(out, "OPERATOR.md"));
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const files = {};
for (const file of fs.readdirSync(out).sort()) files[file] = C.hash(fs.readFileSync(path.join(out, file)));
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ sourceCommit: head, parentCommit: "cd28be2eb1d54c90edff17ca109c246535ab66f0",
  queryHash: C.HASH, runtime: "build-only-node24", installedOrEnabled: false,
  publicResult: "/history-import.json", files }, null, 2) + "\n");
console.log(JSON.stringify({ packagePath: out, sourceCommit: head, queryHash: C.HASH, files: Object.keys(files).length }));
