/**
 * The two invariants that protect public.customers.
 *
 *   1. public.customers.id IS the Shopify customer id. A row created from an
 *      event that carries one MUST use that exact id as its primary key, so
 *      mully-hub's daily sync (upsert onConflict: "id") merges natively.
 *
 *   2. Never insert a row whose lower(email) already exists on a different id.
 *      The same sync recovers from an email collision by DELETING the colliding
 *      row, and five foreign keys behind it cascade.
 *
 * These tests are the reason this module is safe to run against a live table.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "./fakeSupabase";

let supabase: ReturnType<typeof createFakeSupabase>;

vi.mock("@/app/api/_lib/supabaseService", () => ({
  getSupabaseService: () => supabase.client,
}));

async function loadResolver() {
  vi.resetModules();
  return import("@/lib/events/resolve-identity");
}

beforeEach(() => {
  supabase = createFakeSupabase();
  delete process.env.SLACK_ALERT_WEBHOOK_URL;
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_ALERT_CHANNEL;
});

describe("the column contract", () => {
  it("writes exactly five columns and never a consent column", async () => {
    const { buildBackboneCustomerRow } = await loadResolver();
    const row = buildBackboneCustomerRow({ id: "7100000000001", email: "a@example.com" });

    expect(Object.keys(row).sort()).toEqual(
      ["acquisition_source", "created_at", "email", "entity", "id"].sort(),
    );
    expect(row.entity).toBe("mully");
    expect(row.acquisition_source).toBe("event_backbone");
  });
});

describe("invariant 1 — a created row uses the Shopify customer id as its PK", () => {
  it("creates the row under the exact id the event carried", async () => {
    const { resolveIdentity } = await loadResolver();

    const result = await resolveIdentity({
      source: "shopify",
      eventName: "order.paid",
      payload: { customer: { id: 7100000000042, email: "new@example.com" } },
    });

    expect(result.resolution).toBe("created");
    expect(result.customerId).toBe("7100000000042");

    const customers = supabase.state.tables.customers;
    expect(customers).toHaveLength(1);
    expect(String(customers[0].id)).toBe("7100000000042");
  });

  it("resolves to the existing row instead of creating a second one", async () => {
    supabase.state.tables.customers.push({ id: 7100000000042, email: "existing@example.com" });
    const { resolveIdentity } = await loadResolver();

    const result = await resolveIdentity({
      source: "shopify",
      eventName: "order.paid",
      payload: { customer: { id: 7100000000042, email: "existing@example.com" } },
    });

    expect(result.resolution).toBe("resolved");
    expect(result.detail).toBe("shopify_customer_id");
    expect(supabase.state.tables.customers).toHaveLength(1);
  });
});

describe("invariant 2 — never a second row for an email that already exists", () => {
  it("links to the existing owner rather than inserting under the new Shopify id", async () => {
    supabase.state.tables.customers.push({ id: 6000000000001, email: "shared@example.com" });
    const { resolveIdentity } = await loadResolver();

    const result = await resolveIdentity({
      source: "shopify",
      eventName: "order.paid",
      payload: { customer: { id: 7100000000099, email: "shared@example.com" } },
    });

    expect(result.resolution).toBe("linked");
    expect(result.customerId).toBe("6000000000001");
    // The critical assertion: no second row, so the sync's destructive
    // collision-recovery delete is never armed.
    expect(supabase.state.tables.customers).toHaveLength(1);
    expect(
      supabase.state.tables.backbone_alert.some((alert) => alert.kind === "identity_linked"),
    ).toBe(true);
  });

  it("matches email case-insensitively", async () => {
    supabase.state.tables.customers.push({ id: 6000000000002, email: "Mixed.Case@Example.com" });
    const { resolveIdentity } = await loadResolver();

    const result = await resolveIdentity({
      source: "loop",
      eventName: "subscription.cancelled",
      payload: { email: "mixed.case@example.com" },
    });

    expect(result.resolution).toBe("resolved");
    expect(result.customerId).toBe("6000000000002");
    expect(supabase.state.tables.customers).toHaveLength(1);
  });

  it("treats _ and % in an address as literals, not wildcards", async () => {
    supabase.state.tables.customers.push({ id: 6000000000003, email: "a_b@example.com" });
    const { resolveIdentity } = await loadResolver();

    // Under an ilike match "axb@example.com" would collide with "a_b@…".
    const result = await resolveIdentity({
      source: "loop",
      eventName: "subscription.paused",
      payload: { email: "axb@example.com" },
    });

    expect(result.customerId).not.toBe("6000000000003");
    expect(
      supabase.state.rpcCalls.some((call) => call.name === "event_backbone_find_customer_by_email"),
    ).toBe(true);
  });
});

describe("the rest of the ladder", () => {
  it("mints a synthetic id above the base when no Shopify id is present", async () => {
    const { resolveIdentity } = await loadResolver();

    const result = await resolveIdentity({
      source: "loop",
      eventName: "subscription.renewed",
      payload: { email: "nobody@example.com" },
    });

    expect(result.resolution).toBe("created");
    expect(BigInt(result.customerId as string)).toBeGreaterThanOrEqual(BigInt("9000000000000000"));
  });

  it("resolves by firebase uid before falling through to email", async () => {
    supabase.state.tables.customers.push({
      id: 6000000000004,
      email: "uid@example.com",
      firebase_uid: "fixture-uid",
    });
    const { resolveIdentity } = await loadResolver();

    const result = await resolveIdentity({
      source: "loop",
      eventName: "subscription.skipped",
      payload: { firebase_uid: "fixture-uid" },
    });

    expect(result.resolution).toBe("resolved");
    expect(result.detail).toBe("firebase_uid");
  });

  it("fails loudly, never silently, when there is no identifier at all", async () => {
    const { resolveIdentity } = await loadResolver();

    const result = await resolveIdentity({
      source: "loop",
      eventName: "subscription.expired",
      payload: { note: "nothing useful here" },
    });

    expect(result.resolution).toBe("unresolvable");
    expect(result.customerId).toBeNull();
    expect(supabase.state.tables.customers).toHaveLength(0);
    expect(
      supabase.state.tables.backbone_alert.some((alert) => alert.kind === "unresolvable_event"),
    ).toBe(true);
  });
});
