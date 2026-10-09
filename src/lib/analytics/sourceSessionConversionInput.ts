import { sessionConversionWindowDays } from "./calculationPolicy";
import type { Row } from "./primitives";
import type { SourceEntryAccounting } from "./sourceSessionProducer";
import { sourceReportInstant } from "./sourceSessionNativeWindow";

type Observation<T> = { value: T | null; state: "observed_unverified" | "unavailable" };
function count(row: Row, name: string): Observation<number> {
  const value = row[name];
  const available = (row.readiness as Record<string, unknown> | undefined)?.[name] === "observed_unverified" &&
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  return { value: available ? value : null, state: available ? "observed_unverified" : "unavailable" };
}

/** Aggregate output of an already validated build, not a source admission or a
 * new completeness claim. Never use positive links as a conversion denominator.
 */
export function summarizeSourceSessionConversion(input: {
  publication: string; fromDate: string; throughDate: string; asOf: string;
  conversionWindowDays: number; sessions: Row[]; orders: Row[]; funnel: Row[];
  source: "native_entry" | "legacy_action_session";
  entryAccounting?: SourceEntryAccounting;
}) {
  const windowMs = sessionConversionWindowDays(input.conversionWindowDays) * 86400000;
  const asOf = sourceReportInstant(input.asOf);
  const days = input.funnel.filter(row => row.publication_id === input.publication && row.stage_id === "all_sessions" &&
    typeof row.report_date === "string" && row.report_date >= input.fromDate && row.report_date <= input.throughDate)
    .map(row => {
      const sessions = new Map(input.sessions.filter(session => session.publication_id === input.publication &&
        session.report_date === row.report_date && session.analytics_eligible === true &&
        typeof session.session_key === "string").map(session => [session.session_key, session]));
      const orders = new Set<string>(), linkedSessions = new Set<string>();
      for (const order of input.orders) {
        if (order.publication_id !== input.publication || order.eligibility_status !== "eligible" ||
          order.checkout_link_status !== "matched" || order.link_version !== "evidence-only-v1" ||
          !["corroborated_checkout_id", "verified_first_party_context"].includes(String(order.checkout_link_method)) ||
          typeof order.evidence_ref !== "string" || !order.evidence_ref.trim() ||
          typeof order.order_id !== "string" || typeof order.checkout_session_key !== "string" ||
          typeof order.paid_at !== "string") continue;
        const session = sessions.get(order.checkout_session_key);
        if (!session || typeof session.started_at !== "string") continue;
        let start: string, paid: string;
        try { start = sourceReportInstant(session.started_at); paid = sourceReportInstant(order.paid_at); }
        catch { continue; }
        // Date arithmetic supplies the day boundary; retain the original
        // microsecond remainder for the exact, exclusive paid-link cutoff.
        const until = new Date(Date.parse(start) + windowMs).toISOString().replace(/Z$/, `${start.slice(-4, -1)}Z`);
        if (paid < start || paid >= until || paid > asOf) continue;
        orders.add(order.order_id); linkedSessions.add(order.checkout_session_key);
      }
      const rawRate = row.session_conversion_rate;
      const rateAvailable = (row.readiness as Record<string, unknown> | undefined)?.session_conversion_rate === "observed_unverified" &&
        typeof rawRate === "string" && /^(0\.\d{6}|1\.000000)$/.test(rawRate);
      return {
        date: row.report_date as string,
        measuredSessions: count(row, "measured_sessions"),
        // Zero here means no verified positive in the supplied facts, not no
        // purchases in the store and not a completed zero-conversion cohort.
        knownPaidLinks: { orders: orders.size, sessions: linkedSessions.size, state: "positive_observations_only" as const },
        matureSessions: count(row, "mature_sessions"), convertedSessions: count(row, "converted_sessions"),
        sessionConversionRate: { value: rateAvailable ? rawRate as string : null,
          state: rateAvailable ? "observed_unverified" as const : "unavailable" as const },
      };
    });
  return {
    version: 1 as const, certification: "unverified" as const,
    scope: { fromDate: input.fromDate, throughDate: input.throughDate, timezone: "America/New_York" as const,
      sessionSource: input.source, purchasePopulation: "registered_base_only" as const,
      conversionWindowDays: input.conversionWindowDays },
    // A session ID is not an independently verified unique visitor identity.
    uniqueVisitors: { value: null, state: "unavailable" as const, reason: "no_admitted_visitor_identity" as const },
    entryInventory: input.entryAccounting ? { native: input.entryAccounting.native,
      included: input.entryAccounting.included, excluded: input.entryAccounting.excluded,
      unknown: input.entryAccounting.unknown } : null,
    days,
  };
}
