import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/_lib/googleAdsConversionUpload", () => ({
  uploadPurchaseConversion: uploadMock,
}));
vi.mock("posthog-node", () => ({
  PostHog: vi.fn(function PostHog() {
    return { capture: vi.fn(), identify: vi.fn(), shutdown: vi.fn().mockResolvedValue(undefined) };
  }),
}));

import { dispatchAnalyticsEvent } from "@/app/api/_lib/analytics";

function purchase(extra: Record<string, unknown> = {}) {
  return {
    event_name: "purchase",
    email: "buyer@example.com",
    properties: {
      order_id: "63093",
      transaction_id: "txn-1",
      value: 198,
      currency: "USD",
      gclid: "G-123",
      ...extra,
    },
    timestamp: 1760000000,
  };
}

function legacyPings(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.filter((call) => String(call[0]).includes("googleadservices.com"));
}

describe("fireGoogleAds purchase path", () => {
  beforeEach(() => {
    for (const k of ["META_PIXEL_ID", "META_ACCESS_TOKEN", "GA4_MEASUREMENT_ID", "GA4_API_SECRET",
      "POSTHOG_PROJECT_API_KEY", "NEXT_PUBLIC_POSTHOG_KEY"]) delete process.env[k];
    process.env.GOOGLE_ADS_CONVERSION_ID = "AW-603275854";
    process.env.GOOGLE_ADS_LABEL_FUNNEL_CONVERSION = "LABEL";
    uploadMock.mockReset();
  });

  it("uploads with real value and skips the legacy ping on success", async () => {
    uploadMock.mockResolvedValue({ ok: true, conversionAction: "customers/1/conversionActions/2" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await dispatchAnalyticsEvent(purchase());
    expect(uploadMock).toHaveBeenCalledWith(
      expect.objectContaining({ gclid: "G-123", value: 198, orderId: "txn-1", timestamp: 1760000000 })
    );
    expect(legacyPings(fetchSpy)).toHaveLength(0);
  });

  it("falls back to the legacy ping when the upload fails", async () => {
    uploadMock.mockResolvedValue({ ok: false, reason: "no_upload_action" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await dispatchAnalyticsEvent(purchase());
    const pings = legacyPings(fetchSpy);
    expect(pings).toHaveLength(1);
    expect(String(pings[0][0])).toContain("value=198");
  });

  it("does not report subscription renewals to Google", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await dispatchAnalyticsEvent(purchase({ is_subscription_recurring_order: true }));
    expect(uploadMock).not.toHaveBeenCalled();
    expect(legacyPings(fetchSpy)).toHaveLength(0);
  });

  it("keeps the legacy ping for purchases with no Google click id", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await dispatchAnalyticsEvent(purchase({ gclid: undefined }));
    expect(uploadMock).not.toHaveBeenCalled();
    expect(legacyPings(fetchSpy)).toHaveLength(1);
  });
});
