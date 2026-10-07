import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sha = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const columns = ["shop_id","publication_id","definition_version","report_scope","provider","account_id",
  "report_date","source_currency","source_timezone","click_definition","as_of_at","is_stale","spend_usd",
  "clicks","impressions","ctr","cpc_usd","cpm_usd","readiness"];
const context = "Read the approved dedicated Google import metadata and complete bounded table without changing source configuration or returning authentication values.";
function assertEnvelope(value) {
  if (!value || typeof value !== "object") throw Error("connector_envelope");
  for (const row of [value, value.structured_content_metadata, value.content_metadata, value.metadata].filter(Boolean)) {
    if (typeof row !== "object" || row.error || row.isError || row.is_error ||
      Object.hasOwn(row, "success") && row.success !== true ||
      ["truncated","is_truncated","isTruncated","hasMore","has_more","limit_reached"].some(key =>
        Object.hasOwn(row, key) && row[key] !== false && row[key] !== null))
      throw Error("connector_incomplete");
  }
}
function unwrap(value) {
  // Current connector result may carry JSON in content text. Never accept prose,
  // partial text or an error envelope as data.
  for (let n = 0; n < 4; n++) {
    if (typeof value === "string") { value = JSON.parse(value); continue; }
    assertEnvelope(value);
    if (Object.hasOwn(value, "result")) { value = value.result; continue; }
    if (Array.isArray(value.content)) {
      if (value.content.length !== 1 || value.content[0].type !== "text") throw Error("connector_envelope");
      value = value.content[0].text; continue;
    }
    return value;
  }
  throw Error("connector_nesting");
}
export function posthogRead(name, args, execute = execFileSync, deadline = Date.now() + 25000) {
  if (!["external-data-sources-retrieve","external-data-sources-jobs","execute-sql"].includes(name))
    throw Error("read_only_commands");
  if (!Number.isFinite(deadline) || Date.now() >= deadline) throw Error("connector_deadline");
  const result = unwrap(JSON.parse(execute("pplx", ["connector","call","posthog","exec","--input",
    JSON.stringify({ command: `call --json ${name} ${JSON.stringify(args)}`, context, llm_model: "unknown" })],
  { encoding: "utf8", timeout: Math.min(25000, deadline - Date.now()), maxBuffer: 1048576, stdio: ["ignore","pipe","pipe"] })));
  if (Date.now() >= deadline) throw Error("connector_deadline");
  return result;
}
function scrubSource(raw) {
  assertEnvelope(raw);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("source_shape");
  return { id: raw.id, source_type: raw.source_type, latest_error: raw.latest_error, schemas: raw.schemas,
    job_inputs: { manifest_json: raw.job_inputs?.manifest_json } };
}
export function captureMetaClaim(claim, outerDeadline) {
  if (claim.state !== "meta_capture" || sha(claim.binding) !== claim.bindingSha256) throw Error("meta_binding");
  const claimedDeadline = Date.parse(claim.binding.deadline), deadline = Math.min(outerDeadline, claimedDeadline);
  // The frozen native helper owns its immutable deadline. Do not rewrite it.
  // If the remaining approved turn is shorter, make no provider invocation.
  if (!Number.isFinite(deadline) || claimedDeadline > outerDeadline || Date.now() >= deadline)
    throw Error("meta_outer_deadline");
  const scratch = mkdtempSync(join(tmpdir(), "mully-meta-cycle-"));
  try {
    const path = join(scratch, "binding.json"), output = join(scratch, "receipts");
    writeFileSync(path, JSON.stringify(claim.binding), { flag: "wx", mode: 0o600 });
    // The approved Computer invocation supplies the existing meta_ads preset.
    // No token is read, constructed, copied or printed by this controller.
    execFileSync("timeout", ["--signal=TERM","--kill-after=1s",`${Math.max(0.001, (deadline - Date.now()) / 1000)}s`,
      "python", fileURLToPath(new URL("./capture-meta-hourly.py", import.meta.url)),
      "--binding", path, "--binding-sha256", claim.bindingSha256, "--output", output],
    { timeout: Math.min(58000, deadline - Date.now() + 2000), killSignal: "SIGTERM",
      maxBuffer: 65536, stdio: ["ignore","pipe","pipe"] });
    if (Date.now() >= deadline) throw Error("meta_outer_deadline");
    const read = name => JSON.parse(readFileSync(join(output, name + ".json"), "utf8"));
    return { metadata: read("account"), accountHours: read("account-hours"), campaignHours: read("campaign-hours") };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
/** One approved scheduled turn. No schedule creation, no import trigger, no
 * retry, no secret persistence and no ability to post an owner SQL statement. */
export async function runGoogleAutomaticTurn(binding, env, adapters = {}) {
  const now = Date.now(), expiry = Date.parse(binding.expiresAt);
  if (binding.enabled !== true || binding.version !== 1 || binding.projectId !== "353503" ||
    !["https://www.mymully.com","https://mymully.com"].includes(binding.origin) ||
    !Number.isFinite(expiry) || !Number.isFinite(Date.parse(binding.notBefore)) || now < Date.parse(binding.notBefore) || now >= expiry ||
    !/^[a-f0-9]{64}$/.test(binding.destinationContractSha256) ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(binding.grantId) || !/^[1-9]\d*$/.test(binding.grantRevision) ||
    !binding.approvalRef || !binding.actorRef || !binding.attemptPath ||
    binding.maxApplicationCalls !== 3 || binding.maxConnectorCalls !== 5) throw Error("operator_binding");
  const producer = env.LEAN_GOOGLE_AUTOMATIC_PRODUCER_SECRET, observer = env.LEAN_GOOGLE_AUTOMATIC_OBSERVER_SECRET;
  if (![producer, observer].every(v => typeof v === "string" && /^[!-~]{32,512}$/.test(v)) || producer === observer)
    throw Error("operator_credentials");
  let applicationCalls = 0, connectorCalls = 0;
  const request = adapters.request ?? fetch, read = adapters.read ??
    ((name, args, deadline) => posthogRead(name, args, execFileSync, deadline));
  const retain = adapters.retain ?? ((path, value) => writeFileSync(path, JSON.stringify(value), { flag: "wx", mode: 0o600 }));
  // Unique attempt file must be reserved before dispatch. Lost responses never
  // cause a write replay. A later scheduled turn starts with actual server state.
  retain(binding.attemptPath, { version: 1, bindingSha256: sha(binding), startedAt: new Date().toISOString() });
  const app = async (body, secret, path = "/api/analytics/ingest/google-automatic") => {
    if (++applicationCalls > binding.maxApplicationCalls || Date.now() >= expiry) throw Error("application_budget");
    const response = await request(binding.origin + path, { method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(Math.min(85000, expiry - Date.now())) });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 65536) throw Error("application_transport");
    const text = await response.text(); if (Buffer.byteLength(text) > 65536) throw Error("application_bytes");
    if (Date.now() >= expiry) throw Error("application_budget");
    const value = JSON.parse(text); if (!value || typeof value.state !== "string") throw Error("application_shape");
    return value;
  };
  const state = await app({ action: "state" }, producer);
  // The app binds its grant through production settings. Exact safe echo avoids
  // dispatch against a different deployment binding.
  if (state.grantId !== binding.grantId || state.grantRevision !== binding.grantRevision) throw Error("operator_grant");
  let result = state;
  if (state.state === "ready" && binding.allowCapture === true)
    result = await app({ action: "capture", cycleId: randomUUID() }, producer);
  else if (state.state === "meta_required" && binding.allowMetaCapture === true) {
    const token = randomUUID();
    const claim = await app({ action: "meta_claim", cycleId: state.cycleId, token }, producer);
    const deadline = Math.min(expiry, Date.parse(claim.binding?.deadline));
    if (!Number.isFinite(deadline) || Date.now() >= deadline) throw Error("meta_outer_deadline");
    const captures = await (adapters.captureMeta ?? captureMetaClaim)(claim, deadline);
    if (Date.now() >= deadline) throw Error("meta_outer_deadline");
    result = await app({ action: "meta_commit", cycleId: state.cycleId, token, captures }, producer);
  }
  else if (state.state === "advance" && binding.allowAdvance === true) {
    if (state.standingPolicy !== binding.standingPolicy || state.standingRevision !== binding.standingRevision ||
      !/^[!-~]{32,512}$/.test(env.LEAN_ANALYTICS_FULL_SECRET ?? "")) throw Error("standing_binding");
    result = await app(undefined, env.LEAN_ANALYTICS_FULL_SECRET, "/api/analytics/ingest/full");
  } else if (state.state === "observe" && binding.allowObserve === true) {
    const token = randomUUID();
    const claim = await app({ action: "observe_claim", cycleId: state.cycleId, token }, observer);
    if (claim.state !== "observe" || claim.destination?.projectId !== "353503" ||
      claim.destination?.contractSha256 !== binding.destinationContractSha256) throw Error("observation_binding");
    const destination = claim.destination, status = claim.body?.google_delivery_status;
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,199}$/.test(destination.tableName) ||
      !/^[a-f0-9-]{36}$/.test(destination.sourceId) || !/^[a-f0-9-]{36}$/.test(destination.schemaId))
      throw Error("observation_target");
    const query = `SELECT count() OVER () AS total_rows, toJSONString(tuple(${columns.map(c => `\`${c}\``).join(", ")})) AS row_json FROM \`${destination.tableName}\` LIMIT 2`;
    const deadline = Math.min(expiry, Date.parse(claim.deadline));
    const call = async (name, args) => {
      if (!Number.isFinite(deadline) || ++connectorCalls > binding.maxConnectorCalls || Date.now() >= deadline)
        throw Error("observation_budget");
      const result = await read(name, args, deadline);
      if (Date.now() >= deadline) throw Error("observation_budget");
      return result;
    };
    const sourceBefore = scrubSource(await call("external-data-sources-retrieve", { id: destination.sourceId }));
    const jobsBefore = await call("external-data-sources-jobs", { id: destination.sourceId, after: status.not_before,
      before: new Date().toISOString(), schemas: ["google_account_daily"] });
    const table = await call("execute-sql", { query, context });
    const sourceAfter = scrubSource(await call("external-data-sources-retrieve", { id: destination.sourceId }));
    const jobsAfter = await call("external-data-sources-jobs", { id: destination.sourceId, after: status.not_before,
      before: new Date().toISOString(), schemas: ["google_account_daily"] });
    result = await app({ action: "observe_commit", cycleId: state.cycleId, token,
      observations: { sourceBefore, jobsBefore, table, sourceAfter, jobsAfter } }, observer);
  }
  const receipt = { state: result.state, applicationCalls, connectorCalls, completedAt: new Date().toISOString(),
    resultSha256: sha(result), metricAcceptance: result.state === "accepted" ? "dedicated_google_only" : "not_established" };
  retain(`${binding.attemptPath}.receipt.json`, receipt);
  return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw Error("usage");
    console.log(JSON.stringify(await runGoogleAutomaticTurn(JSON.parse(readFileSync(process.argv[2], "utf8")), process.env)));
  } catch { console.error("google_automatic_turn_held"); process.exitCode = 1; }
}
