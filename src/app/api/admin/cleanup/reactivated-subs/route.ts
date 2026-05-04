/**
 * GET  /api/admin/cleanup/reactivated-subs  — dry-run scan
 * POST /api/admin/cleanup/reactivated-subs  — execute cancellations
 *
 * For each processed Mulligan user, checks their Loop subscriptions.
 * If a user still has a CANCELLED Reserve sub, it means the cron reactivated
 * the WRONG sub (a non-Reserve one). The active sub(s) for that user are the
 * incorrectly reactivated ones — those are the ones we cancel.
 *
 * Subs that were already active before the cron ran are NOT touched, because
 * those users will have no CANCELLED Reserve sub remaining.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { resolveCustomerByEmail } from "@/app/api/_lib/shopifyAdmin";
import { getLoopRawSubscriptions, cancelLoopSubscription } from "@/app/api/_lib/loopAdmin";

const RESERVE_KEYWORDS = ["reserve", "back 9", "mullybox", "mully"];

function productTitle(sub: Record<string, unknown>): string {
  return String((sub.lines as Array<Record<string, unknown>> | undefined)?.[0]?.productTitle ?? "Unknown");
}

function isReserve(title: string): boolean {
  const lower = title.toLowerCase();
  return RESERVE_KEYWORDS.some((kw) => lower.includes(kw));
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
  cancelledReserveSubs: SubInfo[];
  // wrongSubs = activeSubs when cancelledReserveSubs.length > 0
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
        results.push({ email, shopifyCustomerId: null, activeSubs: [], cancelledReserveSubs: [], wrongSubs: [], error: "No Shopify account" });
        continue;
      }

      const subs = await getLoopRawSubscriptions(shopifyCustomerId);

      const activeSubs: SubInfo[] = subs
        .filter((s) => s.status === "ACTIVE")
        .map((s) => ({ id: s.id, productTitle: productTitle(s as Record<string, unknown>), status: s.status }));

      // Reserve subs that are still CANCELLED — the real sub our cron should have touched
      const cancelledReserveSubs: SubInfo[] = subs
        .filter((s) => s.status === "CANCELLED" && isReserve(productTitle(s as Record<string, unknown>)))
        .map((s) => ({ id: s.id, productTitle: productTitle(s as Record<string, unknown>), status: s.status }));

      // Only flag active subs as wrong when the Reserve sub is still CANCELLED.
      // This means the cron reactivated a different sub instead of the Reserve one.
      const wrongSubs = cancelledReserveSubs.length > 0 ? activeSubs : [];

      results.push({ email, shopifyCustomerId, activeSubs, cancelledReserveSubs, wrongSubs });
    } catch (err) {
      results.push({
        email,
        shopifyCustomerId: null,
        activeSubs: [],
        cancelledReserveSubs: [],
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
        await cancelLoopSubscription(sub.id, "Incorrectly reactivated by mulligan cron — Reserve sub still cancelled");
        cancelled.push({ email: user.email, subId: sub.id, productTitle: sub.productTitle });
      } catch (err) {
        errors.push({ email: user.email, subId: sub.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return NextResponse.json({ cancelled, errors, totalCancelled: cancelled.length, totalErrors: errors.length });
}
