import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn());
const range = vi.hoisted(() => vi.fn());
const query = vi.hoisted(() => {
  const q: Record<string, unknown> = {};
  for (const key of ["select", "eq", "in", "gte", "order"]) q[key] = vi.fn(() => q);
  q.range = range;
  return q;
});
vi.mock("@/lib/klaviyo/worker", () => ({ isCronAuthorized: auth }));
vi.mock("@/app/api/_lib/supabaseService", () => ({ getSupabaseService: () => ({ from: () => query }) }));
import { GET } from "@/app/api/admin/cron/klaviyo-order-audit/route";

describe("read-only order audit route", () => {
  beforeEach(() => {
    auth.mockReturnValue(true);
    range.mockReset().mockResolvedValue({ data: [], error: null });
  });
  it("requires authorization before reading", async () => {
    auth.mockReturnValue(false);
    expect((await GET(new Request("http://x/"))).status).toBe(401);
    expect(range).not.toHaveBeenCalled();
  });
  it("returns aggregate coverage and holds, never customer data", async () => {
    range.mockResolvedValue({ data: [{ event_name: "order.paid", payload: { id: 1, email: "do-not-output@example.com" } }], error: null });
    const body = await (await GET(new Request("http://x/"))).json();
    expect(body).toMatchObject({ ok: true, dry: true, dispatch_eligible: false, coverage: { "order.paid": 1 } });
    expect(JSON.stringify(body)).not.toContain("do-not-output");
    expect(body.holds).toContain("human_launch_approval");
  });
  it("fails closed on read errors", async () => {
    range.mockResolvedValue({ data: null, error: { message: "private query detail" } });
    const res = await GET(new Request("http://x/"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "audit_read_failed" });
  });
});
