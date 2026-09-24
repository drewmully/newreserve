"use client";
import { useState } from "react";
/** Separate opt-in for the lean reporting lane, not an advertising CMP. */
export default function AnalyticsPreferences() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function decide(decision: "allow" | "withdraw") {
    setBusy(true);
    try {
      const response = await fetch("/api/analytics/journey/decision", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }), signal: AbortSignal.timeout(5000),
      });
      setMessage(response.ok ? decision === "allow"
        ? "Optional journey analytics enabled for this visit."
        : "Optional journey analytics withdrawn for this visit. Any downstream removal is processed separately."
        : "Your choice could not be confirmed. Your previous setting may still apply; please retry withdrawal if requested.");
    } catch { setMessage("Your choice could not be confirmed. Your previous setting may still apply; please retry."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-xl px-6 py-16">
    <h1 className="text-2xl font-semibold">Optional journey analytics</h1>
    <p className="my-6">Allow this visit&apos;s actions and verified checkout to be used in our new journey reports.
      This is optional and does not affect purchases or membership. Permission lasts no longer than 24 hours.
      It does not change existing advertising or SMS preferences.</p>
    <div className="flex gap-4">
      <button className="border px-4 py-2" disabled={busy} onClick={() => void decide("allow")}>Allow for this visit</button>
      <button className="border px-4 py-2" disabled={busy} onClick={() => void decide("withdraw")}>Withdraw for this visit</button>
    </div>
    <p role="status" className="mt-6">{message}</p>
    <p className="mt-6">For account-wide privacy or deletion requests, see our <a className="underline" href="/policies/privacy">privacy policy</a>.</p>
  </main>;
}
