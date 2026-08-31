/**
 * Unit tests for withShopifyRetry (shopifySubscriptionsApi.ts).
 *
 * Mirrors tests/lib/loopAdminRetry.test.ts. Shopify wrapper uses a
 * baseMs=1000 default (backoff 1s/2s/4s) and timeoutMs=30000.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  withShopifyRetry,
  ShopifyRetryableHttpError,
} from "@/app/api/_lib/shopifySubscriptionsApi";

async function runWithFakeTimers<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  let result: T | undefined;
  let error: unknown;
  promise.then(
    (r) => {
      done = true;
      result = r;
    },
    (e) => {
      done = true;
      error = e;
    }
  );
  for (let i = 0; i < 20 && !done; i++) {
    await vi.advanceTimersByTimeAsync(20_000);
    await Promise.resolve();
  }
  if (!done) throw new Error("promise did not settle under fake timers");
  if (error) throw error;
  return result as T;
}

describe("withShopifyRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("succeeds on first attempt", async () => {
    const fn = vi.fn(async () => "ok");
    const result = await runWithFakeTimers(
      withShopifyRetry(fn, { label: "test-happy" })
    );
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("succeeds on 2nd attempt after transient network error", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        throw new TypeError("fetch failed");
      }
      return "recovered";
    });
    const result = await runWithFakeTimers(
      withShopifyRetry(fn, { label: "test-transient", baseMs: 10 })
    );
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("succeeds on 3rd attempt after two timeouts", async () => {
    let calls = 0;
    const fn = vi.fn(async (_signal: AbortSignal) => {
      calls++;
      if (calls <= 2) {
        const err = new Error("The user aborted a request.");
        err.name = "AbortError";
        throw err;
      }
      return "eventually";
    });
    const result = await runWithFakeTimers(
      withShopifyRetry(fn, { label: "test-timeouts", baseMs: 10 })
    );
    expect(result).toBe("eventually");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("fails after 3 retries exhausted", async () => {
    const fn = vi.fn(async () => {
      throw new ShopifyRetryableHttpError(503, "always down");
    });
    await expect(
      runWithFakeTimers(
        withShopifyRetry(fn, { label: "test-exhaust", baseMs: 10 })
      )
    ).rejects.toThrow(ShopifyRetryableHttpError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on 400 Bad Request", async () => {
    const fn = vi.fn(async () => {
      throw new Error("Shopify Subscriptions API error 400: bad input");
    });
    await expect(
      runWithFakeTimers(
        withShopifyRetry(fn, { label: "test-400", baseMs: 10 })
      )
    ).rejects.toThrow(/400/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("DOES retry on 429 with backoff", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls <= 2) {
        throw new ShopifyRetryableHttpError(429, "rate limited");
      }
      return "ok-after-throttle";
    });
    const result = await runWithFakeTimers(
      withShopifyRetry(fn, { label: "test-429", baseMs: 10 })
    );
    expect(result).toBe("ok-after-throttle");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("DOES retry on 503", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        throw new ShopifyRetryableHttpError(503, "service unavailable");
      }
      return "back-online";
    });
    const result = await runWithFakeTimers(
      withShopifyRetry(fn, { label: "test-503", baseMs: 10 })
    );
    expect(result).toBe("back-online");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
