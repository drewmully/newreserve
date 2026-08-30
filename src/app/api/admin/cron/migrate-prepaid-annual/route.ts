/**
 * POST /api/admin/cron/migrate-prepaid-annual
 *
 * ONE-AT-A-TIME migration of a Loop Member prepaid-annual contract to the
 * new Shopify Subscriptions Partner-Dashboard app. Reads a Loop contract,
 * asserts the exact prepaid-annual signature, creates a new native Shopify
 * SubscriptionContract via `subscriptionContractAtomicCreate`, then cancels
 * the Loop contract. Every step is audited in
 * `public.subscription_migrations`.
 *
 * See:
 *   - memory/knowledge/projects/loop-to-shopify-subscription-migration.md
 *   - memory/sessions/2026-06-29_2026-07-05/a0280c2d/ai_outputs/
 *     loop_to_shopify_migration_plan.md — Sections 3 (mutations) and 4 (script).
 *   - migrations/20260830_subscription_migrations.sql
 *
 * Design rules (enforced here, NOT changeable via query param):
 *   1. `contract_id` is REQUIRED. There is no batch mode in this PR.
 *   2. Default `dry_run=true`. Callers must send `dry_run=false` explicitly
 *      to actually execute Shopify writes and Loop cancel.
 *   3. Refuses to migrate anything that is not an ACTIVE Member prepaid-annual
 *      Loop contract with the exact variant/billing/delivery signature.
 *   4. Idempotent: if a `subscription_migrations` row already exists with
 *      status in ('migrated', 'dry_run_ok'), returns it without re-running.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` OR Firebase bearer for an
 * admin allowlisted email (reuses `requireAdmin`).
 *
 * Failure model:
 *   - Loop lookup fails → 404 or 500, no row written for "not found".
 *   - Signature mismatch → 422, no row written.
 *   - Insert planned row → Postgres unique-constraint on duplicate (idempotent).
 *   - Dry-run success → row status='dry_run_ok', returns summary.
 *   - Shopify create fails → row status='failed', Loop UNTOUCHED. 500.
 *   - Loop cancel fails after Shopify create → row status='failed' with
 *     new_shopify_contract_id and error_message. This is the "reconcile
 *     manually" state; runbook covers rollback.
 *   - Both succeed → row status='migrated', executed_at set, downstream
 *     Firestore + subscribers pointers updated.
 */

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyAdminRequest } from "@/app/api/_lib/adminAuth";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import {
  getLoopSubscriptionById,
  cancelLoopSubscription,
  type LoopSubscription,
} from "@/app/api/_lib/loopAdmin";
import {
  createContractAtomic,
  type AtomicCreateInput,
} from "@/app/api/_lib/shopifySubscriptionsApi";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Member $249/qtr variant — the ONLY variant this route will migrate. */
const MEMBER_QUARTERLY_VARIANT_ID = "47601025122496";

/**
 * Quarterly selling plan under the new Partner-Dashboard app. Left as a
 * TODO until Drew publishes the new sellingPlanGroup — the current Loop
 * contracts reference Loop's own selling plans, which cannot be reused by
 * the Partner app. This route reads `SHOPIFY_QUARTERLY_MEMBER_SELLING_PLAN_ID`
 * from env at write time and refuses to execute a real migration if it is
 * missing. Dry-run still works and captures everything else.
 */
function getQuarterlySellingPlanEnv(): string | null {
  return process.env.SHOPIFY_QUARTERLY_MEMBER_SELLING_PLAN_ID?.trim() || null;
}

// ─── Auth ────────────────────────────────────────────────────────────────

function hasCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function isAuthorized(req: NextRequest): Promise<boolean> {
  if (hasCronSecret(req)) return true;
  // Fall back to admin-allowlisted Firebase bearer (Drew's admin panel).
  const verified = await verifyAdminRequest(req);
  return !!verified;
}

// ─── Signature verification ──────────────────────────────────────────────

interface SignatureCheck {
  ok: boolean;
  reason?: string;
}

