/**
 * Unit tests for withLoopRetry (loopAdmin.ts).
 *
 * Covers PR #129 resilience wrapper introduced in response to the
 * 2026-08-31 Loop admin API flakiness (intermittent 30s+ hangs on
 * `GET /admin/2023-10/subscription/{id}`).
 *
 * Backoff is deterministic: `vi.useFakeTimers()` fast-forwards the
 * 2s/4s/8s sleeps so the suite still runs in milliseconds.
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
  withLoopRetry,
  LoopRetryableHttpError,
} from "@/app/api/_lib/loopAdmin";

// Helper: run a promise-returning fn under fake timers, draining timers
// synchronously so the internal `await new Promise(setTimeout)` resolves.
async function runWithFakeTimers<T>(promise: Promise<T>): Promise<T> {
  // Repeatedly advance timers until the promise settles.
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
  // Try up to 20 iterations of pumping — enough for 3 retries.
  for (let i = 0; i < 20 && !done; i++) {
    // Advance far enough to cover all backoff delays combined.
    await vi.advanceTimersByTimeAsync(20_000);
    // Yield to microtasks.
    await Promise.resolve();
  }
  if (!done) throw new Error("promise did not settle under fake timers");
  if (error) throw error;
  return result as T;
}

describe("withLoopRetry", () => {
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
      withLoopRetry(fn, { label: "test-happy" })
    );
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("succeeds on 2nd attempt after transient network error", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        const err = new TypeError("fetch failed");
        throw err;
      }
      return "recovered";
    });
    const result = await runWithFakeTimers(
      withLoopRetry(fn, { label: "test-transient", baseMs: 10 })
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
      withLoopRetry(fn, { label: "test-timeouts", baseMs: 10 })
    );
    expect(result).toBe("eventually");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("fails after 3 retries exhausted", async () => {
    const fn = vi.fn(async () => {
      throw new LoopRetryableHttpError(503, "always down");
    });
    await expect(
      runWithFakeTimers(withLoopRetry(fn, { label: "test-exhaust", baseMs: 10 }))
    ).rejects.toThrow(LoopRetryableHttpError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on 400 Bad Request", async () => {
    // 4xx (other than 429) are surfaced as plain Error and should NOT be
    // wrapped in LoopRetryableHttpError \u2014 they bubble out of the callback
    // and the wrapper stops immediately.
    const fn = vi.fn(async () => {
      throw new Error("Loop API error 400: bad request");
    });
    await expect(
      runWithFakeTimers(withLoopRetry(fn, { label: "test-400", baseMs: 10 }))
    ).rejects.toThrow(/400/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("DOES retry on 429 with backoff", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls <= 2) {
        throw new LoopRetryableHttpError(429, "rate limited");
      }
      return "ok-after-throttle";
    });
    const result = await runWithFakeTimers(
      withLoopRetry(fn, { label: "test-429", baseMs: 10 })
    );
    expect(result).toBe("ok-after-throttle");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("DOES retry on 503", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        throw new LoopRetryableHttpError(503, "service unavailable");
      }
      return "back-online";
    });
    const result = await runWithFakeTimers(
      withLoopRetry(fn, { label: "test-503", baseMs: 10 })
    );
    expect(result).toBe("back-online");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
