/**
 * POST /api/admin/fix-legacy-tiers
 *
 * One-time migration: finds users with tier="free" but an active Loop
 * subscription, resolves their correct tier from Loop's variant_id, then
 * updates Firestore and restarts their email sequence.
 *
 * Body:
 *   { dry_run: boolean }   — dry_run=true returns a preview without writing
 *
 * Auth: Firebase Bearer token (admin email allowlist).
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { getLoopRawSubscriptions } from "@/app/api/_lib/loopAdmin";
import { resolveMemberTierFromVariantId } from "@/lib/membershipConfig";
import { startFlow, type EmailFlow } from "@/lib/email/sequences";

async function verifyAdmin(request: NextRequest): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
  return decoded.uid;
}

interface ResultRow {
  uid: string;
  email: string | null;
  loop_variant_id: string | null;
  resolved_tier: string | null;
  action: "updated" | "skipped_no_shopify_id" | "skipped_unknown_variant" | "skipped_loop_error";
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }

  let dryRun = true;
  try {
    const body = (await request.json()) as { dry_run?: boolean };
    dryRun = body.dry_run !== false;
  } catch {
    // default to dry_run=true if body is missing
  }

  // 1. Fetch all users with tier="free" that have a shopify_customer_id.
  // We don't filter by subscriptions.status here because legacy users may
  // never have logged in after purchase, so that field was never cached.
  // Loop itself acts as the source of truth for subscription status.
  const snap = await adminDb
    .collection("users")
    .where("tier", "==", "free")
    .where("shopify_customer_id", "!=", null)
    .get();

  const results: ResultRow[] = [];

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const uid = doc.id;
    const email = (data.email as string | null) ?? null;
    const shopifyCustomerId = (data.shopify_customer_id as string | null) ?? null;
    const firstName = (data.username as string | null) ?? null;

    // 2. Skip users without a Shopify customer ID — can't query Loop
    if (!shopifyCustomerId) {
      results.push({
        uid,
        email,
        loop_variant_id: null,
        resolved_tier: null,
        action: "skipped_no_shopify_id",
      });
      continue;
    }

    // 3. Fetch raw Loop subscriptions for this customer
    let loopVariantId: string | null = null;
    let resolvedTier: ReturnType<typeof resolveMemberTierFromVariantId> = null;

    try {
      const subs = await getLoopRawSubscriptions(shopifyCustomerId);
      const activeSub = subs.find((s) => s.status === "ACTIVE");

      if (activeSub) {
        // Loop may return variant_id or shopify_variant_id depending on the plan
        const rawVariantId = activeSub.shopify_variant_id ?? activeSub.variant_id ?? null;
        loopVariantId = rawVariantId != null ? String(rawVariantId) : null;
        resolvedTier = resolveMemberTierFromVariantId(rawVariantId);
      }
    } catch (err) {
      results.push({
        uid,
        email,
        loop_variant_id: null,
        resolved_tier: null,
        action: "skipped_loop_error",
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // 4. Skip if we can't map the variant to a known tier
    if (!resolvedTier) {
      results.push({
        uid,
        email,
        loop_variant_id: loopVariantId,
        resolved_tier: null,
        action: "skipped_unknown_variant",
      });
      continue;
    }

    // 5. Apply fix (unless dry run)
    if (!dryRun) {
      const emailFlow: EmailFlow = resolvedTier === "member" ? "member" : "access";

      await doc.ref.update({
        tier: resolvedTier,
        updated_at: Date.now(),
      });

      if (email) {
        await startFlow(uid, email, firstName, emailFlow);
      }
    }

    results.push({
      uid,
      email,
      loop_variant_id: loopVariantId,
      resolved_tier: resolvedTier,
      action: "updated",
    });
  }

  const summary = {
    total_candidates: snap.size,
    would_update: results.filter((r) => r.action === "updated").length,
    skipped_no_shopify_id: results.filter((r) => r.action === "skipped_no_shopify_id").length,
    skipped_unknown_variant: results.filter((r) => r.action === "skipped_unknown_variant").length,
    skipped_loop_error: results.filter((r) => r.action === "skipped_loop_error").length,
  };

  return NextResponse.json({
    dry_run: dryRun,
    summary,
    results,
  });
}