function verifyPrepaidAnnualSignature(loop: LoopSubscription): SignatureCheck {
  const raw = loop as unknown as Record<string, unknown>;

  if (typeof raw.status === "string" && raw.status !== "ACTIVE") {
    return { ok: false, reason: `status is ${raw.status}, must be ACTIVE` };
  }
  if (raw.isPrepaid !== true) {
    return { ok: false, reason: "isPrepaid must be true" };
  }

  const bp = raw.billingPolicy as Record<string, unknown> | undefined;
  if (!bp || bp.interval !== "MONTH" || Number(bp.intervalCount) !== 12) {
    return {
      ok: false,
      reason: `billingPolicy must be {interval:MONTH, intervalCount:12}, got ${JSON.stringify(bp)}`,
    };
  }

  const lines = Array.isArray(raw.lines)
    ? (raw.lines as Array<Record<string, unknown>>)
    : [];
  if (lines.length !== 1) {
    return { ok: false, reason: `expected exactly 1 line, got ${lines.length}` };
  }
  const variantId = String(lines[0]?.variantShopifyId ?? "");
  if (variantId !== MEMBER_QUARTERLY_VARIANT_ID) {
    return {
      ok: false,
      reason: `variantShopifyId ${variantId} !== Member quarterly ${MEMBER_QUARTERLY_VARIANT_ID}`,
    };
  }

  return { ok: true };
}

// ─── Field extraction (documents Loop's shape so a code reader can audit) ─

interface LoopExtract {
  shopifyCustomerId: string;
  customerEmail: string;
  nextBillingDate: string | null;       // ISO date, e.g. "2026-11-03"
  nextBillingDateISO: string | null;    // ISO datetime for Shopify
  paymentMethodField: string;           // exact field name from Loop response
  paymentMethodId: string | null;       // stringified value (Loop's numeric id)
  linePriceUsd: number;
  cyclesRemaining: number;              // approx: total prepaid − completed
  boxesRemainingCredit: number;         // matches segmentation.csv column
  unshippedCreditUsd: number;           // linePriceUsd × cyclesRemaining
  variantGid: string;                   // gid://shopify/ProductVariant/…
  customerGid: string;                  // gid://shopify/Customer/…
  shippingAddress: Record<string, unknown> | null;
  currencyCode: string;
  line: Record<string, unknown>;
  loopSellingPlanShopifyId: string | null;
}

function toGid(kind: string, numericId: string | number): string {
  return `gid://shopify/${kind}/${numericId}`;
}

function extractLoopFields(loop: LoopSubscription): LoopExtract {
  const raw = loop as unknown as Record<string, unknown>;
  const customer = (raw.customer ?? {}) as Record<string, unknown>;
  const shopifyCustomerId = String(customer.shopifyId ?? "");
  const customerEmail = String(customer.email ?? "");

  // Loop returns `nextBillingDateEpoch` (unix seconds). Preserve exactly.
  const epoch =
    typeof raw.nextBillingDateEpoch === "number"
      ? (raw.nextBillingDateEpoch as number)
      : null;
  const asDate = epoch ? new Date(epoch * 1000) : null;
  const nextBillingDate = asDate ? asDate.toISOString().slice(0, 10) : null;
  const nextBillingDateISO = asDate ? asDate.toISOString() : null;

  // Loop's field is `customerPaymentMethodId` (see contracts_raw.jsonl).
  // Capture that exact name so any future field rename shows up in the row.
  const paymentMethodField = "customerPaymentMethodId";
  const rawPmId = raw[paymentMethodField];
  const paymentMethodId =
    rawPmId === null || rawPmId === undefined ? null : String(rawPmId);

  const lines = raw.lines as Array<Record<string, unknown>>;
  const line = lines[0] ?? {};
  const linePriceUsd = Number(line.price ?? 0);

  const completedOrdersCount = Number(raw.completedOrdersCount ?? 0);
  // Annual prepaid = 4 quarterly shipments (billing every 12 months, ship
  // every 3). `boxes_remaining_credit` in segmentation.csv is capped at 4.
  const totalPrepaidCycles = 4;
  const cyclesRemaining = Math.max(0, totalPrepaidCycles - completedOrdersCount);
  const boxesRemainingCredit = cyclesRemaining;
  const unshippedCreditUsd = Math.round(linePriceUsd * cyclesRemaining * 100) / 100;

  const variantShopifyId = String(line.variantShopifyId ?? "");
  const variantGid = variantShopifyId
    ? toGid("ProductVariant", variantShopifyId)
    : "";
  const customerGid = shopifyCustomerId ? toGid("Customer", shopifyCustomerId) : "";

  const shippingAddress =
    (raw.shippingAddress as Record<string, unknown> | undefined) ?? null;

  const currencyCode = String(raw.currencyCode ?? "USD");

  const loopSellingPlanShopifyId =
    line.sellingPlanShopifyId === null || line.sellingPlanShopifyId === undefined
      ? null
      : String(line.sellingPlanShopifyId);

  return {
    shopifyCustomerId,
    customerEmail,
    nextBillingDate,
    nextBillingDateISO,
    paymentMethodField,
    paymentMethodId,
    linePriceUsd,
    cyclesRemaining,
    boxesRemainingCredit,
    unshippedCreditUsd,
    variantGid,
    customerGid,
    shippingAddress,
    currencyCode,
    line,
    loopSellingPlanShopifyId,
  };
}

