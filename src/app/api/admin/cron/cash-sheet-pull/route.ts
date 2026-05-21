/**
 * GET /api/admin/cron/cash-sheet-pull
 *
 * Pulls Drew's cash sheet (Google Sheets) into `gsheet_cash_pulls`, one
 * row per day. Idempotent on (row_date, source_sheet_id, source_tab).
 *
 * Expects either:
 *   GOOGLE_SERVICE_ACCOUNT_JSON_BASE64  — base64-encoded JSON for a service account
 *      with read access to the cash sheet, OR
 *   GOOGLE_SHEETS_API_KEY               — public-sheet API key (sheet must be shared)
 *
 * Sheet config (overridable via env):
 *   CASH_SHEET_ID  default: 1n5V7uyGw7BBOKDtRchMFJ0NShdPCAKEoBVuc0MQr4BY
 *   CASH_SHEET_TAB default: Sheet1
 *
 * Expected sheet layout:
 *   Row 1: header row with at least "Date" and "Cash" (and optional "Brand")
 *   Rows 2+: one row per date. Cash column is parsed as number.
 *
 * Soft-skips with reason when no auth method is configured.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService, withJobRun } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return (req.headers.get("user-agent") || "").includes("vercel-cron");
}

const SHEET_ID = process.env.CASH_SHEET_ID || "1n5V7uyGw7BBOKDtRchMFJ0NShdPCAKEoBVuc0MQr4BY";
const SHEET_TAB = process.env.CASH_SHEET_TAB || "Sheet1";

async function fetchSheetValues(): Promise<string[][] | null> {
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (apiKey) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_TAB)}?key=${apiKey}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`sheets api: ${r.status} ${await r.text()}`);
    const j = (await r.json()) as { values?: string[][] };
    return j.values || [];
  }
  // Service account path
  const saB64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!saB64) return null;
  const sa = JSON.parse(Buffer.from(saB64, "base64").toString("utf-8")) as {
    client_email: string;
    private_key: string;
  };
  const token = await mintGoogleAccessToken(sa, "https://www.googleapis.com/auth/spreadsheets.readonly");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_TAB)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`sheets api (sa): ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { values?: string[][] };
  return j.values || [];
}

async function mintGoogleAccessToken(
  sa: { client_email: string; private_key: string },
  scope: string,
): Promise<string> {
  // RS256 JWT → Google OAuth token exchange. No SDK dependency.
  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const sig = signer.sign(sa.private_key).toString("base64url");
  const jwt = `${header}.${claims}.${sig}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!r.ok) throw new Error(`google token: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { access_token: string };
  return j.access_token;
}

function parseDate(s: string): string | null {
  if (!s) return null;
  // accept YYYY-MM-DD or M/D/YYYY or M/D/YY
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    let yr = slash[3];
    if (yr.length === 2) yr = `20${yr}`;
    return `${yr}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

function parseMoney(s: string): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[$,]/g, "").replace(/\s/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await withJobRun("cash-sheet-pull", async ({ setMeta, bumpRows }) => {
    let values: string[][] | null;
    try {
      values = await fetchSheetValues();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMeta({ error: msg });
      throw e;
    }
    if (!values) {
      setMeta({ skipped: true, reason: "no GOOGLE_SHEETS_API_KEY or GOOGLE_SERVICE_ACCOUNT_JSON_BASE64" });
      return { skipped: true };
    }
    if (values.length < 2) {
      setMeta({ skipped: true, reason: "empty sheet" });
      return { skipped: true };
    }

    const header = values[0].map((h) => h.toLowerCase().trim());
    const idxDate = header.findIndex((h) => h.includes("date"));
    const idxCash = header.findIndex((h) => h.includes("cash") || h.includes("total"));
    const idxBrand = header.findIndex((h) => h === "brand");
    if (idxDate < 0 || idxCash < 0) {
      setMeta({ skipped: true, reason: "missing date or cash column" });
      return { skipped: true };
    }

    const rows: Array<{
      row_date: string;
      cash_total: number;
      source_sheet_id: string;
      source_tab: string;
      raw_row: Record<string, unknown>;
    }> = [];
    let read = 0;
    for (const row of values.slice(1)) {
      read += 1;
      const d = parseDate(row[idxDate] || "");
      const c = parseMoney(row[idxCash] || "");
      if (!d || c == null) continue;
      const raw: Record<string, unknown> = {};
      header.forEach((h, i) => (raw[h] = row[i] ?? null));
      if (idxBrand >= 0) raw.brand = (row[idxBrand] || "").toLowerCase() || "mully";
      rows.push({
        row_date: d,
        cash_total: c,
        source_sheet_id: SHEET_ID,
        source_tab: SHEET_TAB,
        raw_row: raw,
      });
    }

    if (rows.length === 0) {
      setMeta({ rows_parsed: 0, rows_read: read });
      return { rows_parsed: 0, rows_read: read };
    }

    const svc = getSupabaseService();
    const { error } = await svc
      .from("gsheet_cash_pulls")
      .upsert(rows, { onConflict: "row_date,source_sheet_id,source_tab" });
    if (error) throw new Error(`gsheet upsert: ${error.message}`);

    bumpRows(read, rows.length);
    setMeta({ rows_parsed: rows.length, rows_read: read });
    return { rows_parsed: rows.length };
  });

  return NextResponse.json(result);
}
