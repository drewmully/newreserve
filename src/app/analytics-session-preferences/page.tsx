import PreferencesClient from "./PreferencesClient";
import { sourceSessionConfig } from "@/lib/analytics/journeySourceSessionRuntime";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function SourceSessionPreferences() {
  const enabled = process.env.NEXT_PUBLIC_LEAN_SOURCE_SESSIONS_ENABLED === "true" && !!(await sourceSessionConfig());
  return <PreferencesClient allowEnabled={enabled} />;
}