// ─── Downstream pointer updates ──────────────────────────────────────────

async function updateFirestoreContractPointer(
  shopifyCustomerId: string,
  newContractGid: string
): Promise<void> {
  // Firestore users are keyed by uid, not by Shopify customer id. Look up
  // by indexed field. This mirrors the read path in `loopUserContext.ts`.
  const snap = await adminDb
    .collection("users")
    .where("shopify_customer_id", "==", shopifyCustomerId)
    .limit(1)
    .get();
  if (snap.empty) return; // No Firebase user for this Shopify customer.
  const doc = snap.docs[0];
  const data = (doc.data() ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(data.subscription_contract_ids)
    ? (data.subscription_contract_ids as string[])
    : [];
  if (existing.includes(newContractGid)) return;
  await doc.ref.update({
    subscription_contract_ids: [...existing, newContractGid],
  });
}

async function updateSubscribersPointer(
  sb: SupabaseClient,
  shopifyCustomerId: string,
  newContractGid: string
): Promise<void> {
  // subscribers.customer_id is the numeric Shopify id as text.
  await sb
    .from("subscribers")
    .update({ shopify_subscription_id: newContractGid })
    .eq("customer_id", shopifyCustomerId);
}

// ─── Row helpers ─────────────────────────────────────────────────────────

interface MigrationRow {
  id: number;
  loop_contract_id: string;
  shopify_customer_id: string;
  customer_email: string;
  loop_cadence: string;
  loop_is_prepaid: boolean;
  loop_next_billing_date: string | null;
  loop_boxes_remaining_credit: number | null;
  loop_unshipped_credit_usd: number | null;
  loop_payment_method_id: string | null;
  new_shopify_contract_id: string | null;
  status: string;
  dry_run: boolean;
  error_message: string | null;
  planned_at: string;
  executed_at: string | null;
}

async function findExistingRow(
  sb: SupabaseClient,
  loopContractId: string
): Promise<MigrationRow | null> {
  const { data, error } = await sb
    .from("subscription_migrations")
    .select("*")
    .eq("loop_contract_id", loopContractId)
    .maybeSingle();
  if (error) throw new Error(`subscription_migrations select: ${error.message}`);
  return (data as MigrationRow | null) ?? null;
}

async function insertPlannedRow(
  sb: SupabaseClient,
  loopContractId: string,
  extract: LoopExtract,
  loop: LoopSubscription,
  dryRun: boolean
): Promise<MigrationRow> {
  const insert = {
    loop_contract_id: loopContractId,
    shopify_customer_id: extract.shopifyCustomerId,
    customer_email: extract.customerEmail,
    loop_cadence: "annual",
    loop_is_prepaid: true,
    loop_next_billing_date: extract.nextBillingDate,
    loop_boxes_remaining_credit: extract.boxesRemainingCredit,
    loop_unshipped_credit_usd: extract.unshippedCreditUsd,
    loop_payment_method_id: extract.paymentMethodId,
    status: "planned",
    dry_run: dryRun,
    raw_loop_snapshot: loop,
  };
  const { data, error } = await sb
    .from("subscription_migrations")
    .insert(insert)
    .select("*")
    .single();
  if (error) throw new Error(`subscription_migrations insert: ${error.message}`);
  return data as MigrationRow;
}

async function markRow(
  sb: SupabaseClient,
  id: number,
  patch: Partial<MigrationRow> & { raw_shopify_response?: unknown }
): Promise<MigrationRow> {
  const { data, error } = await sb
    .from("subscription_migrations")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`subscription_migrations update: ${error.message}`);
  return data as MigrationRow;
}

