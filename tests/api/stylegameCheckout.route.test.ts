import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captureStylegameEventMock = vi.fn();

vi.mock("@/lib/stylegame/analytics", () => ({
  captureStylegameEvent: captureStylegameEventMock,
}));

const CHECKOUT_URL = "https://fixture-shop.myshopify.com/checkouts/cart-1";
const DEFAULT_VARIANT_GID = "gid://shopify/ProductVariant/47601025122496";

function request(
  query: Record<string, string>,
  headers: Record<string, string> = {}
) {
  const url = new URL("http://localhost/api/stylegame/checkout");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return new NextRequest(url, { headers });
}

function storefrontResponse() {
  return new Response(
    JSON.stringify({
      data: {
        cartCreate: {
          cart: { checkoutUrl: CHECKOUT_URL },
          userErrors: [],
        },
      },
    })
  );
}

function cartInput() {
  const [, init] = vi.mocked(fetch).mock.calls.at(-1)!;
  return JSON.parse(String(init?.body)).variables as {
    attributes: Array<{ key: string; value: string }>;
    lines: Array<{
      merchandiseId: string;
      quantity: number;
      sellingPlanId: string;
    }>;
  };
}

function attributesByKey() {
  return Object.fromEntries(cartInput().attributes.map(({ key, value }) => [key, value]));
}

describe("GET /api/stylegame/checkout context", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = "fixture-shop.myshopify.com";
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN = "fixture-storefront-token";
    process.env.SHOPIFY_STYLEGAME_SELLING_PLAN_ID = "987654";
    process.env.SHOPIFY_WEBHOOK_SECRET = "fixture-webhook-secret";
    delete process.env.SHOPIFY_STYLEGAME_VARIANT_ID;
    captureStylegameEventMock.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(storefrontResponse));
  });

  it.each([
    {
      anon: "anon-browser-a",
      session: "sgs-session-a",
      query: { utm_source: "newsletter", utm_campaign: "fall-a" },
    },
    {
      anon: "anon-browser-b",
      session: "sgs-session-b",
      query: {},
    },
  ] satisfies Array<{
    anon: string;
    session: string;
    query: Record<string, string>;
  }>)("keeps journey context separate without changing cart terms", async (journey) => {
    const { GET } = await import("@/app/api/stylegame/checkout/route");
    const query: Record<string, string> = {
      profile: "quiet-luxury",
      name: "Quiet Luxury",
      stylegame_session_id: journey.session,
    };
    for (const [key, value] of Object.entries(journey.query)) {
      if (value !== undefined) query[key] = value;
    }
    const response = await GET(
      request(
        query,
        { cookie: `mully_anon_id=${journey.anon}` }
      )
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(CHECKOUT_URL);
    expect(attributesByKey()).toEqual(
      expect.objectContaining({
        stylegame_context_version: "1",
        stylegame_identity_source: "first_party_cookie",
        stylegame_context_signature: expect.stringMatching(/^[a-f0-9]{64}$/),
        mully_anon_id: journey.anon,
        stylegame_session_id: journey.session,
        ...journey.query,
      })
    );
    expect(cartInput().lines).toEqual([
      expect.objectContaining({
        merchandiseId: DEFAULT_VARIANT_GID,
        quantity: 1,
        sellingPlanId: "gid://shopify/SellingPlan/987654",
      }),
    ]);
    expect(captureStylegameEventMock).toHaveBeenCalledWith(
      "sg_checkout_start",
      journey.anon,
      expect.objectContaining({ session_id: journey.session })
    );
  });

  it("does not trust query identity when the first-party cookie is missing", async () => {
    const { GET } = await import("@/app/api/stylegame/checkout/route");
    await GET(
      request({
        profile: "direct",
        mully_anon_id: "anon-someone-else",
        stylegame_context_version: "999",
      })
    );

    const attributes = attributesByKey();
    expect(attributes.stylegame_context_version).toBe("1");
    expect(attributes.mully_anon_id).toBeUndefined();
    expect(attributes.stylegame_identity_source).toBeUndefined();
    expect(captureStylegameEventMock).toHaveBeenCalledWith(
      "sg_checkout_start",
      null,
      expect.any(Object)
    );
  });

  it("omits browser, session, and attribution context for a privacy-denied request", async () => {
    const { GET } = await import("@/app/api/stylegame/checkout/route");
    await GET(
      request(
        {
          mully_anon_id: "anon-query",
          stylegame_session_id: "sgs-private",
          utm_source: "paid-social",
        },
        {
          cookie: "mully_anon_id=anon-cookie",
          "sec-gpc": "1",
        }
      )
    );

    expect(attributesByKey()).toEqual(
      expect.not.objectContaining({
        mully_anon_id: expect.anything(),
        stylegame_session_id: expect.anything(),
        utm_source: expect.anything(),
      })
    );
    expect(cartInput().lines[0]).toEqual(
      expect.objectContaining({
        merchandiseId: DEFAULT_VARIANT_GID,
        quantity: 1,
        sellingPlanId: "gid://shopify/SellingPlan/987654",
      })
    );
  });

  it("bounds untrusted attribution and session values", async () => {
    const { GET } = await import("@/app/api/stylegame/checkout/route");
    await GET(
      request(
        {
          stylegame_session_id: "invalid session with spaces",
          utm_campaign: `campaign\u0000-${"x".repeat(200)}`,
        },
        { cookie: "mully_anon_id=anon-owner" }
      )
    );

    const attributes = attributesByKey();
    expect(attributes.stylegame_session_id).toBeUndefined();
    expect(attributes.utm_campaign).not.toContain("\u0000");
    expect(attributes.utm_campaign).toHaveLength(128);
  });
});
