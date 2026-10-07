"use client";
import { useState } from "react";
import { sourceSessionVersion } from "@/lib/analytics/journeySourceSessionContract";
export default function PreferencesClient({ allowEnabled }: { allowEnabled: boolean }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function decide(decision: "allow" | "withdraw") {
    setBusy(true);
    try {
      const response = await fetch("/api/analytics/source-session/decision", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, policyVersion: sourceSessionVersion }),
        signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("unconfirmed");
      const result = await response.json();
      if (decision === "allow" && (!result.expiresAt || !Number.isFinite(Date.parse(result.expiresAt)))) throw new Error("unconfirmed");
      setMessage(decision === "allow" ? `New session and checkout recording allowed until ${new Date(result.expiresAt).toLocaleString()}. Later-order matching follows the limits above. Your current visit may not qualify.`
        : "Optional session reporting withdrawn. Any downstream removal is processed separately.");
      // Deliberately no entry event, SDK reset, navigation receipt or v2 decision.
    } catch { setMessage("Your choice could not be confirmed. Your previous setting may still apply; please retry withdrawal if requested."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-xl px-6 py-16">
    <h1 className="text-2xl font-semibold">Optional session reporting</h1>
    <p className="my-6">Allow us to measure eligible site sessions and link their verified Shopify cart and later order in our reports.
      We use session identifiers, not your name or contact details, for this optional link.</p>
    <p className="my-6">Permission to record new sessions and checkouts lasts no longer than 24 hours and can include a later visit during that period.
      Only sessions that begin after you allow and before permission expires can be included.
      Your current visit will usually have begun already and may not qualify.</p>
    <p className="my-6">We may then match an authorized checkout to an order paid within 7 days of its eligible session start.
      We allow another 48 hours for that payment record to arrive, not for a later payment.
      Withdrawing permission stops further optional matching. We keep a separate preference cookie during this period so you can withdraw.
      Allowing again after recording permission expires replaces the old choice and stops matching its checkouts.</p>
    <p className="my-6">This is optional and does not affect purchases or membership. It does not change existing advertising,
      SMS or Reserve journey preferences. A previous Reserve choice does not enable this reporting.</p>
    <div className="flex flex-wrap gap-4">
      <button className="min-h-11 border px-4 py-2" disabled={busy || !allowEnabled} onClick={() => void decide("allow")}>Allow optional session reporting</button>
      <button className="min-h-11 border px-4 py-2" disabled={busy} onClick={() => void decide("withdraw")}>Withdraw permission</button>
    </div>
    {!allowEnabled && <p className="mt-6">Optional session reporting is not currently available. You can still withdraw a previous choice.</p>}
    <p role="status" className="mt-6">{message}</p>
    <p className="mt-6">For account-wide privacy or deletion requests, see our <a className="underline" href="/policies/privacy">privacy policy</a>.</p>
  </main>;
}
