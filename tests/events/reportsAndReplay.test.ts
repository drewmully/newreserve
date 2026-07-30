/**
 * Coverage verdicts and replay refusal.
 *
 * REGISTERED_BUT_SILENT is the verdict this whole build exists to surface: the
 * subscription exists, so everything looks wired, and nothing has ever arrived.
 * If that verdict is computed wrongly the report is worse than useless, so it
 * is asserted directly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase } from "./fakeSupabase";

let supabase: ReturnType<typeof createFakeSupabase>;

vi.mock("@/app/api/_lib/supabaseService", () => ({
  getSupabaseService: () => supabase.client,
}));

vi.mock("@/app/api/_lib/adminAuth", () => ({
  requireAdmin: async () => ({ ok: true, email: "admin@example.com", uid: "test-admin" }),
}));

beforeEach(() => {
  supabase = createFakeSupabase();
});

describe("coverage verdicts", () => {
  it("brands a registered topic that has never delivered REGISTERED_BUT_SILENT", async () => {
    vi.resetModules();
    const { computeVerdict } = await import("@/app/api/admin/events/coverage/route");
    expect(computeVerdict({ registered: true, count30d: 0, resolvedPct: 0 })).toBe(
      "REGISTERED_BUT_SILENT",
    );
  });

  it("calls a healthy stream LIVE and an unregistered silent one DEAD", async () => {
    vi.resetModules();
    const { computeVerdict } = await import("@/app/api/admin/events/coverage/route");
    expect(computeVerdict({ registered: true, count30d: 40, resolvedPct: 97.5 })).toBe("LIVE");
    expect(computeVerdict({ registered: false, count30d: 0, resolvedPct: 0 })).toBe("DEAD");
  });

  it("does not brand Loop events DEAD just because they cannot be registered", async () => {
    vi.resetModules();
    const { computeVerdict } = await import("@/app/api/admin/events/coverage/route");
    // registered === null is Loop and Resend: judge them on receipts alone.
    expect(computeVerdict({ registered: null, count30d: 12, resolvedPct: 100 })).toBe("LIVE");
  });

  it("flags a stream that arrives but never resolves", async () => {
    vi.resetModules();
    const { computeVerdict } = await import("@/app/api/admin/events/coverage/route");
    expect(computeVerdict({ registered: true, count30d: 30, resolvedPct: 0 })).toBe(
      "ARRIVING_UNRESOLVED",
    );
  });
});

describe("replay", () => {
  async function loadReplay() {
    vi.resetModules();
    return import("@/app/api/admin/events/replay/route");
  }

  function replayRequest(body: unknown) {
    return new NextRequest("http://localhost/api/admin/events/replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("refuses a row whose payload the retention cron already purged", async () => {
    supabase.state.tables.inbound_event.push({
      id: 1,
      source: "shopify",
      event_name: "order.paid",
      payload: null,
      payload_purged_at: "2026-01-01T00:00:00.000Z",
      received_at: "2025-10-01T00:00:00.000Z",
      resolution: "resolved",
      attempts: 1,
    });

    const { POST } = await loadReplay();
    const response = await POST(replayRequest({ id: 1 }));

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      replayed: number;
      skipped: number;
      outcomes: { status: string; reason?: string }[];
    };
    expect(json.replayed).toBe(0);
    expect(json.skipped).toBe(1);
    expect(json.outcomes[0].status).toBe("skipped");
    expect(json.outcomes[0].reason).toContain("purged");
  });

  it("re-resolves a row that still has its payload", async () => {
    supabase.state.tables.inbound_event.push({
      id: 2,
      source: "shopify",
      event_name: "order.paid",
      payload: { customer: { id: 7100000000500, email: "replay@example.com" } },
      payload_purged_at: null,
      received_at: "2026-07-01T00:00:00.000Z",
      resolution: "pending",
      attempts: 1,
    });

    const { POST } = await loadReplay();
    const response = await POST(replayRequest({ id: 2 }));
    const json = (await response.json()) as { replayed: number; outcomes: { resolution: string }[] };

    expect(json.replayed).toBe(1);
    expect(["resolved", "created", "linked"]).toContain(json.outcomes[0].resolution);
    expect(supabase.state.tables.inbound_event[0].resolution).not.toBe("pending");
  });

  it("rejects an event_name that is not in the catalog", async () => {
    const { POST } = await loadReplay();
    const response = await POST(replayRequest({ event_name: "order.teleported" }));
    expect(response.status).toBe(400);
  });
});
