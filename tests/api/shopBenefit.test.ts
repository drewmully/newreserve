import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), getUser: vi.fn(), graphql: vi.fn() }));
vi.mock("@/app/api/_lib/loopUserContext", () => ({ verifyFirebaseBearer: mocks.verify }));
vi.mock("@/lib/firebase-admin", () => ({ adminAuth: { getUser: mocks.getUser } }));
vi.mock("@/app/api/_lib/shopifyAdmin", () => ({ shopifyGraphQL: mocks.graphql }));
import { GET } from "@/app/api/shop/member-benefit/route";
const request = () => new NextRequest("https://www.mymully.com/api/shop/member-benefit?email=someoneelse@example.com");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue("verified-uid");
  mocks.getUser.mockResolvedValue({ email: "buyer@example.com", emailVerified: true });
});
describe("active subscription shop benefit", () => {
  it.each([true, false])("uses the same Shopify segment as checkout, membership %s", async eligible => {
    mocks.graphql.mockResolvedValueOnce({ customers: { nodes: [{ id: "gid://shopify/Customer/1", email: "buyer@example.com" }] } })
      .mockResolvedValueOnce({ customerSegmentMembership: { memberships: [{ segmentId: "gid://shopify/Segment/552166457536", isMember: eligible }] } });
    const response = await GET(request());
    expect(await response.json()).toEqual({ eligible });
    expect(mocks.graphql.mock.calls[0][1].query).toBe('email:"buyer@example.com"');
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("rejects unauthenticated requests", async () => {
    mocks.verify.mockRejectedValue(new Error());
    expect((await GET(request())).status).toBe(401);
    expect(mocks.graphql).not.toHaveBeenCalled();
  });
  it("never grants from a similarly matching email", async () => {
    mocks.graphql.mockResolvedValueOnce({ customers: { nodes: [{ id: "1", email: "other@example.com" }] } });
    expect(await (await GET(request())).json()).toEqual({ eligible: false });
    expect(mocks.graphql).toHaveBeenCalledTimes(1);
  });
  it("requires a verified identity", async () => {
    mocks.getUser.mockResolvedValue({ email: "buyer@example.com", emailVerified: false });
    expect(await (await GET(request())).json()).toEqual({ eligible: false });
    expect(mocks.graphql).not.toHaveBeenCalled();
  });
  it("fails closed if the source of truth is unavailable", async () => {
    mocks.graphql.mockRejectedValue(new Error());
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ eligible: false });
  });
});
