"use client";

import { useState, useCallback } from "react";
import { useMembership } from "@/app/context/MembershipContext";

interface SubInfo {
  id: string;
  productTitle: string;
  status: string;
}

interface UserResult {
  email: string;
  shopifyCustomerId: string | null;
  activeSubs: SubInfo[];
  cancelledReserveSubs: SubInfo[];
  wrongSubs: SubInfo[];
  error?: string;
}

interface ScanResult {
  users: UserResult[];
  totalToCancel: number;
  dryRun: boolean;
}

interface ExecuteResult {
  cancelled: { email: string; subId: string; productTitle: string }[];
  errors: { email: string; subId: string; error: string }[];
  totalCancelled: number;
  totalErrors: number;
}

export default function CleanupReactivatedSubsPage() {
  const { user, authLoading } = useMembership();
  const [scanning, setScanning] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null);

  const getHeaders = useCallback(async (): Promise<HeadersInit> => {
    if (!user) throw new Error("Not authenticated");
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, [user]);

  async function runScan() {
    setScanning(true);
    setScanResult(null);
    setExecuteResult(null);
    try {
      const headers = await getHeaders();
      const res = await fetch("/api/admin/cleanup/reactivated-subs", { headers });
      const data = await res.json() as ScanResult;
      setScanResult(data);
    } finally {
      setScanning(false);
    }
  }

  async function runExecute() {
    if (!confirm(`This will cancel ${scanResult?.totalToCancel ?? 0} subscription(s) in Loop. Are you sure?`)) return;
    setExecuting(true);
    try {
      const headers = await getHeaders();
      const res = await fetch("/api/admin/cleanup/reactivated-subs", {
        method: "POST",
        headers,
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json() as ExecuteResult;
      setExecuteResult(data);
      setScanResult(null);
    } finally {
      setExecuting(false);
    }
  }

  if (authLoading) return null;

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="font-serif text-3xl text-obsidian">Cleanup: Incorrectly Reactivated Subs</h1>
        <p className="text-charcoal/50 text-sm mt-1">
          Scans processed Mulligan users. If a user still has a CANCELLED Reserve sub, their active
          sub was reactivated by mistake — only those are flagged for cancellation.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800 space-y-1">
        <p><strong>Signal used:</strong> user has a CANCELLED Reserve sub → the cron reactivated the wrong sub → cancel the active one.</p>
        <p><strong>Safe cases:</strong> if no CANCELLED Reserve sub exists, the reactivation was correct and nothing is touched.</p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => void runScan()}
          disabled={scanning || executing}
          className="text-sm font-medium bg-obsidian text-white rounded-lg px-4 py-2 hover:bg-obsidian/80 disabled:opacity-50 transition-colors"
        >
          {scanning ? "Scanning..." : "Scan (dry run)"}
        </button>

        {scanResult && scanResult.totalToCancel > 0 && !executeResult && (
          <button
            onClick={() => void runExecute()}
            disabled={executing}
            className="text-sm font-medium bg-red-600 text-white rounded-lg px-4 py-2 hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {executing ? "Cancelling..." : `Execute — Cancel ${scanResult.totalToCancel} sub(s)`}
          </button>
        )}
      </div>

      {scanResult && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-obsidian font-medium">{scanResult.users.length} users scanned</span>
            <span className={scanResult.totalToCancel > 0 ? "text-red-600 font-medium" : "text-forest font-medium"}>
              {scanResult.totalToCancel > 0
                ? `${scanResult.totalToCancel} sub(s) to cancel`
                : "All clean — nothing to cancel"}
            </span>
          </div>

          <div className="bg-white border border-taupe/20 rounded-xl divide-y divide-taupe/10">
            {scanResult.users.map((u) => (
              <div key={u.email} className="px-5 py-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-medium text-obsidian">{u.email}</p>
                  {u.error ? (
                    <span className="text-xs text-ember">{u.error}</span>
                  ) : u.wrongSubs.length > 0 ? (
                    <span className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded px-2 py-0.5">
                      {u.wrongSubs.length} to cancel
                    </span>
                  ) : (
                    <span className="text-xs text-forest font-medium">OK</span>
                  )}
                </div>

                {u.cancelledReserveSubs.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-charcoal/40 uppercase tracking-wide">Reserve sub still CANCELLED (evidence)</p>
                    {u.cancelledReserveSubs.map((s) => (
                      <div key={s.id} className="flex items-center gap-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
                        <span className="font-mono text-charcoal/40">{s.id}</span>
                        <span>{s.productTitle}</span>
                        <span className="ml-auto uppercase tracking-wide font-medium">cancelled</span>
                      </div>
                    ))}
                  </div>
                )}

                {u.activeSubs.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-charcoal/40 uppercase tracking-wide">Active subs</p>
                    {u.activeSubs.map((s) => {
                      const isWrong = u.wrongSubs.some((w) => w.id === s.id);
                      return (
                        <div
                          key={s.id}
                          className={`flex items-center gap-3 text-xs rounded-lg px-3 py-2 ${
                            isWrong
                              ? "bg-red-50 border border-red-200 text-red-700"
                              : "bg-forest/5 border border-forest/20 text-forest"
                          }`}
                        >
                          <span className="font-mono text-charcoal/40">{s.id}</span>
                          <span>{s.productTitle}</span>
                          {isWrong && <span className="ml-auto font-medium">will be cancelled</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {executeResult && (
        <div className="space-y-4">
          <div className={`rounded-xl px-5 py-4 border ${
            executeResult.totalErrors === 0 ? "bg-forest/5 border-forest/20" : "bg-amber-50 border-amber-200"
          }`}>
            <p className="text-sm font-medium text-obsidian">
              Done: {executeResult.totalCancelled} cancelled
              {executeResult.totalErrors > 0 && `, ${executeResult.totalErrors} errors`}
            </p>
          </div>

          {executeResult.cancelled.length > 0 && (
            <div className="bg-white border border-taupe/20 rounded-xl divide-y divide-taupe/10">
              {executeResult.cancelled.map((c) => (
                <div key={c.subId} className="px-5 py-3 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-obsidian">{c.email}</p>
                    <p className="text-xs text-charcoal/50">{c.productTitle}</p>
                  </div>
                  <span className="text-xs font-medium text-forest">Cancelled</span>
                </div>
              ))}
            </div>
          )}

          {executeResult.errors.length > 0 && (
            <div className="bg-white border border-red-200 rounded-xl divide-y divide-red-100">
              {executeResult.errors.map((e) => (
                <div key={e.subId} className="px-5 py-3">
                  <p className="text-sm text-obsidian">{e.email}</p>
                  <p className="text-xs text-red-600 mt-0.5">{e.error}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
