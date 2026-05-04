/**
 * GET  /api/admin/cleanup/reactivated-subs  — dry-run scan
 * POST /api/admin/cleanup/reactivated-subs  — execute cancellations
 *
 * Finds mulligan_submissions that were processed in the first cron run,
 * checks each user's Loop subscriptions, and identifies any ACTIVE subs
 * that are NOT Reserve-related (i.e. incorrectly reactivated by the old cron
 * before the Reserve-keyword filter was added).
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { resolveCustomerByEmail } from "@/app/api/_lib/shopifyAdmin";
import { getLoopRawSubscriptions, cancelLoopSubscription } from "@/app/api/_lib/loopAdmin";

const RESERVE_KEYWORDS = ["reserve", "back 9", "mullybox", "mully"];

function isReserveSub(sub: { lines?: Array<Record<string, unknown>> }): boolean {
  const title = String((sub.lines as Array<Record<string, unknown>> | undefined)?.[0]?.productTitle ?? "").toLowerCase();
  return RESERVE_KEYWORDS.some((kw) => title.includes(kw));
}

async function verifyAdmin(request: NextRequest): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) throw new Error("Forbidden");
}

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

async function scanProcessedUsers(): Promise<UserResult[]> {
  const snap = await adminDb
    .collection("mulligan_submissions")
    .where("status", "==", "processed")
    .get();

  const emails = [...new Set(snap.docs.map((d) => (d.data() as { email: string }).email))];

  const results: UserResult[] = [];

  for (const email of emails) {
    try {
      const shopifyCustomerId = await resolveCustomerByEmail(email);
      if (!shopifyCustomerId) {
        results.push({ email, shopifyCustomerId: null, activeSubs: [], wrongSubs: [], error: "No Shopify account" });
        continue;
      }

      const subs = await getLoopRawSubscriptions(shopifyCustomerId);
      const activeSubs: SubInfo[] = subs
        .filter((s) => s.status === "ACTIVE")
        .map((s) => ({
          id: s.id,
          productTitle: String((s.lines as Array<Record<string, unknown>> | undefined)?.[0]?.productTitle ?? "Unknown"),
          status: s.status,
        }));

      const wrongSubs = activeSubs.filter((s) => {
        const title = s.productTitle.toLowerCase();
        return !RESERVE_KEYWORDS.some((kw) => title.includes(kw));
      });

      results.push({ email, shopifyCustomerId, activeSubs, wrongSubs });
    } catch (err) {
      results.push({
        email,
        shopifyCustomerId: null,
        activeSubs: [],
        wrongSubs: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

export async function GET(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }

  const users = await scanProcessedUsers();
  const totalToCancel = users.reduce((sum, u) => sum + u.wrongSubs.length, 0);

  return NextResponse.json({ users, totalToCancel, dryRun: true });
}

export async function POST(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }

  const { confirm } = (await request.json()) as { confirm?: boolean };
  if (!confirm) return NextResponse.json({ error: "Pass { confirm: true } to execute" }, { status: 400 });

  const users = await scanProcessedUsers();

  const cancelled: { email: string; subId: string; productTitle: string }[] = [];
  const errors: { email: string; subId: string; error: string }[] = [];

  for (const user of users) {
    for (const sub of user.wrongSubs) {
      try {
        await cancelLoopSubscription(sub.id, "Incorrectly reactivated by mulligan cron — not a Reserve subscription");
        cancelled.push({ email: user.email, subId: sub.id, productTitle: sub.productTitle });
      } catch (err) {
        errors.push({ email: user.email, subId: sub.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return NextResponse.json({ cancelled, errors, totalCancelled: cancelled.length, totalErrors: errors.length });
}
