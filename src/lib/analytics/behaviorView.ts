import { validateBehaviorSource, type BehaviorSource } from "./posthogSource";

/** Generates a non-materialized diagnostic view for the EXACT approved window.
 * No source call, mutation, or implicit daily materialization. The project is
 * the installation target, not a cross-project events filter.
 *
 * Do not use this as a certified customer/attribution view: current identity
 * permission and removals are applied by the full build, not by this query.
 * Identifiers are deliberately excluded from its result.
 */
export function behaviorDiagnosticView(source: BehaviorSource) {
  validateBehaviorSource(source);
  const branches = Object.entries(source.families).sort(([a], [b]) => a.localeCompare(b)).map(([family, f]) => {
    // Every substituted identifier/value passed validateBehaviorSource's token
    // allowlist; dates are strict UTC timestamps. No raw user SQL is accepted.
    const action = `properties.${f.actionProperty}`;
    return `SELECT
      '${source.project}' AS project_id,
      '${f.producer}' AS producer,
      '${family}' AS event_name,
      '${f.schemaVersion}' AS schema_version,
      min(toString(uuid)) AS source_event_uuid,
      min(timestamp) AS occurred_at,
      count() AS transport_arrivals,
      uniqExact(timestamp) AS timestamp_versions,
      uniqExact(coalesce(toString(properties.${f.sessionProperty}), '')) AS session_versions,
      uniqExact(coalesce(toString(${f.identityProperty === "distinct_id" ? "distinct_id" : `properties.${f.identityProperty}`}), '')) AS identity_versions,
      uniqExact(coalesce(toString(properties.${f.consentProperty}), '')) AS permission_versions,
      'diagnostic_only' AS readiness
    FROM events
    WHERE event = '${family}'
      AND timestamp >= toDateTime('${source.from}')
      AND timestamp < toDateTime('${source.until}')
      AND ${action} IS NOT NULL AND toString(${action}) != ''
    GROUP BY ${action}`;
  });
  return {
    name: "analytics_events",
    project: source.project,
    host: source.host,
    materialize: false,
    query: branches.join("\nUNION ALL\n"),
    approvalRef: source.approvalRef,
    acceptance: [
      "Compile in the approved PostHog project before saving; local tests do not validate the hosted HogQL compiler.",
      "Compare transport and logical counts against the bounded reader for the same source window.",
      "Any *_versions > 1 is a conflicting retry, not a trustworthy deduplicated event.",
      "No customer, session, campaign or current-permission inference is authorized by this diagnostic view.",
      "Missing action identifiers are excluded here but must fail the bounded source reader; reconcile excluded counts.",
    ],
  };
}
