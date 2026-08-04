"use client";

/* ═══════════════════════════════════════════
   UNSUBSCRIBE / EMAIL PREFERENCES
   Functional page only — no marketing copy.
   ═══════════════════════════════════════════ */

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type Status = {
  email: string;
  suppressedMarketing: boolean;
  suppressedAll: boolean;
};

function UnsubscribeContent() {
  const params = useSearchParams();
  const token = params.get("token");
  const rid = params.get("rid");
  const errorParam = params.get("error");

  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"marketing" | "all" | null>(null);
  const [result, setResult] = useState<"marketing" | "all" | null>(null);

  useEffect(() => {
    if (errorParam) {
      setLoading(false);
      setLoadError(errorParam);
      return;
    }

    // The live/dangling link shape is `/unsubscribe?rid=<campaign_recipients.id>`
    // (src/app/api/admin/campaigns/martine/send/route.ts). It carries no
    // signature, so we hand it to the server-side resolver, which looks up
    // the recipient's email and redirects back here with a signed `token`.
    if (!token && rid) {
      window.location.replace(`/api/unsubscribe/resolve?rid=${encodeURIComponent(rid)}`);
      return;
    }

    if (!token) {
      setLoading(false);
      setLoadError("missing_params");
      return;
    }

    fetch(`/api/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? "lookup_failed");
        setStatus(json as Status);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "lookup_failed"))
      .finally(() => setLoading(false));
  }, [token, rid, errorParam]);

  async function submit(scope: "marketing" | "all") {
    if (!token) return;
    setSubmitting(scope);
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, scope }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "write_failed");
      setResult(scope);
    } catch {
      setLoadError("write_failed");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="min-h-screen bg-bone flex items-center justify-center px-5 py-16">
      <div className="max-w-md w-full bg-white border border-taupe/15 rounded-xl p-8">
        <h1 className="text-lg font-medium text-charcoal mb-6">Email Preferences</h1>

        {loading && <p className="text-sm text-charcoal/60">Loading…</p>}

        {!loading && loadError && (
          <div>
            <p className="text-sm text-charcoal/70">
              {loadError === "invalid_token" && "This link is invalid."}
              {loadError === "invalid_or_expired_token" && "This link has expired."}
              {loadError === "not_found" && "No matching record was found."}
              {loadError === "missing_params" && "This link is missing required parameters."}
              {loadError === "lookup_failed" && "Could not load your preferences right now."}
              {loadError === "write_failed" && "Could not save your preference right now."}
              {![
                "invalid_token",
                "invalid_or_expired_token",
                "not_found",
                "missing_params",
                "lookup_failed",
                "write_failed",
              ].includes(loadError) && "This link could not be processed."}
            </p>
            <Link
              href="mailto:info@mymully.com"
              className="inline-block mt-4 text-sm text-forest underline"
            >
              Contact support
            </Link>
          </div>
        )}

        {!loading && !loadError && status && !result && (
          <div>
            <p className="text-sm text-charcoal/70 mb-1">Email address:</p>
            <p className="text-sm font-medium text-charcoal mb-6">{status.email}</p>

            {status.suppressedAll ? (
              <p className="text-sm text-charcoal/70">
                This address is already unsubscribed from all email.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="border border-taupe/15 rounded-lg p-4">
                  <p className="text-sm text-charcoal mb-1">Marketing emails</p>
                  <p className="text-xs text-charcoal/50 mb-3">
                    Status: {status.suppressedMarketing ? "Unsubscribed" : "Subscribed"}
                  </p>
                  <button
                    type="button"
                    disabled={status.suppressedMarketing || submitting !== null}
                    onClick={() => submit("marketing")}
                    className="text-sm px-4 py-2 rounded-full border border-charcoal/20 text-charcoal disabled:opacity-40 hover:border-charcoal/40 transition-colors"
                  >
                    {submitting === "marketing"
                      ? "Submitting…"
                      : status.suppressedMarketing
                        ? "Already unsubscribed"
                        : "Unsubscribe from marketing emails"}
                  </button>
                </div>

                <div className="border border-taupe/15 rounded-lg p-4">
                  <p className="text-sm text-charcoal mb-1">All emails</p>
                  <p className="text-xs text-charcoal/50 mb-3">
                    Includes transactional emails (order confirmations, account notices).
                  </p>
                  <button
                    type="button"
                    disabled={submitting !== null}
                    onClick={() => submit("all")}
                    className="text-sm px-4 py-2 rounded-full border border-charcoal/20 text-charcoal disabled:opacity-40 hover:border-charcoal/40 transition-colors"
                  >
                    {submitting === "all" ? "Submitting…" : "Unsubscribe from all emails"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {result && (
          <div>
            <p className="text-sm text-charcoal">
              {result === "marketing"
                ? "You have been unsubscribed from marketing emails."
                : "You have been unsubscribed from all emails."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bone" />}>
      <UnsubscribeContent />
    </Suspense>
  );
}
