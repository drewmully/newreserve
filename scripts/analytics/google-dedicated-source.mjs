import { createHash } from "node:crypto";

export const googleSourceManifestSha256 = "e0eda44afac2b85566c73c1b7caa3bca9e562efaa681ef5938cefa94e90d5b3c";
const keys = ["shop_id","account_id","report_date","definition_version","publication_id"];
/** Build ONLY in parent RAM after actual db-schema validation/preview. This is
 * a proposed creation payload, not evidence that validation or creation ran.
 * No CLI, logging, network, credential lookup or file output is provided. */
export function preparePausedGoogleSource({ prefix, manifest, authToken }) {
  if (typeof prefix !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(prefix) ||
    prefix === "mymully_production_observed" || typeof manifest !== "string" ||
    createHash("sha256").update(manifest).digest("hex") !== googleSourceManifestSha256 ||
    typeof authToken !== "string" || !/^[!-~]{32,512}$/.test(authToken))
    throw Error("google_source_unbound");
  const config = JSON.parse(manifest), resource = config.resources?.[0];
  if (config.resources.length !== 1 || resource.name !== "google_account_daily" ||
    JSON.stringify(resource.primary_key) !== JSON.stringify(keys)) throw Error("google_source_contract");
  return { source_type: "Custom", prefix, access_method: "warehouse", direct_query_enabled: false,
    payload: { manifest_json: manifest, auth_token: authToken, schemas: [
      { name: "google_account_daily", should_sync: false, sync_type: "full_refresh", primary_key_columns: keys },
    ] } };
}
