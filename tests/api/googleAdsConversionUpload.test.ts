import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/_lib/googleAuth", () => ({
  mintGoogleAccessToken: vi.fn(async () => "test-token"),
}));

import {
  __resetUploadActionCacheForTests,
  buildClickConversion,
  formatConversionDateTime,
  uploadPurchaseConversion,
} from "@/app/api/_lib/googleAdsConversionUpload";

const ACTION = "customers/4335795219/conversionActions/777";

function setEnv() {
  process.env.GOOGLE_ADS_CUSTOMER_ID = "433-579-5219";
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "9552995078";
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
  process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64 = "e30=";
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("formatConversionDateTime", () => {
  it("formats unix seconds as UTC in the Ads API format", () => {
    expect(formatConversionDateTime(Date.UTC(2026, 9, 12, 3, 4, 5) / 1000)).toBe(
      "2026-10-12 03:04:05+00:00"
    );
  });
});

describe("buildClickConversion", () => {
  it("returns null without a click id", () => {
    expect(buildClickConversion({ value: 198 }, ACTION)).toBeNull();
  });

  it("sends exactly one click id, preferring gclid", () => {
    const c = buildClickConversion({ gclid: "G", gbraid: "B", wbraid: "W", value: 198 }, ACTION, 0)!;
    expect(c.gclid).toBe("G");
    expect(c).not.toHaveProperty("gbraid");
    expect(c).not.toHaveProperty("wbraid");
  });

  it("uses wbraid for iOS web clicks and carries real value and order id", () => {
    const c = buildClickConversion(
      { wbraid: "W", value: 198, currency: "USD", orderId: "63093", timestamp: 0 },
      ACTION
    )!;
    expect(c).toMatchObject({
      conversionAction: ACTION,
      wbraid: "W",
      conversionValue: 198,
      currencyCode: "USD",
      orderId: "63093",
      conversionDateTime: "1970-01-01 00:00:00+00:00",
    });
  });
});

describe("uploadPurchaseConversion", () => {
  beforeEach(() => {
    __resetUploadActionCacheForTests();
    setEnv();
  });

  it("skips the network when there is no click id", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await uploadPurchaseConversion({ value: 50 });
    expect(r).toEqual({ ok: false, reason: "no_click_id" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the explicit action id and uploads to the stripped customer id", async () => {
    process.env.GOOGLE_ADS_PURCHASE_UPLOAD_ACTION_ID = "777";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ results: [{}] }));
    const r = await uploadPurchaseConversion({ gclid: "G", value: 198, orderId: "1" });
    expect(r).toEqual({ ok: true, conversionAction: ACTION });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(
      "https://googleads.googleapis.com/v25/customers/4335795219:uploadClickConversions"
    );
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.partialFailure).toBe(true);
    expect(body.conversions[0]).toMatchObject({ conversionAction: ACTION, gclid: "G", conversionValue: 198 });
    expect((init as RequestInit).headers).toMatchObject({ "login-customer-id": "9552995078" });
  });

  it("looks up the UPLOAD_CLICKS action by name when no id is configured", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ results: [{ conversionAction: { resourceName: ACTION } }] }))
      .mockResolvedValueOnce(jsonResponse({ results: [{}] }));
    const r = await uploadPurchaseConversion({ wbraid: "W", value: 95 });
    expect(r.ok).toBe(true);
    const query = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)).query;
    expect(query).toContain("conversion_action.type = 'UPLOAD_CLICKS'");
    expect(query).toContain("Mully Purchase (server upload)");
  });

  it("reports no_upload_action when the import action does not exist yet", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ results: [] }));
    const r = await uploadPurchaseConversion({ gclid: "G", value: 95 });
    expect(r).toEqual({ ok: false, reason: "no_upload_action" });
  });

  it("treats a partial failure as not ok so the caller falls back", async () => {
    process.env.GOOGLE_ADS_PURCHASE_UPLOAD_ACTION_ID = "777";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({ partialFailureError: { message: "The click is too old" } })
    );
    const r = await uploadPurchaseConversion({ gclid: "G", value: 95 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("too old");
  });

  it("never throws on transport errors", async () => {
    process.env.GOOGLE_ADS_PURCHASE_UPLOAD_ACTION_ID = "777";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(uploadPurchaseConversion({ gclid: "G" })).resolves.toEqual({
      ok: false,
      reason: "ECONNRESET",
    });
  });
});
