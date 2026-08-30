/**
 * Tests for /api/admin/cron/migrate-prepaid-annual.
 *
 * Covers the seven paths called out in PR #128:
 *   - Dry-run happy path
 *   - Contract not found in Loop
 *   - Contract does not match prepaid-annual signature
 *   - Contract already migrated (idempotent)
 *   - Shopify create fails → Loop untouched
 *   - Loop cancel fails after Shopify create → row marked failed with both ids
 *   - Real success path
 */

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────

const getLoopSubscriptionByIdMock = vi.fn();
const cancelLoopSubscriptionMock = vi.fn();
const createContractAtomicMock = vi.fn();
const verifyAdminRequestMock = vi.fn();

// Supabase chainable mock — records every call so tests can assert on rows.
type Row = Record<string, unknown>;
const supaState: {
  rows: Row[];
  nextId: number;
  simulateInsertError?: string;
  simulateSelectError?: string;
} = { rows: [], nextId: 1 };

function makeSupabaseFrom(table: string) {
  if (table !== "subscription_migrations" && table !== "subscribers") {
    throw new Error(`Unexpected table ${table}`);
  }
  if (table === "subscribers") {
    return {
      update: (_patch: Row) => ({
        eq: (_col: string, _val: string) =>
          Promise.resolve({ data: null, error: null }),
      }),
    };
  }
  return {
    select: (_cols: string) => ({
      eq: (col: string, val: string) => ({
        maybeSingle: () => {
          if (supaState.simulateSelectError) {
            return Promise.resolve({
              data: null,
              error: { message: supaState.simulateSelectError },
            });
          }
          const row = supaState.rows.find((r) => r[col] === val) ?? null;
          return Promise.resolve({ data: row, error: null });
        },
      }),
    }),
    insert: (rec: Row) => ({
      select: (_cols: string) => ({
        single: () => {
          if (supaState.simulateInsertError) {
            return Promise.resolve({
              data: null,
              error: { message: supaState.simulateInsertError },
            });
          }
          const row: Row = {
            id: supaState.nextId++,
            planned_at: new Date().toISOString(),
            executed_at: null,
            new_shopify_contract_id: null,
            error_message: null,
            ...rec,
          };
          supaState.rows.push(row);
          return Promise.resolve({ data: row, error: null });
        },
      }),
    }),
    update: (patch: Row) => ({
      eq: (col: string, val: number) => ({
        select: (_cols: string) => ({
          single: () => {
            const idx = supaState.rows.findIndex((r) => r[col] === val);
            if (idx < 0)
              return Promise.resolve({
                data: null,
                error: { message: "not_found" },
              });
            supaState.rows[idx] = { ...supaState.rows[idx], ...patch };
            return Promise.resolve({ data: supaState.rows[idx], error: null });
          },
        }),
      }),
    }),
  };
}

const firestoreGetMock = vi
  .fn()
  .mockResolvedValue({ empty: true, docs: [] as unknown[] });

vi.mock("@/app/api/_lib/adminAuth", () => ({
  verifyAdminRequest: verifyAdminRequestMock,
}));

vi.mock("@/app/api/_lib/supabaseService", () => ({
  getSupabaseService: () => ({ from: makeSupabaseFrom }),
}));

vi.mock("@/app/api/_lib/loopAdmin", () => ({
  getLoopSubscriptionById: getLoopSubscriptionByIdMock,
  cancelLoopSubscription: cancelLoopSubscriptionMock,
}));

vi.mock("@/app/api/_lib/shopifySubscriptionsApi", () => ({
  createContractAtomic: createContractAtomicMock,
}));

vi.mock("@/lib/firebase-admin", () => ({
  adminDb: {
    collection: () => ({
      where: () => ({
        limit: () => ({
          get: firestoreGetMock,
        }),
      }),
    }),
  },
}));

// ── Fixtures ─────────────────────────────────────────────────────────────

const CRON_SECRET = "test-cron-secret";

function memberPrepaidAnnualContract() {
  // Trimmed but faithful copy of the shape in
  // /home/user/workspace/migration/segmentation/contracts_raw.jsonl.
  return {
    id: "10011705",
    status: "ACTIVE",
    isPrepaid: true,
    currencyCode: "USD",
    completedOrdersCount: 1,
    nextBillingDateEpoch: 1793689530,
    billingPolicy: { interval: "MONTH", intervalCount: 12 },
    deliveryPolicy: { interval: "MONTH", intervalCount: 3 },
    shippingAddress: {
      firstName: "Darell",
      lastName: "Fischer",
      address1: "14101 Spring Gate Terrace",
      city: "Midlothian",
      zip: "23112",
      countryCode: "US",
      provinceCode: "VA",
    },
    lines: [
      {
        variantShopifyId: 47601025122496,
        productShopifyId: 8501257044160,
        sellingPlanShopifyId: 2700312768,
        price: "250.00",
        quantity: 1,
      },
    ],
    customer: { shopifyId: 7549514318016, email: "roadguy86@gmail.com" },
    customerPaymentMethodId: 11249780,
  };
}

