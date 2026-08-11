import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.LOOP_ADMIN_API_TOKEN = "test-token";
  process.env.LOOP_API_BASE_URL = "https://api.loopsubscriptions.com/admin/2023-10";
});

/**
 * Builds a mocked getLoopSubscriptionById response (GET .../subscription/:id)
 * followed by a mocked frequency PUT response, matching the two fetch calls
 * made by updateLoopSubscriptionNextBillingDate.
 */
function mockGetSubscription(subData: Record<string, unknown> | null) {
  fetchMock.mockImplementationOnce(async () => ({
    ok: true,
    text: async () => JSON.stringify({ data: subData }),
    json: async () => ({ data: subData }),
  }));
}

function mockFrequencyPutOk() {
  fetchMock.mockImplementationOnce(async () => ({
    ok: true,
    text: async () => "",
    json: async () => ({}),
  }));
}

describe("updateLoopSubscriptionNextBillingDate", () => {
  it("throws a descriptive error naming the subscription id when billingPolicy is missing", async () => {
    const { updateLoopSubscriptionNextBillingDate } = await import(
      "@/app/api/_lib/loopAdmin"
    );

    mockGetSubscription({
      id: "sub_annual_1",
      status: "ACTIVE",
      deliveryPolicy: { interval: "YEAR", intervalCount: 1 },
      // billingPolicy intentionally absent
    });

    await expect(
      updateLoopSubscriptionNextBillingDate("sub_annual_1", 1779321600)
    ).rejects.toThrow(/sub_annual_1.*billingPolicy/i);

    // Must not have attempted the frequency PUT with a guessed cadence.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a descriptive error naming the subscription id when deliveryPolicy is missing", async () => {
    const { updateLoopSubscriptionNextBillingDate } = await import(
      "@/app/api/_lib/loopAdmin"
    );

    mockGetSubscription({
      id: "sub_annual_2",
      status: "ACTIVE",
      billingPolicy: { interval: "YEAR", intervalCount: 1 },
      // deliveryPolicy intentionally absent
    });

    await expect(
      updateLoopSubscriptionNextBillingDate("sub_annual_2", 1779321600)
    ).rejects.toThrow(/sub_annual_2.*deliveryPolicy/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a descriptive error naming the subscription id when both policies are missing", async () => {
    const { updateLoopSubscriptionNextBillingDate } = await import(
      "@/app/api/_lib/loopAdmin"
    );

    mockGetSubscription({
      id: "sub_no_policy",
      status: "ACTIVE",
    });

    await expect(
      updateLoopSubscriptionNextBillingDate("sub_no_policy", 1779321600)
    ).rejects.toThrow(/sub_no_policy.*billingPolicy.*deliveryPolicy/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes an annual billing/delivery policy through unchanged (YEAR/1)", async () => {
    const { updateLoopSubscriptionNextBillingDate } = await import(
      "@/app/api/_lib/loopAdmin"
    );

    mockGetSubscription({
      id: "sub_annual_3",
      status: "ACTIVE",
      billingPolicy: { interval: "YEAR", intervalCount: 1 },
      deliveryPolicy: { interval: "YEAR", intervalCount: 1 },
    });
    mockFrequencyPutOk();

    await updateLoopSubscriptionNextBillingDate("sub_annual_3", 1779321600);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, putCall] = fetchMock.mock.calls;
    const [, options] = putCall as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.billingPolicy).toEqual({ interval: "YEAR", intervalCount: 1 });
    expect(body.deliveryPolicy).toEqual({ interval: "YEAR", intervalCount: 1 });
  });

  it("passes an annual billing/delivery policy through unchanged (MONTH/12 shape)", async () => {
    const { updateLoopSubscriptionNextBillingDate } = await import(
      "@/app/api/_lib/loopAdmin"
    );

    mockGetSubscription({
      id: "sub_annual_4",
      status: "ACTIVE",
      billingPolicy: { interval: "MONTH", intervalCount: 12 },
      deliveryPolicy: { interval: "MONTH", intervalCount: 12 },
    });
    mockFrequencyPutOk();

    await updateLoopSubscriptionNextBillingDate("sub_annual_4", 1779321600);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, putCall] = fetchMock.mock.calls;
    const [, options] = putCall as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.billingPolicy).toEqual({ interval: "MONTH", intervalCount: 12 });
    expect(body.deliveryPolicy).toEqual({ interval: "MONTH", intervalCount: 12 });
  });

  it("passes a quarterly billing/delivery policy through unchanged", async () => {
    const { updateLoopSubscriptionNextBillingDate } = await import(
      "@/app/api/_lib/loopAdmin"
    );

    mockGetSubscription({
      id: "sub_quarterly_1",
      status: "ACTIVE",
      billingPolicy: { interval: "MONTH", intervalCount: 3 },
      deliveryPolicy: { interval: "MONTH", intervalCount: 3 },
    });
    mockFrequencyPutOk();

    await updateLoopSubscriptionNextBillingDate("sub_quarterly_1", 1779321600);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, putCall] = fetchMock.mock.calls;
    const [, options] = putCall as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.billingPolicy).toEqual({ interval: "MONTH", intervalCount: 3 });
    expect(body.deliveryPolicy).toEqual({ interval: "MONTH", intervalCount: 3 });
  });
});
