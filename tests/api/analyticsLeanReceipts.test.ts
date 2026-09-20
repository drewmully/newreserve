import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { acceptShopifyReceipt } from "@/lib/analytics/receipts";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role service_role");
  await db.exec(readFileSync("sql/analytics/001_staging.sql", "utf8"));
  await db.exec(readFileSync("sql/analytics/003_receipts.sql", "utf8"));
}, 30000);
afterAll(async () => { await db.close(); });
const body = Buffer.from('{"id":123,"total_price":"10.00"}');
const input = {
  body, signature: createHmac("sha256", "test-secret").update(body).digest("base64"),
  secret: "test-secret", deliveryId: "delivery-1", topic: "orders/paid",
  shop: "fixture.myshopify.com", allowedShop: "fixture.myshopify.com",
};
describe("durable analytics-only receipt", () => {
  it.each([
    { signature: "bad" }, { shop: "attacker.myshopify.com" },
    { topic: "unknown" }, { secret: "" }, { body: Buffer.from("{}") },
  ])("rejects invalid envelope/signature without any write %j", async override => {
    const store = vi.fn();
    await expect(acceptShopifyReceipt({ ...input, ...override }, store)).rejects.toThrow();
    expect(store).not.toHaveBeenCalled();
  });
  const call = (hash = "a".repeat(64)) => db.query(
    "select public.lean_accept_receipt($1,$2,$3,$4,$5,$6)",
    ["shopify", "delivery-1", "order-1", "orders/paid", hash, { id: "order-1" }],
  );
  it("atomically creates one receipt and one work intent, including duplicate calls", async () => {
    await Promise.all([call(), call(), call()]);
    expect((await db.query("select * from lean_private.receipts")).rows).toHaveLength(1);
    expect((await db.query("select * from lean_private.work")).rows).toHaveLength(1);
  });
  it("rejects a reused delivery id with a changed payload without changing stored work", async () => {
    await expect(call("b".repeat(64))).rejects.toThrow("delivery collision");
    expect((await db.query("select * from lean_private.work")).rows).toHaveLength(1);
  });
  it("rolls back receipt and intent together if the surrounding transaction fails", async () => {
    await db.exec("begin");
    await db.query("select public.lean_accept_receipt($1,$2,$3,$4,$5,$6)", ["shopify", "crash", "order-2", "orders/paid", "a".repeat(64), {}]);
    await db.exec("rollback");
    expect((await db.query("select * from lean_private.receipts where delivery_id='crash'")).rows).toHaveLength(0);
  });
  it("acknowledges only after storage resolves and preserves business key separately", async () => {
    const store = vi.fn(async () => "5");
    expect(await acceptShopifyReceipt(input, store)).toBe("5");
    expect(store.mock.calls[0]).toBeDefined();
    await expect(acceptShopifyReceipt(input, async () => { throw new Error("db"); })).rejects.toThrow("db");
  });
});
