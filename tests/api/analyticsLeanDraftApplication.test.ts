import { expect, it, vi } from "vitest";
import { POST } from "@/app/api/shopify/checkout/route";

it("retires draft checkout without creating a discounted draft or trusting a tier", async () => {
  const transport = vi.spyOn(globalThis, "fetch");
  const response = await POST();
  expect(response.status).toBe(410);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(transport).not.toHaveBeenCalled();
  transport.mockRestore();
});