// ─── Route ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const contractId = url.searchParams.get("contract_id")?.trim() || "";
  // dry_run defaults to true. Only the explicit string "false" turns it off.
  const dryRunParam = url.searchParams.get("dry_run");
  const dryRun = dryRunParam !== "false"; // any other value → true

  if (!contractId) {
    return NextResponse.json(
      {
        error: "contract_id is required",
        note: "This route is one-at-a-time by design. No batch mode.",
      },
      { status: 400 }
    );
  }

  // 1) Fetch from Loop.
  let loop: LoopSubscription | null = null;
  try {
    loop = await getLoopSubscriptionById(contractId);
  } catch (e) {
    return NextResponse.json(
      {
        error: "loop_lookup_failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }
  if (!loop) {
    return NextResponse.json(
      { error: "loop_contract_not_found", contract_id: contractId },
      { status: 404 }
    );
  }

  // 2) Signature check.
  const sig = verifyPrepaidAnnualSignature(loop);
  if (!sig.ok) {
    return NextResponse.json(
      { error: "signature_mismatch", reason: sig.reason },
      { status: 422 }
    );
  }

  // 3) Extract Loop fields.
  const extract = extractLoopFields(loop);

  // 4) Supabase — idempotency check.
  const sb = getSupabaseService();
  const existing = await findExistingRow(sb, contractId);
  if (
    existing &&
    (existing.status === "migrated" || existing.status === "dry_run_ok")
  ) {
    return NextResponse.json({
      ok: true,
      dry_run: existing.dry_run,
      idempotent: true,
      migration_row: existing,
    });
  }

  // 5) Insert planned row (or continue with existing failed/planned row).
  //    If a prior failed row exists, we let the caller decide via runbook —
  //    we do NOT auto-retry.
  if (existing && (existing.status === "failed" || existing.status === "planned")) {
    return NextResponse.json(
      {
        error: "prior_row_needs_review",
        row: existing,
        note:
          "A prior attempt for this contract exists. Consult the runbook " +
          "before re-running to avoid double-charging or orphaned contracts.",
      },
      { status: 409 }
    );
  }

  let row: MigrationRow;
  try {
    row = await insertPlannedRow(sb, contractId, extract, loop, dryRun);
  } catch (e) {
    return NextResponse.json(
      {
        error: "insert_planned_row_failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }

  // 6) Dry-run exit.
  if (dryRun) {
    const finalRow = await markRow(sb, row.id, { status: "dry_run_ok" });
    return NextResponse.json({
      ok: true,
      dry_run: true,
      migration_row: finalRow,
      would_create: {
        customerId: extract.customerGid,
        nextBillingDate: extract.nextBillingDateISO,
        variant: extract.variantGid,
        cyclesRemaining: extract.cyclesRemaining,
        unshippedCreditUsd: extract.unshippedCreditUsd,
        paymentMethodField: extract.paymentMethodField,
        paymentMethodId: extract.paymentMethodId,
      },
    });
  }

  // 7) Real execution — refuse if the new selling-plan env var is missing.
  const sellingPlanNumeric = getQuarterlySellingPlanEnv();
  if (!sellingPlanNumeric) {
    const finalRow = await markRow(sb, row.id, {
      status: "failed",
      error_message:
        "SHOPIFY_QUARTERLY_MEMBER_SELLING_PLAN_ID is not set. Cannot execute real migration.",
    });
    return NextResponse.json(
      {
        error: "missing_env",
        migration_row: finalRow,
      },
      { status: 500 }
    );
  }
  const sellingPlanGid = toGid("SellingPlan", sellingPlanNumeric);

  if (!extract.paymentMethodId) {
    const finalRow = await markRow(sb, row.id, {
      status: "failed",
      error_message: "Loop contract has no customerPaymentMethodId; cannot pass to Shopify.",
    });
    return NextResponse.json({ error: "missing_payment_method", migration_row: finalRow }, { status: 500 });
  }

  // 7a) Shopify atomic create.
  const input: AtomicCreateInput = {
    customerId: extract.customerGid,
    nextBillingDate: extract.nextBillingDateISO ?? new Date().toISOString(),
    currencyCode: extract.currencyCode,
    billingPolicy: { interval: "MONTH", intervalCount: 3 },
    deliveryPolicy: { interval: "MONTH", intervalCount: 3 },
    paymentMethodId: toGid("CustomerPaymentMethod", extract.paymentMethodId),
    lines: [
      {
        productVariantId: extract.variantGid,
        sellingPlanId: sellingPlanGid,
        quantity: 1,
        currentPrice: extract.linePriceUsd,
      },
    ],
    deliveryMethod: extract.shippingAddress
      ? { shipping: { address: extract.shippingAddress } }
      : undefined,
    idempotencyKey: `migrate_${contractId}`,
  };

  let created;
  try {
    created = await createContractAtomic(input);
  } catch (e) {
    const finalRow = await markRow(sb, row.id, {
      status: "failed",
      error_message: `shopify_create_failed: ${e instanceof Error ? e.message : String(e)}`,
    });
    return NextResponse.json(
      {
        error: "shopify_create_failed",
        migration_row: finalRow,
        note: "Loop contract was NOT touched. Safe to retry after fixing.",
      },
      { status: 500 }
    );
  }

  const newContractId = created?.id ?? null;
  if (!newContractId) {
    const finalRow = await markRow(sb, row.id, {
      status: "failed",
      error_message: "shopify_create returned no contract id",
      raw_shopify_response: created as unknown as Record<string, unknown>,
    });
    return NextResponse.json(
      { error: "shopify_create_empty", migration_row: finalRow },
      { status: 500 }
    );
  }

  // 7b) Cancel Loop.
  try {
    await cancelLoopSubscription(contractId, "migrated_to_shopify_native");
  } catch (e) {
    const finalRow = await markRow(sb, row.id, {
      status: "failed",
      new_shopify_contract_id: newContractId,
      raw_shopify_response: created as unknown as Record<string, unknown>,
      error_message: `loop_cancel_failed: ${e instanceof Error ? e.message : String(e)}`,
    });
    return NextResponse.json(
      {
        error: "loop_cancel_failed_after_shopify_create",
        migration_row: finalRow,
        new_shopify_contract_id: newContractId,
        note:
          "Shopify contract was created but Loop is still ACTIVE. " +
          "Manual reconcile required — see runbook.",
      },
      { status: 500 }
    );
  }

  // 7c) Mark migrated + fan out to Firestore and subscribers.
  const finalRow = await markRow(sb, row.id, {
    status: "migrated",
    new_shopify_contract_id: newContractId,
    executed_at: new Date().toISOString(),
    raw_shopify_response: created as unknown as Record<string, unknown>,
  });

  try {
    await updateFirestoreContractPointer(extract.shopifyCustomerId, newContractId);
  } catch (e) {
    // Non-fatal: log in error_message but keep status=migrated.
    await markRow(sb, row.id, {
      error_message: `firestore_update_failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    });
  }

  try {
    await updateSubscribersPointer(sb, extract.shopifyCustomerId, newContractId);
  } catch (e) {
    await markRow(sb, row.id, {
      error_message: `subscribers_update_failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    });
  }

  return NextResponse.json({
    ok: true,
    dry_run: false,
    migration_row: finalRow,
    shopify_response: created,
    loop_cancel_response: { ok: true },
  });
}
