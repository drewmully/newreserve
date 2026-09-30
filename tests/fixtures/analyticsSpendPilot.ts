import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { nyDate } from "@/lib/analytics/primitives";
export const spendPilotProject = "a".repeat(20);
export const spendPilotAccount = "1234567890";
export function spendPilotScope(allDue = false) {
  const now = Date.now(), iso = (offset: number) => new Date(now + offset).toISOString();
  // Report days must already be closed in the fixture account's New York zone.
  // UTC yesterday is still NY today between UTC midnight and NY midnight.
  const calendar = Date.parse(`${nyDate(iso(0))}T12:00:00Z`);
  const closedDate = (daysBack: number) => new Date(calendar - daysBack * 86400000).toISOString().slice(0, 10);
  return {
    pilotId: "fixture:pilot", projectRef: spendPilotProject, accountId: spendPilotAccount,
    loginCustomerId: "9876543210", maxPages: 5, expiresAt: iso(3 * 86400000),
    approvalRef: "fixture:approval", actorRef: "fixture:operator",
    days: [
      { runId: "fixture:day1", date: closedDate(2), dueAt: iso(-3600000) },
      { runId: "fixture:day2", date: closedDate(1), dueAt: iso(allDue ? -1800000 : 86400000) },
    ],
  };
}
export function spendPilotBase(runId: string, date: string) {
  return { provider: "google_ads", accountId: spendPilotAccount, date, baseReportId: runId,
    sourceCurrency: "USD", sourceTimezone: "America/New_York", paginationComplete: true,
    verifiedEmpty: true, rows: [], evidenceRef: "fixture:source", completedAt: new Date().toISOString() };
}
export const spendPilotRpcs = ["lean_spend_pilot_next", "lean_spend_claim", "lean_spend_finish", "lean_spend_fail"];
export function spendPilotClient(query: (sql: string, params: unknown[]) => Promise<{ rows: { result: unknown }[] }>): AnalyticsRpcClient {
  return { async rpc(name, input) {
    if (!spendPilotRpcs.includes(name)) throw new Error("unknown_fixture_rpc");
    const entries = Object.entries(input);
    try {
      const result = await query(`select public.${name}(${entries.map(([k], i) =>
        `${k}=>$${i + 1}${k === "p_base" ? "::jsonb" : ""}`).join(",")}) result`,
      entries.map(([k, v]) => k === "p_base" ? JSON.stringify(v) : v));
      return { data: result.rows[0].result, error: null };
    } catch (error) { return { data: null, error }; }
  } };
}
export function spendPilotFetch(date: string): typeof fetch {
  return async (url, init) => {
    if (url === "https://oauth2.googleapis.com/token")
      return Response.json({ access_token: "fixture:access", token_type: "Bearer" });
    const query = JSON.parse(String(init?.body)).query;
    if (query.includes("FROM customer")) return Response.json({
      results: [{ customer: { id: spendPilotAccount, currencyCode: "USD", timeZone: "America/New_York" } }],
    });
    return Response.json({ fieldMask: "campaign.id,segments.date,metrics.costMicros,metrics.clicks,metrics.impressions",
      results: [{ campaign: { id: "8" }, segments: { date }, metrics: { costMicros: "1234567" } }] });
  };
}
