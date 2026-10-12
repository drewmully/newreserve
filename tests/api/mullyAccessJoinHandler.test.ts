import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ graphql: vi.fn(), create: vi.fn(), update: vi.fn(), send: vi.fn() }));
vi.mock("@/app/api/_lib/shopifyAdmin", () => ({ shopifyGraphQL: mocks.graphql }));
vi.mock("@/lib/email/resend", () => ({ sendPlainText: mocks.send }));
vi.mock("@/lib/firebase-admin", () => ({
  adminDb: { collection: () => ({ doc: () => ({ create: mocks.create, update: mocks.update }) }) },
}));
import { handleMullyAccessPaidOrder } from "@/app/api/_lib/mullyAccessJoin";

const order = (lines: Array<[number, string, string?]>) => ({
  id: 77, name: "#1077", email: "buyer@example.com", currency: "USD", customer: { id: 5 },
  line_items: lines.map(([variant_id, price, total_discount = "0"]) => ({
    variant_id, price, quantity: 1, total_discount, requires_shipping: variant_id !== 50477797081280,
  })),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue(undefined);
  mocks.send.mockResolvedValue(undefined);
});

describe("Mully Access paid order", () => {
  it("tags the customer and never issues a refund", async () => {
    mocks.graphql.mockResolvedValueOnce({ tagsAdd: { userErrors: [] } });
    await handleMullyAccessPaidOrder(order([[50477797081280, "15.00"], [1, "185.00"]]));
    expect(mocks.graphql).toHaveBeenCalledTimes(1);
    expect(mocks.graphql.mock.calls[0][1]).toEqual({ id: "gid://shopify/Customer/5", tags: ["mully-access"] });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("leaves Reserve members untagged and unrefunded", async () => {
    await handleMullyAccessPaidOrder(order([[50477797081280, "15.00"], [1, "185.00"]]), { priorTier: "member" });
    expect(mocks.graphql).not.toHaveBeenCalled();
  });

});
