import PreferencesClient from "./PreferencesClient";
import { journeyDefaults } from "@/lib/analytics/journeyRuntime";
import { resolveJourneyRuntime } from "@/lib/analytics/journeyPolicyRuntime";

export const dynamic = "force-dynamic";
export const revalidate = 0;
/** Only a boolean reaches the browser. No policy, fingerprint or credentials. */
export default async function AnalyticsPreferences() {
  const runtime = await resolveJourneyRuntime(journeyDefaults());
  const legacy = process.env.LEAN_ANALYTICS_JOURNEYS_ENABLED === "true" &&
    process.env.NEXT_PUBLIC_LEAN_ANALYTICS_JOURNEYS_ENABLED === "true";
  return <PreferencesClient allowEnabled={!!runtime.policy || legacy} />;
}
