import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ graphql: vi.fn(), plan: vi.fn() }));
vi.mock("@/app/api/_lib/shopifyAdmin", () => ({ shopifyGraphQL: mocks.graphql }));
vi.mock("@/lib/shopify", () => ({ getFirstSellingPlanId: mocks.plan }));
import { signHs256, verifyHs256 } from "@/lib/postPurchase/jwt";
import { POST as offer } from "@/app/api/post-purchase/offer/route";
import { POST as sign } from "@/app/api/post-purchase/sign-changeset/route";

const SECRET = "test-secret";
const shopifyToken = (referenceId = "ref-1") =>
  signHs256({ input_data: { initialPurchase: { referenceId, customerId: 42 } } }, SECRET);
const req = (path: string, token: string, referenceId = "ref-1") =>
  new NextRequest(`https://www.mymully.com${path}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ referenceId }) });
const notMember = { customerSegmentMembership: { memberships: [{ isMember: false }, { isMember: false }] } };

beforeEach(() => {
  vi.resetAllMocks();
  process.env.SHOPIFY_INTERNAL_EXT_API_KEY = "client-id";
  process.env.SHOPIFY_INTERNAL_EXT_API_SECRET = SECRET;
  mocks.plan.mockResolvedValue("gid://shopify/SellingPlan/6673596608");
});

describe("Mully Access post-purchase offer", () => {
  it("offers first month free to non-members", async () => {
    mocks.graphql.mockResolvedValue(notMember);
    const body = await (await offer(req("/api/post-purchase/offer", shopifyToken()))).json();
    expect(body.render).toBe(true);
    expect(body.offer.changes[0]).toMatchObject({ type: "add_subscription", variantID: 50477797081280, sellingPlanId: 6673596608, discount: { value: 100 } });
    expect(mocks.graphql.mock.calls[0][1].customer).toBe("gid://shopify/Customer/42");
  });
  it("hides the offer from existing members", async () => {
    mocks.graphql.mockResolvedValue({ customerSegmentMembership: { memberships: [{ isMember: true }, { isMember: false }] } });
    expect((await (await offer(req("/api/post-purchase/offer", shopifyToken()))).json()).render).toBe(false);
  });
  it("hides the offer when no selling plan exists", async () => {
    mocks.graphql.mockResolvedValue(notMember);
    mocks.plan.mockResolvedValue(null);
    expect((await (await offer(req("/api/post-purchase/offer", shopifyToken()))).json()).render).toBe(false);
  });
  it("rejects forged tokens and mismatched purchases", async () => {
    const forged = signHs256({ input_data: { initialPurchase: { referenceId: "ref-1" } } }, "wrong");
    expect((await offer(req("/api/post-purchase/offer", forged))).status).toBe(401);
    expect((await sign(req("/api/post-purchase/sign-changeset", shopifyToken("other"), "ref-1"))).status).toBe(401);
  });
  it("signs the server-built changeset", async () => {
    mocks.graphql.mockResolvedValue(notMember);
    const { token } = await (await sign(req("/api/post-purchase/sign-changeset", shopifyToken()))).json();
    const claims = verifyHs256<{ iss: string; sub: string; changes: { type: string }[] }>(token, SECRET);
    expect(claims).toMatchObject({ iss: "client-id", sub: "ref-1" });
    expect(claims.changes[0].type).toBe("add_subscription");
  });
});
