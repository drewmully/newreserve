/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const afterCallbacks: Array<() => Promise<void>> = [];
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (cb: () => Promise<void>) => { afterCallbacks.push(cb); },
}));
vi.mock("@/lib/events/alert", () => ({ raiseAlert: vi.fn(async () => undefined) }));

const docs = new Map<string, Record<string, unknown>>();
vi.mock("@/lib/firebase-admin", () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        id,
        get: async () => ({ exists: docs.has(`${name}/${id}`), data: () => docs.get(`${name}/${id}`) }),
        set: async (data: Record<string, unknown>) => {
          docs.set(`${name}/${id}`, { ...(docs.get(`${name}/${id}`) ?? {}), ...data });
        },
      }),
    }),
  },
}));

beforeEach(() => {
  afterCallbacks.length = 0;
  docs.clear();
  process.env.KLAVIYO_PRIVATE_API_KEY = "pk_test";
  process.env.KLAVIYO_SYNC_ENABLED = "true";
});

function post(body: unknown) {
  return new Request("https://www.mymully.com/api/back-in-stock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("route hooks", () => {
  it("back-in-stock stores the request, responds unchanged, and a Klaviyo outage never fails it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const { POST } = await import("@/app/api/back-in-stock/route");
    const res = await POST(post({ email: "Drew+synctest3@mullybox.com", productSlug: "polo", variantId: "v1", size: "L" }) as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect([...docs.keys()][0]).toMatch(/^back_in_stock_requests\//);
    const saved = [...docs.values()][0];
    expect(saved).toMatchObject({ email: "drew+synctest3@mullybox.com", productSlug: "polo", sendingStatus: "not_synced" });
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(([...docs.values()][0] as any).sendingStatus).toBe("failed");
    vi.unstubAllGlobals();
  }, 20_000);

  it("flag off: request still stored as not_synced, no after() work", async () => {
    process.env.KLAVIYO_SYNC_ENABLED = "false";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/back-in-stock/route");
    const res = await POST(post({ email: "drew+synctest3@mullybox.com", productSlug: "polo" }) as any);
    expect(res.status).toBe(200);
    expect(afterCallbacks).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(([...docs.values()][0] as any).sendingStatus).toBe("not_synced");
    vi.unstubAllGlobals();
  });
});
