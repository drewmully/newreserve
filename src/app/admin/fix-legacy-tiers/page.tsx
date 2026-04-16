"use client";

import { useState, useCallback } from "react";
import { useMembership } from "@/app/context/MembershipContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ResultRow {
  uid: string;
  email: string | null;
  loop_plan_name: string | null;
  loop_variant_id: string | null;
  resolved_tier: string | null;
  action: "updated" | "skipped_no_shopify_id" | "skipped_unknown_variant" | "skipped_loop_error";
  error?: string;
}

interface ApiResponse {
  dry_run: boolean;
  summary: {
    total_candidates: number;
    would_update: number;
    skipped_no_shopify_id: number;
    skipped_unknown_variant: number;
    skipped_loop_error: number;
  };
  results: ResultRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<ResultRow["action"], string> = {
  updated: "Fixed",
  skipped_no_shopify_id: "Skipped — no Shopify ID",
  skipped_unknown_variant: "Skipped — unknown variant",
  skipped_loop_error: "Skipped — Loop error",
};

const ACTION_COLORS: Record<ResultRow["action"], string> = {
  updated: "bg-forest/10 text-forest",
  skipped_no_shopify_id: "bg-taupe/20 text-charcoal/50",
  skipped_unknown_variant: "bg-ember/10 text-ember",
  skipped_loop_error: "bg-ember/20 text-ember",
};

const TIER_COLORS: Record<string, string> = {
  member: "bg-forest text-bone",
  access: "bg-sage/30 text-forest",
  black: "bg-obsidian text-bone",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FixLegacyTiersPage() {
  const { user: adminUser } = useMembership();

  const [state, setState] = useState<"idle" | "loading" | "previewed" | "applying" | "done">("idle");
  const [previewData, setPreviewData] = useState<ApiResponse | null>(null);
  const [applyData, setApplyData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getHeaders = useCallback(async (): Promise<HeadersInit> => {
    if (!adminUser) throw new Error("Not authenticated");
    const token = await adminUser.getIdToken();
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }, [adminUser]);

  const runPreview = async () => {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/admin/fix-legacy-tiers", {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify({ dry_run: true }),
      });
      const json = (await res.json()) as ApiResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Request failed");
      setPreviewData(json);
      setState("previewed");
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  };

  const applyFix = async () => {
    setState("applying");
    setError(null);
    try {
      const res = await fetch("/api/admin/fix-legacy-tiers", {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify({ dry_run: false }),
      });
      const json = (await res.json()) as ApiResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Request failed");
      setApplyData(json);
      setState("done");
    } catch (e) {
      setError((e as Error).message);
      setState("previewed");
    }
  };

  const data = applyData ?? previewData;
  const isDone = state === "done";

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-serif text-3xl text-obsidian">Fix Legacy Tiers</h1>
        <p className="text-charcoal/50 text-sm mt-1">
          Finds users with tier <span className="font-medium text-charcoal/70">free</span> but an active Loop subscription,
          resolves the correct tier from Loop, and restarts their email sequence.
        </p>
      </div>

      {/* Info box */}
      <div className="bg-bone border border-taupe/30 rounded-xl p-5 mb-8 text-sm text-charcoal/70 space-y-1.5">
        <p><span className="font-medium text-obsidian">Step 1</span> — Run preview to see which users would be affected.</p>
        <p><span className="font-medium text-obsidian">Step 2</span> — Review the list carefully.</p>
        <p><span className="font-medium text-obsidian">Step 3</span> — Apply the fix. This updates Firestore and restarts each user&apos;s email sequence.</p>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-ember/10 border border-ember/20 rounded-xl p-4 text-sm text-ember mb-6">
          {error}
        </div>
      )}

      {/* Actions */}
      {!isDone && (
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => void runPreview()}
            disabled={state === "loading" || state === "applying"}
            className="px-5 py-2.5 rounded-lg border border-taupe/40 text-sm text-charcoal hover:bg-taupe/10 transition-colors disabled:opacity-40"
          >
            {state === "loading" ? "Previewing..." : "Run preview"}
          </button>

          {state === "previewed" && previewData && previewData.summary.would_update > 0 && (
            <button
              onClick={() => void applyFix()}
              className="px-5 py-2.5 rounded-lg bg-forest text-bone text-sm hover:bg-forest/90 transition-colors"
            >
              Apply fix to {previewData.summary.would_update} user{previewData.summary.would_update !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      )}

      {/* Done banner */}
      {isDone && applyData && (
        <div className="bg-forest/10 border border-forest/20 rounded-xl p-4 text-sm text-forest mb-8">
          Done. {applyData.summary.would_update} user{applyData.summary.would_update !== 1 ? "s" : ""} updated.
        </div>
      )}

      {/* Summary cards */}
      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {[
              { label: "Candidates", value: data.summary.total_candidates },
              { label: isDone ? "Updated" : "Would update", value: data.summary.would_update, highlight: true },
              { label: "No Shopify ID", value: data.summary.skipped_no_shopify_id },
              { label: "Unknown variant", value: data.summary.skipped_unknown_variant },
            ].map(({ label, value, highlight }) => (
              <div key={label} className="bg-white border border-taupe/20 rounded-xl p-4">
                <p className={`text-2xl font-serif ${highlight ? "text-forest" : "text-obsidian"}`}>{value}</p>
                <p className="text-xs text-charcoal/40 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Results table */}
          <div className="bg-white border border-taupe/20 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-taupe/10">
              <h2 className="font-serif text-lg text-obsidian">
                {isDone ? "Results" : "Preview"}
              </h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-taupe/10 bg-bone/50">
                  <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-charcoal/40 font-medium">User</th>
                  <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Current Plan</th>
                  <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-charcoal/40 font-medium">New Tier</th>
                  <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((row) => (
                  <tr key={row.uid} className="border-b border-taupe/10 last:border-0">
                    <td className="px-5 py-3.5">
                      <p className="text-obsidian font-medium">{row.email ?? "—"}</p>
                      <p className="text-charcoal/40 text-xs">{row.uid}</p>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-charcoal/70">
                      {row.loop_plan_name ?? "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      {row.resolved_tier ? (
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TIER_COLORS[row.resolved_tier] ?? "bg-taupe/20 text-charcoal/60"}`}>
                          {row.resolved_tier}
                        </span>
                      ) : (
                        <span className="text-charcoal/30 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLORS[row.action]}`}>
                        {ACTION_LABELS[row.action]}
                      </span>
                      {row.error && (
                        <p className="text-xs text-ember/70 mt-0.5">{row.error}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {data.results.length === 0 && (
              <div className="px-5 py-10 text-center text-charcoal/40 text-sm">
                No users found with tier free + active subscription.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
