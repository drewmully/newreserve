import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CountReply = number | null | "error" | "invalid";

let paid: CountReply;
let pending: CountReply;
const fetchMock = vi.fn();

function countResponse(value: CountReply) {
  if (value === "error") {
    // HEAD errors have no response body, reproducing the original blank error.
    return new Response(null, { status: 400 });
  }
  return new Response(null, {
    status: 200,
    headers:
      value === null
        ? {}
        : { "content-range": `0-0/${value === "invalid" ? "NaN" : value}` },
  });
}

function request(body: Record<string, unknown> = {}, authorized = true) {
  return new Request("https://app.example/api/reserve/reserve-by-reply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorized ? { authorization: "Bearer test-cron-secret" } : {}),
    },
    body: JSON.stringify({ email: "member@example.com", ...body }),
  });
}

function requests() {
  return fetchMock.mock.calls.map(([input, init]) => ({
    url: new URL(String(input)),
    method: (init as RequestInit).method,
  }));
}

function expectCorrectPaidFilter() {
  const paidRequest = requests().find(
    ({ url, method }) =>
      method === "HEAD" && url.pathname === "/rest/v1/subscribers",
  );
  expect(paidRequest).toBeDefined();
  expect(paidRequest!.url.searchParams.get("plan_code")).toBe("eq.reserve_access");
  expect(paidRequest!.url.searchParams.has("plan_type")).toBe(false);
  expect(paidRequest!.url.searchParams.get("status")).toBe("eq.active");
  expect(paidRequest!.url.searchParams.get("acquired_at")).toBe(
    "gte.2026-05-11T00:00:00Z",
  );
  expect(paidRequest!.url.searchParams.get("select")).toBe("id");
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("SUPABASE_URL", "https://database.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-test-key");
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  vi.stubEnv("FOUNDERS_CAMPAIGN_ID", "reserve_founders_v1");
  vi.stubEnv("FOUNDERS_CAMPAIGN_START", "2026-05-11T00:00:00Z");
  vi.stubEnv("FOUNDERS_TOTAL_SPOTS", "300");
  vi.stubEnv("FOUNDERS_COUNTER_BASELINE_CLAIMED", "53");
  vi.stubEnv("FOUNDERS_RESERVATION_HOLD_HOURS", "48");
  vi.stubEnv("FOUNDERS_SHIP_DATE", "2026-05-27");
  vi.spyOn(console, "error").mockImplementation(() => {});
  paid = 22;
  pending = 3;
  fetchMock.mockReset().mockImplementation(async (input, init: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== "database.example") {
      throw new Error("Unexpected network destination");
    }
    if (init.method === "HEAD") {
      if (url.pathname === "/rest/v1/subscribers") {
        // Treat the original nonexistent-column query like the actual provider.
        return countResponse(
          url.searchParams.has("plan_type") ? "error" : paid,
        );
      }
      if (url.pathname === "/rest/v1/customer_facts") {
        return countResponse(pending);
      }
    }
    if (init.method === "GET" && url.pathname === "/rest/v1/customers") {
      return Response.json([
        { id: 123, email: "member@example.com", first_name: "Test" },
      ]);
    }
    if (init.method === "GET" && url.pathname === "/rest/v1/customer_facts") {
      return Response.json([]);
    }
    if (init.method === "POST" && url.pathname === "/rest/v1/customer_facts") {
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected request: ${init.method} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Founders public counter", () => {
  it("counts the real plan_code and preserves the existing formula and cache", async () => {
    const { GET } = await import("@/app/api/reserve/spots-remaining/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      campaign_id: "reserve_founders_v1",
      baseline: 53,
      total_spots: 300,
      paid: 22,
      pending: 3,
      remaining: 222,
      campaign_start: "2026-05-11T00:00:00Z",
    });
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=10, s-maxage=30, stale-while-revalidate=60",
    );
    expectCorrectPaidFilter();
    expect(requests().every(({ method }) => method === "HEAD")).toBe(true);
  });

  it("accepts genuine zero counts", async () => {
    paid = 0;
    pending = 0;
    const { GET } = await import("@/app/api/reserve/spots-remaining/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      paid: 0,
      pending: 0,
      remaining: 247,
    });
  });

  it("does not fabricate availability when the server key is missing", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { GET } = await import("@/app/api/reserve/spots-remaining/route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "availability_unavailable",
      paid: null,
      pending: null,
      remaining: null,
      degraded: true,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["paid", "error"],
    ["pending", "error"],
    ["paid", null],
    ["pending", null],
    ["paid", "invalid"],
    ["pending", -1],
  ] as const)("returns unavailable for %s count %s", async (which, value) => {
    if (which === "paid") paid = value;
    else pending = value;
    const { GET } = await import("@/app/api/reserve/spots-remaining/route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      error: "availability_unavailable",
      paid: null,
      pending: null,
      remaining: null,
      degraded: true,
    });
  });
});

describe("Founders reservation availability gate", () => {
  it("uses plan_code and preserves the successful reservation flow", async () => {
    const { POST } = await import("@/app/api/reserve/reserve-by-reply/route");
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      remaining_before: 222,
      remaining_after: 221,
      hold_hours: 48,
      campaign_id: "reserve_founders_v1",
    });
    expectCorrectPaidFilter();
    expect(requests().filter(({ method }) => method === "POST")).toHaveLength(1);
  });

  it("accepts genuine zero counts rather than rejecting a valid empty population", async () => {
    paid = 0;
    pending = 0;
    const { POST } = await import("@/app/api/reserve/reserve-by-reply/route");
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      remaining_before: 247,
      remaining_after: 246,
    });
  });

  it.each([
    ["paid", "error"],
    ["pending", "error"],
    ["paid", null],
    ["pending", null],
    ["paid", -1],
    ["pending", "invalid"],
  ] as const)("stops before lookups or writes for %s count %s", async (which, value) => {
    if (which === "paid") paid = value;
    else pending = value;
    const { POST } = await import("@/app/api/reserve/reserve-by-reply/route");
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "availability_unavailable" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requests()).toHaveLength(2);
    expect(requests().every(({ method }) => method === "HEAD")).toBe(true);
  });

  it("retains sold-out rejection without looking up or writing a customer", async () => {
    paid = 247;
    pending = 0;
    const { POST } = await import("@/app/api/reserve/reserve-by-reply/route");
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "no_spots_remaining",
      remaining: 0,
    });
    expect(requests().every(({ method }) => method === "HEAD")).toBe(true);
  });

  it("preserves the existing authenticated administrative override", async () => {
    paid = "error";
    pending = "error";
    const { POST } = await import("@/app/api/reserve/reserve-by-reply/route");
    const response = await POST(request({ skip_spot_check: true }));
    expect(response.status).toBe(200);
    expect(requests().some(({ method }) => method === "HEAD")).toBe(false);
    expect(requests().filter(({ method }) => method === "POST")).toHaveLength(1);
  });

  it("does not allow an unauthenticated caller to use the override", async () => {
    const { POST } = await import("@/app/api/reserve/reserve-by-reply/route");
    const response = await POST(request({ skip_spot_check: true }, false));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
