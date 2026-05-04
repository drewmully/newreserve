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
          Scans the 10 processed Mulligan users for active Loop subscriptions that are not Reserve-related.
          These were incorrectly reactivated by the first cron run before the keyword filter was added.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800">
        <strong>How this works:</strong> The scan checks each processed Mulligan user&apos;s active Loop subscriptions.
        Any active sub whose product title does NOT contain reserve/back 9/mullybox/mully keywords is flagged as incorrectly reactivated.
        Only run &ldquo;Execute&rdquo; after reviewing the scan results.
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
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-obsidian">
              {scanResult.users.length} processed users scanned
            </span>
            <span className={`text-sm font-medium ${scanResult.totalToCancel > 0 ? "text-red-600" : "text-forest"}`}>
              {scanResult.totalToCancel > 0
                ? `${scanResult.totalToCancel} sub(s) to cancel`
                : "All clean — nothing to cancel"}
            </span>
          </div>

          <div className="bg-white border border-taupe/20 rounded-xl divide-y divide-taupe/10">
            {scanResult.users.map((user) => (
              <div key={user.email} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-obsidian">{user.email}</p>
                    {user.error && (
                      <p className="text-xs text-ember mt-0.5">{user.error}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {user.wrongSubs.length > 0 ? (
                      <span className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded px-2 py-0.5">
                        {user.wrongSubs.length} wrong sub(s)
                      </span>
                    ) : (
                      <span className="text-xs text-forest">OK</span>
                    )}
                  </div>
                </div>

                {user.activeSubs.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {user.activeSubs.map((sub) => {
                      const isWrong = user.wrongSubs.some((w) => w.id === sub.id);
                      return (
                        <div
                          key={sub.id}
                          className={`flex items-center gap-3 text-xs rounded-lg px-3 py-2 ${
                            isWrong
                              ? "bg-red-50 border border-red-200 text-red-700"
                              : "bg-forest/5 border border-forest/20 text-forest"
                          }`}
                        >
                          <span className="font-mono text-charcoal/40">{sub.id}</span>
                          <span className="font-medium">{sub.productTitle}</span>
                          {isWrong && (
                            <span className="ml-auto font-medium">will be cancelled</span>
                          )}
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
            executeResult.totalErrors === 0
              ? "bg-forest/5 border-forest/20"
              : "bg-amber-50 border-amber-200"
          }`}>
            <p className="text-sm font-medium text-obsidian">
              Cleanup complete: {executeResult.totalCancelled} cancelled
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
