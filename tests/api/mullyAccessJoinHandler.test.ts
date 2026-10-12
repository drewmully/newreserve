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
const suggested = (shipping: string) => ({ order: {
  totalReceivedSet: { shopMoney: { amount: "200.00" } },
  suggestedRefund: { shipping: { amountSet: { shopMoney: { amount: shipping } } },
    suggestedTransactions: [{ gateway: "shopify_payments", parentTransaction: { id: "gid://shopify/OrderTransaction/9" }, amountSet: { shopMoney: { amount: "0" } } }] },
} });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue(undefined);
  mocks.send.mockResolvedValue(undefined);
});

describe("Mully Access paid order", () => {
  it("tags the customer and refunds 10% plus shipping on the join order", async () => {
    mocks.graphql
      .mockResolvedValueOnce({ tagsAdd: { userErrors: [] } })
      .mockResolvedValueOnce(suggested("8.00"))
      .mockResolvedValueOnce({ refundCreate: { refund: { id: "gid://shopify/Refund/1" }, userErrors: [] } })
      .mockResolvedValueOnce({ tagsAdd: { userErrors: [] } });
    await handleMullyAccessPaidOrder(order([[50477797081280, "15.00"], [1, "185.00"]]));
    expect(mocks.graphql.mock.calls[0][1]).toEqual({ id: "gid://shopify/Customer/5", tags: ["mully-access"] });
    const input = mocks.graphql.mock.calls[2][1].input;
    expect(input.transactions[0]).toMatchObject({ amount: "26.50", kind: "REFUND", parentId: "gid://shopify/OrderTransaction/9" });
    expect(input.shipping).toEqual({ fullRefund: true });
    expect(input.notify).toBe(true);
  });

  it("does not refund twice for the same order", async () => {
    mocks.create.mockRejectedValue(new Error("exists"));
    mocks.graphql.mockResolvedValueOnce({ tagsAdd: { userErrors: [] } });
    await handleMullyAccessPaidOrder(order([[50477797081280, "15.00"], [1, "185.00"]]));
    expect(mocks.graphql).toHaveBeenCalledTimes(1);
  });

  it("leaves Reserve members untagged and unrefunded", async () => {
    await handleMullyAccessPaidOrder(order([[50477797081280, "15.00"], [1, "185.00"]]), { priorTier: "member" });
    expect(mocks.graphql).not.toHaveBeenCalled();
  });

  it("emails the team when the refund fails", async () => {
    mocks.graphql.mockResolvedValueOnce({ tagsAdd: { userErrors: [] } }).mockRejectedValueOnce(new Error("scope"));
    await handleMullyAccessPaidOrder(order([[50477797081280, "15.00"], [1, "100.00"]]));
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: "drew@mullybox.com" }));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });
});
