import type { MarketingRuntime } from "./marketingSourceRefresh";

/** Existing service-role configuration only. No new environment capability.
 * Do not include Supabase/provider errors in logs or HTTP responses. */
export function marketingSourceServer(): MarketingRuntime {
  const env = process.env;
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (url?.replace(/\/$/, "") !== "https://xnfjdbpjuaezxjgargto.supabase.co" || !key)
    throw new Error("marketing_source_configuration");
  return { env, now: Date.now, request: fetch,
    async rpc(name, args) {
      if (!["claim", "commit", "read", "fail", "health", "pause"]
        .some(suffix => name === `lean_marketing_source_${suffix}`))
        throw new Error("marketing_source_rpc");
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("marketing_source_rpc")); }, 10000);
      });
      try {
        const response = await Promise.race([fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
          method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(args), redirect: "error", cache: "no-store", signal: controller.signal,
        }), expired]);
        if (!response.ok || !response.body) {
          void response.body?.cancel().catch(() => {}); throw new Error("marketing_source_rpc");
        }
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
        try {
          for (;;) {
            const part = await Promise.race([reader.read(), expired]); if (part.done) break;
            bytes += part.value.length; if (bytes > 8388608) throw new Error("marketing_source_rpc");
            chunks.push(part.value);
          }
        } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } finally { if (timer) clearTimeout(timer); controller.abort(); }
    },
  };
}
