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
import { getLoopRawSubscriptions, getLoopSubscriptionById } from "@/app/api/_lib/loopAdmin";
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
  loop_plan_name: string | null;
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

  // 1. Fetch users with an active Loop subscription cached in Firestore.
  // We can't reliably filter by missing tier fields (Firestore won't return
  // documents where the field is absent via == null). Instead, query by
  // subscriptions.status = "active" and filter unpaid tiers client-side.
  const PAID_TIERS = new Set(["access", "member", "black"]);
  let docs: FirebaseFirestore.QueryDocumentSnapshot[];
  try {
    const snap = await adminDb
      .collection("users")
      .where("subscriptions.status", "==", "active")
      .get();
    // Keep only users without a paid tier (missing field, null, or "free")
    docs = snap.docs.filter((doc) => {
      const tier = (doc.data() as Record<string, unknown>).tier;
      return !tier || !PAID_TIERS.has(tier as string);
    });
  } catch (err) {
    console.error("[fix-legacy-tiers] Firestore query failed:", err);
    return NextResponse.json({ error: "Firestore query failed" }, { status: 500 });
  }

  const results: ResultRow[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (const doc of docs) {
    await sleep(300); // avoid Loop API rate limiting
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
        loop_plan_name: null,
        loop_variant_id: null,
        resolved_tier: null,
        action: "skipped_no_shopify_id",
      });
      continue;
    }

    // 3. Fetch raw Loop subscriptions for this customer
    let loopVariantId: string | null = null;
    let loopPlanName: string | null = null;
    let resolvedTier: ReturnType<typeof resolveMemberTierFromVariantId> = null;

    try {
      const subs = await getLoopRawSubscriptions(shopifyCustomerId);
      const activeSub = subs.find((s) => s.status === "ACTIVE");

      if (activeSub) {
        let detailedSub = activeSub;

        // The list endpoint only returns id+status — fetch full detail for variant.
        const listVariant = activeSub.shopify_variant_id ?? activeSub.variant_id ?? null;
        if (listVariant == null) {
          const detail = await getLoopSubscriptionById(activeSub.id);
          if (detail) detailedSub = detail;
        }

        // Loop nests variant info under lines[0]
        type LoopLine = { variantShopifyId?: unknown; productTitle?: string; sellingPlanName?: string };
        const lines = detailedSub.lines as LoopLine[] | undefined;
        const firstLine = lines?.[0];

        const rawVariantId =
          firstLine?.variantShopifyId ??
          detailedSub.shopify_variant_id ??
          detailedSub.variant_id ??
          null;

        loopVariantId = rawVariantId != null ? String(rawVariantId) : null;
        resolvedTier = resolveMemberTierFromVariantId(rawVariantId);

        // Human-readable plan name for the UI
        if (firstLine?.productTitle) {
          loopPlanName = firstLine.sellingPlanName
            ? `${firstLine.productTitle} · ${firstLine.sellingPlanName}`
            : firstLine.productTitle;
        }
      }
    } catch (err) {
      results.push({
        uid,
        email,
        loop_plan_name: null,
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
        loop_plan_name: loopPlanName,
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
      loop_plan_name: loopPlanName,
      loop_variant_id: loopVariantId,
      resolved_tier: resolvedTier,
      action: "updated",
    });
  }

  const summary = {
    total_candidates: docs.length,
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
