"use client";

/**
 * /admin/email-replies
 *
 * Drew's approval queue for AI-drafted email replies.
 * Lists all pending replies, shows member context + AI draft,
 * allows editing the draft, then approving (sends + resumes drip)
 * or dismissing.
 *
 * Auth: uses INTERNAL_API_SECRET stored client-side in
 * NEXT_PUBLIC_INTERNAL_API_SECRET. This page is internal-only —
 * not linked from the public site.
 */

import { useEffect, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

interface Reply {
  id: string;
  uid: string;
  email: string;
  firstName: string | null;
  subject: string;
  replyText: string;
  draft: string;
  toolCalls: ToolCall[];
  flow: string;
  lastSentStep: number;
  status: string;
  createdAt: number | null;
  draftedAt: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FLOW_LABELS: Record<string, string> = {
  free: "Free",
  access: "Reserve Access",
  member: "Reserve Member",
};

function formatDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function apiHeaders(): HeadersInit {
  const secret = process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "";
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${secret}`,
  };
}

// ─── Reply Card ───────────────────────────────────────────────────────────────

function ReplyCard({
  reply,
  onResolved,
}: {
  reply: Reply;
  onResolved: (id: string) => void;
}) {
  const [draft, setDraft] = useState(reply.draft ?? "");
  const [loading, setLoading] = useState<"approve" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setLoading("approve");
    setError(null);
    try {
      const res = await fetch(`/api/email/replies/${reply.id}/approve`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ draft }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to approve");
      }
      onResolved(reply.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  async function handleDismiss() {
    setLoading("dismiss");
    setError(null);
    try {
      const res = await fetch(`/api/email/replies/${reply.id}/reject`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to dismiss");
      }
      onResolved(reply.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  const hasDraft = draft.trim().length > 0;
  const flowLabel = FLOW_LABELS[reply.flow] ?? reply.flow;

  return (
    <div className="bg-white border border-taupe/30 rounded-xl p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-serif text-lg text-obsidian">
            {reply.firstName ?? reply.email}
          </p>
          <p className="text-sm text-charcoal/60">{reply.email}</p>
        </div>
        <div className="text-right text-xs text-charcoal/50 space-y-1">
          <p>{flowLabel} — step {reply.lastSentStep + 1}</p>
          <p>{formatDate(reply.createdAt)}</p>
          {reply.status === "draft_failed" && (
            <span className="inline-block px-2 py-0.5 rounded bg-ember/10 text-ember text-xs font-medium">
              Draft failed
            </span>
          )}
        </div>
      </div>

      {/* Subject */}
      <p className="text-sm text-charcoal/70 italic">Re: {reply.subject}</p>

      {/* Member reply */}
      <div>
        <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-2">
          Their message
        </p>
        <div className="bg-bone rounded-lg p-4 text-sm text-charcoal whitespace-pre-wrap leading-relaxed">
          {reply.replyText || <span className="text-charcoal/40">(empty)</span>}
        </div>
      </div>

      {/* AI tool calls */}
      {reply.toolCalls?.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-2">
            AI actions
          </p>
          <div className="flex flex-wrap gap-2">
            {reply.toolCalls.map((tc, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-forest/10 text-forest text-xs font-medium"
                title={JSON.stringify(tc.input, null, 2)}
              >
                {tc.name}
                {tc.input.tag != null && <span className="opacity-70">· {String(tc.input.tag)}</span>}
                {tc.input.category != null && <span className="opacity-70">· {String(tc.input.category)}</span>}
                {tc.input.reason != null && <span className="opacity-70">· {String(tc.input.reason)}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Draft editor */}
      <div>
        <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-2">
          Draft reply {reply.draftedAt && <span className="normal-case">(drafted {formatDate(reply.draftedAt)})</span>}
        </p>
        <textarea
          className="w-full h-48 bg-cream border border-taupe/40 rounded-lg p-4 text-sm text-obsidian leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-forest/30 font-mono"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            reply.status === "draft_failed"
              ? "AI draft failed. Write a reply manually."
              : "Loading draft..."
          }
        />
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-ember">{error}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleApprove}
          disabled={!hasDraft || loading !== null}
          className="px-5 py-2.5 rounded-lg bg-forest text-white text-sm font-medium disabled:opacity-40 hover:bg-forest/90 transition-colors"
        >
          {loading === "approve" ? "Sending..." : "Approve and send"}
        </button>
        <button
          onClick={handleDismiss}
          disabled={loading !== null}
          className="px-5 py-2.5 rounded-lg bg-bone border border-taupe/40 text-charcoal text-sm font-medium disabled:opacity-40 hover:bg-taupe/20 transition-colors"
        >
          {loading === "dismiss" ? "Dismissing..." : "Dismiss"}
        </button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmailRepliesPage() {
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/email/replies", {
        headers: apiHeaders(),
      });
      if (!res.ok) throw new Error("Failed to load replies");
      const data = await res.json();
      setReplies(data.replies ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleResolved(id: string) {
    setReplies((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-serif text-3xl text-obsidian">Reply queue</h1>
            <p className="text-charcoal/60 mt-1 text-sm">
              AI-drafted responses waiting for your approval
            </p>
          </div>
          <button
            onClick={load}
            className="text-sm text-forest hover:underline"
          >
            Refresh
          </button>
        </div>

        {/* Content */}
        {loading && (
          <p className="text-charcoal/50 text-sm">Loading...</p>
        )}

        {error && (
          <div className="bg-ember/10 border border-ember/20 rounded-xl p-4 text-sm text-ember">
            {error}
          </div>
        )}

        {!loading && !error && replies.length === 0 && (
          <div className="text-center py-20">
            <p className="text-charcoal/40 text-sm">All clear. No replies pending.</p>
          </div>
        )}

        <div className="space-y-6">
          {replies.map((reply) => (
            <ReplyCard
              key={reply.id}
              reply={reply}
              onResolved={handleResolved}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
