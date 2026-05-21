/**
 * GET /api/admin/cron/plaid-pull
 *
 * Pulls Plaid account balances and transactions →
 *   plaid_balance_pulls  (one row per account per day, idempotent on
 *                         (pull_date, account_id))
 *   plaid_txn_pulls      (one row per transaction, idempotent on txn_id)
 *
 * Drew's Mercury account(s) live behind Plaid Item access tokens.
 * Supports MULTIPLE items via PLAID_ACCESS_TOKENS (JSON array) or a
 * single PLAID_ACCESS_TOKEN.
 *
 * Required:
 *   PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV (sandbox|development|production)
 *   PLAID_ACCESS_TOKEN  or  PLAID_ACCESS_TOKENS (JSON: ["token1","token2",...])
 *
 * Default txn window: last 30 days.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService, withJobRun } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";
export const maxDuration = 120;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return (req.headers.get("user-agent") || "").includes("vercel-cron");
}

function envOrSkip(): { ok: true; clientId: string; secret: string; env: string; tokens: string[] } | { ok: false; missing: string[] } {
  const clientId = process.env.PLAID_CLIENT_ID || "";
  const secret = process.env.PLAID_SECRET || "";
  const env = process.env.PLAID_ENV || "production";
  const missing: string[] = [];
  if (!clientId) missing.push("PLAID_CLIENT_ID");
  if (!secret) missing.push("PLAID_SECRET");

  let tokens: string[] = [];
  if (process.env.PLAID_ACCESS_TOKENS) {
    try {
      const parsed = JSON.parse(process.env.PLAID_ACCESS_TOKENS);
      if (Array.isArray(parsed)) tokens = parsed.filter((t): t is string => typeof t === "string");
    } catch {
      // ignored
    }
  }
  if (tokens.length === 0 && process.env.PLAID_ACCESS_TOKEN) tokens = [process.env.PLAID_ACCESS_TOKEN];
  if (tokens.length === 0) missing.push("PLAID_ACCESS_TOKEN(S)");

  if (missing.length) return { ok: false, missing };
  return { ok: true, clientId, secret, env, tokens };
}

function plaidBase(env: string) {
  if (env === "sandbox") return "https://sandbox.plaid.com";
  if (env === "development") return "https://development.plaid.com";
  return "https://production.plaid.com";
}

async function plaidPost(env: string, path: string, body: Record<string, unknown>): Promise<unknown> {
  const r = await fetch(`${plaidBase(env)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`plaid ${path}: ${r.status} ${text}`);
  return JSON.parse(text);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") || "30");

  const result = await withJobRun("plaid-pull", async ({ setMeta, bumpRows }) => {
    const cfg = envOrSkip();
    if (!cfg.ok) {
      setMeta({ skipped: true, missing: cfg.missing });
      return { skipped: true, missing: cfg.missing };
    }

    const today = new Date().toISOString().slice(0, 10);
    const end = new Date();
    const start = new Date();
    start.setUTCDate(end.getUTCDate() - days);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const svc = getSupabaseService();
    type AccountResp = {
      accounts?: Array<{
        account_id?: string;
        name?: string;
        official_name?: string;
        balances?: { current?: number | null; available?: number | null };
      }>;
    };
    type TxnResp = {
      transactions?: Array<{
        transaction_id?: string;
        account_id?: string;
        date?: string;
        amount?: number;
        name?: string;
        merchant_name?: string | null;
        category?: string[] | null;
        pending?: boolean;
      }>;
      total_transactions?: number;
    };

    let totalBalances = 0;
    let totalTxns = 0;
    let readBalances = 0;
    let readTxns = 0;

    for (const token of cfg.tokens) {
      // Balances
      const bal = (await plaidPost(cfg.env, "/accounts/balance/get", {
        client_id: cfg.clientId,
        secret: cfg.secret,
        access_token: token,
      })) as AccountResp;
      const balRows = (bal.accounts || []).map((a) => ({
        pull_date: today,
        account_id: a.account_id || "unknown",
        account_name: a.name || a.official_name || null,
        balance: a.balances?.current ?? null,
        available: a.balances?.available ?? null,
        raw: a,
      }));
      readBalances += balRows.length;
      if (balRows.length > 0) {
        const { error } = await svc
          .from("plaid_balance_pulls")
          .upsert(balRows, { onConflict: "pull_date,account_id" });
        if (error) throw new Error(`plaid balance upsert: ${error.message}`);
        totalBalances += balRows.length;
      }

      // Transactions — paginate
      let offset = 0;
      const pageSize = 500;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const tx = (await plaidPost(cfg.env, "/transactions/get", {
          client_id: cfg.clientId,
          secret: cfg.secret,
          access_token: token,
          start_date: fmt(start),
          end_date: fmt(end),
          options: { count: pageSize, offset },
        })) as TxnResp;
        const txns = tx.transactions || [];
        readTxns += txns.length;
        if (txns.length === 0) break;
        const rows = txns.map((t) => ({
          txn_id: t.transaction_id || "",
          account_id: t.account_id || "",
          posted_date: t.date || null,
          amount: t.amount ?? null,
          name: t.name || null,
          merchant_name: t.merchant_name || null,
          category: t.category || null,
          pending: t.pending ?? null,
          raw: t,
        }));
        const cleaned = rows.filter((r) => r.txn_id);
        if (cleaned.length > 0) {
          const { error } = await svc
            .from("plaid_txn_pulls")
            .upsert(cleaned, { onConflict: "txn_id" });
          if (error) throw new Error(`plaid txn upsert: ${error.message}`);
          totalTxns += cleaned.length;
        }
        offset += txns.length;
        if (offset >= (tx.total_transactions || 0)) break;
        if (offset > 50000) break; // hard safety cap
      }
    }

    bumpRows(readBalances + readTxns, totalBalances + totalTxns);
    setMeta({
      tokens: cfg.tokens.length,
      balances_written: totalBalances,
      txns_written: totalTxns,
      range: [fmt(start), fmt(end)],
    });
    return { balances_written: totalBalances, txns_written: totalTxns };
  });

  return NextResponse.json(result);
}