function accessAnnualContract() {
  const c = memberPrepaidAnnualContract() as unknown as Record<string, unknown>;
  const lines = c.lines as Array<Record<string, unknown>>;
  lines[0].variantShopifyId = 99999999999; // some other variant → Access $99/yr
  return c;
}

function makeRequest(params: Record<string, string>, opts: { auth?: "cron" | "none" } = { auth: "cron" }) {
  const usp = new URLSearchParams(params);
  const url = `http://localhost/api/admin/cron/migrate-prepaid-annual?${usp}`;
  const headers: Record<string, string> = {};
  if (opts.auth === "cron") headers.authorization = `Bearer ${CRON_SECRET}`;
  return new NextRequest(url, { method: "POST", headers });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/admin/cron/migrate-prepaid-annual/route");
}

// ── Suite ────────────────────────────────────────────────────────────────

describe("/api/admin/cron/migrate-prepaid-annual", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.SHOPIFY_QUARTERLY_MEMBER_SELLING_PLAN_ID = "3000000000";
    supaState.rows = [];
    supaState.nextId = 1;
    supaState.simulateInsertError = undefined;
    supaState.simulateSelectError = undefined;
    getLoopSubscriptionByIdMock.mockReset();
    cancelLoopSubscriptionMock.mockReset().mockResolvedValue(undefined);
    createContractAtomicMock.mockReset();
    verifyAdminRequestMock.mockReset().mockResolvedValue(null);
    firestoreGetMock.mockReset().mockResolvedValue({ empty: true, docs: [] });
  });

  it("401s when unauthenticated", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ contract_id: "10011705" }, { auth: "none" }));
    expect(res.status).toBe(401);
  });

  it("400s when contract_id is missing (no batch mode)", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain("contract_id");
  });

  it("dry-run happy path: writes row status=dry_run_ok, no Shopify or Loop calls", async () => {
    getLoopSubscriptionByIdMock.mockResolvedValue(memberPrepaidAnnualContract());
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ contract_id: "10011705" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      dry_run: boolean;
      migration_row: { status: string; loop_payment_method_id: string };
      would_create: { customerId: string; variant: string; paymentMethodId: string };
    };
    expect(body.ok).toBe(true);
    expect(body.dry_run).toBe(true);
    expect(body.migration_row.status).toBe("dry_run_ok");
    expect(body.migration_row.loop_payment_method_id).toBe("11249780");
    expect(body.would_create.customerId).toBe("gid://shopify/Customer/7549514318016");
    expect(body.would_create.variant).toBe("gid://shopify/ProductVariant/47601025122496");
    expect(createContractAtomicMock).not.toHaveBeenCalled();
    expect(cancelLoopSubscriptionMock).not.toHaveBeenCalled();
  });

  it("404 when Loop returns null for the contract", async () => {
    getLoopSubscriptionByIdMock.mockResolvedValue(null);
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ contract_id: "does-not-exist" }));
    expect(res.status).toBe(404);
    expect(supaState.rows).toHaveLength(0);
  });

  it("422 when contract does not match prepaid-annual signature", async () => {
    getLoopSubscriptionByIdMock.mockResolvedValue(accessAnnualContract());
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ contract_id: "10011705" }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe("signature_mismatch");
    expect(body.reason).toMatch(/variantShopifyId/);
    expect(supaState.rows).toHaveLength(0);
  });

  it("422 when contract is not ACTIVE", async () => {
    const c = memberPrepaidAnnualContract() as unknown as Record<string, unknown>;
    c.status = "CANCELLED";
    getLoopSubscriptionByIdMock.mockResolvedValue(c);
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ contract_id: "10011705" }));
    expect(res.status).toBe(422);
  });

  it("idempotent: returns existing row when status=migrated", async () => {
    supaState.rows.push({
      id: 99,
      loop_contract_id: "10011705",
      status: "migrated",
      dry_run: false,
      new_shopify_contract_id: "gid://shopify/SubscriptionContract/1",
    });
    getLoopSubscriptionByIdMock.mockResolvedValue(memberPrepaidAnnualContract());
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ contract_id: "10011705" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      idempotent: boolean;
      migration_row: { id: number };
    };
    expect(body.idempotent).toBe(true);
    expect(body.migration_row.id).toBe(99);
    expect(createContractAtomicMock).not.toHaveBeenCalled();
  });

  it("idempotent: dry_run_ok also short-circuits", async () => {
    supaState.rows.push({
      id: 42,
      loop_contract_id: "10011705",
      status: "dry_run_ok",
      dry_run: true,
    });
    getLoopSubscriptionByIdMock.mockResolvedValue(memberPrepaidAnnualContract());
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ contract_id: "10011705" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { idempotent: boolean };
    expect(body.idempotent).toBe(true);
  });

  it("real path: Shopify create fails → row=failed, Loop UNTOUCHED", async () => {
    getLoopSubscriptionByIdMock.mockResolvedValue(memberPrepaidAnnualContract());
    createContractAtomicMock.mockRejectedValue(new Error("insufficient scopes"));
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({ contract_id: "10011705", dry_run: "false" })
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error: string;
      migration_row: { status: string; error_message: string };
    };
    expect(body.error).toBe("shopify_create_failed");
    expect(body.migration_row.status).toBe("failed");
    expect(body.migration_row.error_message).toMatch(/insufficient scopes/);
    expect(cancelLoopSubscriptionMock).not.toHaveBeenCalled();
  });

  it("real path: Loop cancel fails after Shopify create → row=failed with BOTH ids", async () => {
    getLoopSubscriptionByIdMock.mockResolvedValue(memberPrepaidAnnualContract());
    createContractAtomicMock.mockResolvedValue({
      id: "gid://shopify/SubscriptionContract/555",
      status: "ACTIVE",
    });
    cancelLoopSubscriptionMock.mockRejectedValue(new Error("loop 502"));
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({ contract_id: "10011705", dry_run: "false" })
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error: string;
      migration_row: {
        status: string;
        new_shopify_contract_id: string;
        error_message: string;
      };
      new_shopify_contract_id: string;
    };
    expect(body.error).toBe("loop_cancel_failed_after_shopify_create");
    expect(body.migration_row.status).toBe("failed");
    expect(body.migration_row.new_shopify_contract_id).toBe(
      "gid://shopify/SubscriptionContract/555"
    );
    expect(body.migration_row.error_message).toMatch(/loop_cancel_failed/);
    expect(body.new_shopify_contract_id).toBe(
      "gid://shopify/SubscriptionContract/555"
    );
  });

  it("real path: full success — row=migrated, Shopify called, Loop cancelled", async () => {
    getLoopSubscriptionByIdMock.mockResolvedValue(memberPrepaidAnnualContract());
    createContractAtomicMock.mockResolvedValue({
      id: "gid://shopify/SubscriptionContract/777",
      status: "ACTIVE",
    });
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({ contract_id: "10011705", dry_run: "false" })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      dry_run: boolean;
      migration_row: {
        status: string;
        new_shopify_contract_id: string;
        executed_at: string | null;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.dry_run).toBe(false);
    expect(body.migration_row.status).toBe("migrated");
    expect(body.migration_row.new_shopify_contract_id).toBe(
      "gid://shopify/SubscriptionContract/777"
    );
    expect(body.migration_row.executed_at).not.toBeNull();
    expect(createContractAtomicMock).toHaveBeenCalledTimes(1);
    expect(cancelLoopSubscriptionMock).toHaveBeenCalledWith(
      "10011705",
      "migrated_to_shopify_native"
    );

    // Verify Shopify input shape: customer GID, quarterly delivery, payment method GID.
    const arg = createContractAtomicMock.mock.calls[0][0] as {
      customerId: string;
      billingPolicy: { interval: string; intervalCount: number };
      deliveryPolicy: { interval: string; intervalCount: number };
      paymentMethodId: string;
      lines: Array<{ productVariantId: string; sellingPlanId: string }>;
    };
    expect(arg.customerId).toBe("gid://shopify/Customer/7549514318016");
    expect(arg.billingPolicy).toEqual({ interval: "MONTH", intervalCount: 3 });
    expect(arg.deliveryPolicy).toEqual({ interval: "MONTH", intervalCount: 3 });
    expect(arg.paymentMethodId).toBe(
      "gid://shopify/CustomerPaymentMethod/11249780"
    );
    expect(arg.lines[0].productVariantId).toBe(
      "gid://shopify/ProductVariant/47601025122496"
    );
    expect(arg.lines[0].sellingPlanId).toBe(
      "gid://shopify/SellingPlan/3000000000"
    );
  });

  it("refuses real execution if SHOPIFY_QUARTERLY_MEMBER_SELLING_PLAN_ID missing", async () => {
    delete process.env.SHOPIFY_QUARTERLY_MEMBER_SELLING_PLAN_ID;
    getLoopSubscriptionByIdMock.mockResolvedValue(memberPrepaidAnnualContract());
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({ contract_id: "10011705", dry_run: "false" })
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; migration_row: { status: string } };
    expect(body.error).toBe("missing_env");
    expect(body.migration_row.status).toBe("failed");
    expect(createContractAtomicMock).not.toHaveBeenCalled();
  });

  it("409s when a prior failed row exists (manual review required)", async () => {
    supaState.rows.push({
      id: 5,
      loop_contract_id: "10011705",
      status: "failed",
      error_message: "loop_cancel_failed: earlier",
      new_shopify_contract_id: "gid://shopify/SubscriptionContract/111",
    });
    getLoopSubscriptionByIdMock.mockResolvedValue(memberPrepaidAnnualContract());
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ contract_id: "10011705" }));
    expect(res.status).toBe(409);
  });
});
