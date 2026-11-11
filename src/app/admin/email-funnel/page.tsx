"use client";

import { useCallback, useEffect, useState } from "react";
import { useMembership } from "@/app/context/MembershipContext";
import type { FunnelReport } from "@/lib/emailFunnel/build";
import type { FunnelWindow } from "@/lib/emailFunnel/config";
import EmailFunnelView from "./EmailFunnelView";

export default function AdminEmailFunnelPage() {
  const { user, authLoading } = useMembership();
  const [window, setWindow] = useState<FunnelWindow>(30);
  const [report, setReport] = useState<FunnelReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (w: FunnelWindow, refresh = false) => {
      if (authLoading || !user) return;
      setLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const params = new URLSearchParams({ days: String(w) });
        if (refresh) params.set("refresh", "1");
        const res = await fetch(`/api/admin/email-funnel-live?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
        setReport(body as FunnelReport);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [authLoading, user],
  );

  useEffect(() => {
    void load(window);
  }, [load, window]);

  if (!report) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-16 text-sm text-charcoal/60">
        {error ? `Could not load the email funnel: ${error}` : "Computing the funnel from Klaviyo, PostHog and Shopify…"}
      </div>
    );
  }
  return (
    <>
      {error ? <p className="max-w-6xl mx-auto px-6 pt-4 text-xs text-red-700">{error}</p> : null}
      <EmailFunnelView
        report={report}
        window={window}
        loading={loading}
        onWindow={(w) => setWindow(w)}
        onRefresh={() => void load(window, true)}
      />
    </>
  );
}
