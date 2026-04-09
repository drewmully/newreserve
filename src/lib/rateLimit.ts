type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitStore = Map<string, Bucket>;

declare global {
  // eslint-disable-next-line no-var
  var __mullyRateLimitStore: RateLimitStore | undefined;
}

function getStore(): RateLimitStore {
  if (!globalThis.__mullyRateLimitStore) {
    globalThis.__mullyRateLimitStore = new Map();
  }
  return globalThis.__mullyRateLimitStore;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  namespace: string,
  key: string,
  {
    maxHits,
    windowMs,
  }: {
    maxHits: number;
    windowMs: number;
  }
): RateLimitResult {
  const store = getStore();
  const now = Date.now();
  const scopedKey = `${namespace}:${key}`;
  const current = store.get(scopedKey);

  if (!current || current.resetAt <= now) {
    store.set(scopedKey, {
      count: 1,
      resetAt: now + windowMs,
    });
    return {
      allowed: true,
      remaining: Math.max(0, maxHits - 1),
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  if (current.count >= maxHits) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  store.set(scopedKey, current);

  return {
    allowed: true,
    remaining: Math.max(0, maxHits - current.count),
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}
