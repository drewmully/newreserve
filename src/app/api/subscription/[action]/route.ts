/**
 * POST /api/subscription/[action]
 *
 * NEW Shopify-Subscriptions-backed replacement for /api/loop/subscription/[action].
 *
 * GATED BY `SUBSCRIPTIONS_BACKEND` — until Drew sets it to "shopify" in Vercel,
 * every action returns 404. This is intentional: this route is scaffolding.
 * The Loop route continues to serve `/account` unchanged.
 *
 * Actions:
 *   pause | resume | cancel | change-plan | reactivate | swap-product
 *   skip-next | update-address | update-payment-method | update-line-attributes
 *
 * Body shapes (all optional unless noted):
 *   pause / resume / reactivate: { contractId? }
 *   cancel:                      { contractId?, reason? }
 *   change-plan:                 { contractId?, sellingPlanShopifyId }
 *   swap-product:                { contractId?, variantShopifyId, lineId? }
 *   skip-next:                   { contractId? }
 *   update-address:              { contractId?, address }
 *   update-payment-method:       { contractId?, paymentMethodId }
 *   update-line-attributes:      { contractId?, lineId, attributes: [{key,value}] }
 *
 * Auth: Authorization: Bearer <Firebase ID token>
 *
 * See migration plan Sections 2 and 3 for the full mapping and rationale.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  activateContract,
  cancelContract,
  getContract,
  pauseContract,
  retryBilling,
  skipNextCycle,
  updateContract,
  type BillingPolicyInput,
  type DeliveryPolicyInput,
  type UpdateContractParams,
} from "@/app/api/_lib/shopifySubscriptionsApi";
import {
  getSubscriptionUserContext,
  verifyFirebaseBearer,
} from "@/app/api/_lib/subscriptionUserContext";
import {
  isSupportedSellingPlanId,
  normalizeShopifyNumericId,
  resolveMemberTierFromVariantId,
  SHOPIFY_MEMBERSHIP_PLANS,
} from "@/lib/membershipConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ACTIONS = new Set([
  "pause",
  "resume",
  "cancel",
  "change-plan",
  "reactivate",
  "swap-product",
  "skip-next",
  "update-address",
  "update-payment-method",
  "update-line-attributes",
]);

function subscriptionsBackendEnabled(): boolean {
  return (process.env.SUBSCRIPTIONS_BACKEND ?? "loop").toLowerCase() === "shopify";
}

function toShopifyGid(
  kind: "ProductVariant" | "SellingPlan",
  numeric: string | number
): string {
  return `gid://shopify/${kind}/${numeric}`;
}

function tierPoliciesForSellingPlan(numericSellingPlanId: number): {
  billingPolicy: BillingPolicyInput;
  deliveryPolicy: DeliveryPolicyInput;
} {
  const numeric = numericSellingPlanId;
  if (numeric === SHOPIFY_MEMBERSHIP_PLANS.access.sellingPlanId) {
    return {
      billingPolicy: { interval: "YEAR", intervalCount: 1 },
      deliveryPolicy: { interval: "YEAR", intervalCount: 1 },
    };
  }
  if (numeric === SHOPIFY_MEMBERSHIP_PLANS.member.sellingPlanId) {
    return {
      billingPolicy: { interval: "MONTH", intervalCount: 3 },
      deliveryPolicy: { interval: "MONTH", intervalCount: 3 },
    };
  }
  throw new Error(
    `Unsupported sellingPlanId ${numericSellingPlanId}: only Access and Member plans are handled by /api/subscription/change-plan`
  );
}

function asStringArray(value: unknown): Array<{ key: string; value: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ key: string; value: string }> = [];
  for (const entry of value) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).key === "string" &&
      typeof (entry as Record<string, unknown>).value === "string"
    ) {
      out.push({
        key: (entry as { key: string }).key,
        value: (entry as { value: string }).value,
      });
    }
  }
  return out;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  const { action } = await params;

  if (!subscriptionsBackendEnabled()) {
    // Scaffolding: hide the route entirely until the flag flips.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!VALID_ACTIONS.has(action)) {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  let uid: string;
  try {
    uid = await verifyFirebaseBearer(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await getSubscriptionUserContext(uid);
  if (!context) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // body is optional
  }

  // Resolve the target contract.
  const requestedContractId =
    typeof body.contractId === "string" ? body.contractId.trim() : "";

  const candidateIds = context.subscriptionContractIds;
  const contractId =
    requestedContractId ||
    (candidateIds.length === 1 ? candidateIds[0]! : "");

  if (!contractId) {
    if (candidateIds.length > 1) {
      return NextResponse.json(
        {
          error: "Multiple matching subscription contracts found",
          contractIds: candidateIds,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "No matching subscription contract found" },
      { status: 404 }
    );
  }

  try {
    switch (action) {
      case "pause": {
        await pauseContract(contractId);
        break;
      }
      case "resume":
      case "reactivate": {
        await activateContract(contractId);
        break;
      }
      case "cancel": {
        if (body.reason !== undefined && typeof body.reason !== "string") {
          return NextResponse.json({ error: "Invalid cancel reason" }, { status: 400 });
        }
        await cancelContract(contractId);
        break;
      }
      case "change-plan": {
        const sellingPlanShopifyId = normalizeShopifyNumericId(body.sellingPlanShopifyId);
        if (!sellingPlanShopifyId || !isSupportedSellingPlanId(sellingPlanShopifyId)) {
          return NextResponse.json({ error: "Invalid sellingPlanShopifyId" }, { status: 400 });
        }
        const { billingPolicy, deliveryPolicy } =
          tierPoliciesForSellingPlan(sellingPlanShopifyId);
        // The current contract line is left alone; policies are what change on
        // change-plan. Product swaps use the dedicated `swap-product` action.
        await updateContract(contractId, { billingPolicy, deliveryPolicy });
        break;
      }
      case "swap-product": {
        const swapVariantShopifyId = normalizeShopifyNumericId(body.variantShopifyId);
        if (
          !swapVariantShopifyId ||
          !resolveMemberTierFromVariantId(swapVariantShopifyId)
        ) {
          return NextResponse.json({ error: "Invalid variantShopifyId" }, { status: 400 });
        }
        const explicitLineId =
          typeof body.lineId === "string" && body.lineId.trim() ? body.lineId.trim() : null;

        let lineId = explicitLineId;
        if (!lineId) {
          const summary = await getContract(contractId);
          const firstLine = summary?.lines[0];
          if (!firstLine) {
            return NextResponse.json(
              { error: "No subscription line found" },
              { status: 400 }
            );
          }
          lineId = firstLine.id;
        }

        const tier = resolveMemberTierFromVariantId(swapVariantShopifyId);
        if (!tier) {
          return NextResponse.json(
            { error: "Could not resolve tier from variantShopifyId" },
            { status: 400 }
          );
        }
        const targetSellingPlan = SHOPIFY_MEMBERSHIP_PLANS[tier].sellingPlanId;

        const params: UpdateContractParams = {
          lines: [
            {
              lineId,
              productVariantId: toShopifyGid("ProductVariant", swapVariantShopifyId),
              sellingPlanId: toShopifyGid("SellingPlan", String(targetSellingPlan)),
            },
          ],
        };
        await updateContract(contractId, params);
        break;
      }
      case "skip-next": {
        await skipNextCycle(contractId);
        break;
      }
      case "update-address": {
        if (typeof body.address !== "object" || body.address === null) {
          return NextResponse.json({ error: "Invalid address" }, { status: 400 });
        }
        // Address updates flow through DraftUpdate.deliveryMethod. The exact
        // shape (SubscriptionDeliveryMethodShippingInput) lives in
        // shopifySubscriptionsApi.ts; here we forward the caller's shape so
        // the /account UI can move without re-shaping.
        await updateContract(contractId, {
          // Cast because the caller-provided shape is validated at the
          // GraphQL layer; UI callers pass the Shopify-shaped input directly.
          ...(body.address as unknown as UpdateContractParams),
        });
        break;
      }
      case "update-payment-method": {
        if (
          typeof body.paymentMethodId !== "string" ||
          !body.paymentMethodId.trim()
        ) {
          return NextResponse.json(
            { error: "Invalid paymentMethodId" },
            { status: 400 }
          );
        }
        await updateContract(contractId, {
          paymentMethodId: body.paymentMethodId.trim(),
        });
        break;
      }
      case "update-line-attributes": {
        const lineId =
          typeof body.lineId === "string" && body.lineId.trim()
            ? body.lineId.trim()
            : null;
        if (!lineId) {
          return NextResponse.json({ error: "Invalid lineId" }, { status: 400 });
        }
        const attributes = asStringArray(body.attributes);
        // Replace-not-merge semantics: caller must send the full attribute
        // array for the line. This matches the migration-plan guidance
        // ("always send the full attribute array").
        await updateContract(contractId, {
          customAttributesByLineId: { [lineId]: attributes },
        });
        break;
      }
    }

    return NextResponse.json({ ok: true, contractId, action });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[subscription/${action}] failed:`, detail);
    return NextResponse.json(
      { error: "Shopify Subscriptions API error", detail },
      { status: 502 }
    );
  }
}

// Suppress unused-import warning when `retryBilling` is later called from a
// dedicated /api/subscription/retry-billing route in a follow-up PR.
void retryBilling;
