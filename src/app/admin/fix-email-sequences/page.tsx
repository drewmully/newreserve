"use client";

import { useState, useCallback } from "react";
import { useMembership } from "@/app/context/MembershipContext";

interface ResultRow {
  uid: string;
  email: string | null;
  tier: string;
  is_legacy: boolean;
  current_flow: string;
  current_status: string;
  action:
    | "legacy_switched_to_back9"
    | "legacy_already_on_back9"
    | "switched_to_member"
    | "switched_to_access"
    | "already_correct"
    | "skipped_no_user_doc"
    | "skipped_no_email";
}

interface ApiResponse {
  dry_run: boolean;
  summary: {
    total_checked: number;
    legacy_switched_to_back9: number;
    legacy_already_on_back9: number;
    switched_to_member: number;
    switched_to_access: number;
    already_correct: number;
    skipped: number;
  };
  results: ResultRow[];
}

const ACTION_LABELS: Record<ResultRow["action"], string> = {
  legacy_switched_to_back9: "Legacy → back9 flow",
  legacy_already_on_back9: "Legacy — already correct",
  switched_to_member: "free → member",
  switched_to_access: "free → access",
  already_correct: "Already correct",
  skipped_no_user_doc: "Skipped — no user doc",
  skipped_no_email: "Skipped — no email",
};

const ACTION_COLORS: Record<ResultRow["action"], string> = {
  legacy_switched_to_back9: "bg-sage/30 text-forest",
  legacy_already_on_back9: "bg-taupe/20 text-charcoal/50",
  switched_to_member: "bg-forest/10 text-forest",
  switched_to_access: "bg-forest/10 text-forest",
  already_correct: "bg-taupe/20 text-charcoal/50",
  skipped_no_user_doc: "bg-ember/10 text-ember",
  skipped_no_email: "bg-ember/10 text-ember",
};

export default function FixEmailSequencesPage() {
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
      const res = await fetch("/api/admin/fix-email-sequences", {
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
      const res = await fetch("/api/admin/fix-email-sequences", {
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
  const toFix = (previewData?.summary.legacy_switched_to_back9 ?? 0) +
    (previewData?.summary.switched_to_member ?? 0) +
    (previewData?.summary.switched_to_access ?? 0);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="font-serif text-3xl text-obsidian">Fix Email Sequences</h1>
        <p className="text-charcoal/50 text-sm mt-1">
          Finds active sequences where the flow doesn&apos;t match the user&apos;s actual tier and corrects them.
          Back 9 legacy members on the wrong flow are switched to the back9 drip. Paid members restart at step 0 of their correct flow.
        </p>
      </div>

      <div className="bg-bone border border-taupe/30 rounded-xl p-5 mb-8 text-sm text-charcoal/70 space-y-1.5">
        <p><span className="font-medium text-obsidian">Step 1</span> — Run preview to see affected users.</p>
        <p><span className="font-medium text-obsidian">Step 2</span> — Review. Legacy members already on back9 flow show as correct. Those on wrong flows get switched to back9. Paid members restart from step 0.</p>
        <p><span className="font-medium text-obsidian">Step 3</span> — Apply.</p>
      </div>

      {error && (
        <div className="bg-ember/10 border border-ember/20 rounded-xl p-4 text-sm text-ember mb-6">
          {error}
        </div>
      )}

      {!isDone && (
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => void runPreview()}
            disabled={state === "loading" || state === "applying"}
            className="px-5 py-2.5 rounded-lg border border-taupe/40 text-sm text-charcoal hover:bg-taupe/10 transition-colors disabled:opacity-40"
          >
            {state === "loading" ? "Previewing..." : "Run preview"}
          </button>

          {state === "previewed" && toFix > 0 && (
            <button
              onClick={() => void applyFix()}
              className="px-5 py-2.5 rounded-lg bg-forest text-bone text-sm hover:bg-forest/90 transition-colors"
            >
              Apply fix to {toFix} user{toFix !== 1 ? "s" : ""}
            </button>
          )}

          {state === "previewed" && toFix === 0 && (
            <p className="text-sm text-charcoal/50">All sequences are correct — nothing to fix.</p>
          )}
        </div>
      )}

      {isDone && (
        <div className="bg-forest/10 border border-forest/20 rounded-xl p-4 text-sm text-forest mb-8">
          Done. Sequences corrected.
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {[
              { label: "Checked", value: data.summary.total_checked },
              { label: "Legacy → back9", value: data.summary.legacy_switched_to_back9, highlight: true },
              { label: "Switched flows", value: data.summary.switched_to_member + data.summary.switched_to_access, highlight: true },
              { label: "Already correct", value: data.summary.already_correct },
            ].map(({ label, value, highlight }) => (
              <div key={label} className="bg-white border border-taupe/20 rounded-xl p-4">
                <p className={`text-2xl font-serif ${highlight && value > 0 ? "text-forest" : "text-obsidian"}`}>{value}</p>
                <p className="text-xs text-charcoal/40 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          <div className="bg-white border border-taupe/20 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-taupe/10">
              <h2 className="font-serif text-lg text-obsidian">{isDone ? "Results" : "Preview"}</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-taupe/10 bg-bone/50">
                  <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-charcoal/40 font-medium">User</th>
                  <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Tier</th>
                  <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Current flow</th>
                  <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.results
                  .filter((r) => r.action !== "already_correct")
                  .map((row) => (
                    <tr key={row.uid} className="border-b border-taupe/10 last:border-0">
                      <td className="px-5 py-3.5">
                        <p className="text-obsidian font-medium">{row.email ?? "—"}</p>
                        <p className="text-charcoal/40 text-xs">{row.uid}</p>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-charcoal/70">
                        {row.is_legacy ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-obsidian/10 text-obsidian">
                            Back 9 (Legacy)
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-forest/10 text-forest">
                            {row.tier}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-charcoal/50">
                        {row.current_flow} / {row.current_status}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLORS[row.action]}`}>
                          {ACTION_LABELS[row.action]}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>

            {data.results.filter((r) => r.action !== "already_correct").length === 0 && (
              <div className="px-5 py-10 text-center text-charcoal/40 text-sm">
                No sequences need fixing.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
