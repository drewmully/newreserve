/** Operational Meta reader only. Exhausted paging is not an all-marketing
 * inventory or a zero certificate for omitted dates. No source writes here. */
export interface MetaInsightsRow {
  date_start: string;
  date_stop: string;
  spend: string;
  impressions: string;
  clicks: string;
  reach?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
}
export type MetaAccount = { accountId: string; currency: "USD"; timezone: "America/New_York" };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("meta_spend_schema");
  return value as Record<string, unknown>;
};
export function metaAccountId(value: string): string {
  // Refuse, rather than silently changing existing snapshot natural keys.
  if (value !== value.trim() || !/^(act_)?[1-9]\d+$/.test(value))
    throw new Error("meta_spend_account_id");
  return value.startsWith("act_") ? value : `act_${value}`;
}
export function metaSpendCents(value: unknown): number {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value))
    throw new Error("meta_spend_amount");
  const [whole, fraction = ""] = value.split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (cents > BigInt("99999999999999")) throw new Error("meta_spend_amount");
  return Number(cents);
}
export function metaDeliveryCount(value: unknown): number {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value) ||
      BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("meta_spend_count");
  return Number(value);
}
function datesBetween(since: string, until: string): string[] {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("meta_spend_dates");
    const n = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value)
      throw new Error("meta_spend_dates");
    return n;
  };
  const start = parse(since), end = parse(until), days = (end - start) / 86400000 + 1;
  if (days < 1 || days > 32) throw new Error("meta_spend_dates");
  return Array.from({ length: days }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
}

export function createMetaSpendReader(input: {
  accountId: string; apiVersion: string; token: string;
  signal: AbortSignal; fetcher?: typeof fetch;
}) {
  const accountId = metaAccountId(input.accountId);
  if (!/^v\d+\.\d+$/.test(input.apiVersion) || !input.token.trim())
    throw new Error("meta_spend_configuration");
  const root = `https://graph.facebook.com/${input.apiVersion}/${accountId}`;
  let bytes = 0, requests = 0;
  async function request(url: URL) {
    input.signal.throwIfAborted();
    if (++requests > 51) throw new Error("meta_spend_request_budget");
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(20000)]);
    let response: Response;
    try {
      response = await (input.fetcher ?? fetch)(url, {
        method: "GET", headers: { Authorization: `Bearer ${input.token}` },
        redirect: "error", signal,
      });
    } catch { throw new Error("meta_spend_transport"); }
    if (!response.ok) throw new Error("meta_spend_http");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("meta_spend_body");
    const chunks: Uint8Array[] = [];
    let pageBytes = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        const part = await reader.read();
        signal.throwIfAborted();
        if (part.done) break;
        bytes += part.value.byteLength; pageBytes += part.value.byteLength;
        if (pageBytes > 1024 * 1024 || bytes > 32 * 1024 * 1024)
          throw new Error("meta_spend_byte_budget");
        chunks.push(part.value);
      }
      let body: Record<string, unknown>;
      try { body = object(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { throw new Error("meta_spend_schema"); }
      if (body.error !== undefined) throw new Error("meta_spend_provider_error");
      return body;
    } finally {
      signal.removeEventListener("abort", cancel);
      await reader.cancel().catch(() => {});
    }
  }
  let account: MetaAccount | undefined;
  return {
    async readAccount(): Promise<MetaAccount> {
      const url = new URL(root);
      url.searchParams.set("fields", "id,account_id,currency,timezone_name");
      const data = await request(url);
      if (data.id !== accountId || data.account_id !== accountId.slice(4) ||
          data.currency !== "USD" || data.timezone_name !== "America/New_York")
        throw new Error("meta_spend_account_scope");
      account = { accountId, currency: "USD", timezone: "America/New_York" };
      return account;
    },
    async readInsights(scope: { level: "account" | "adset"; fields: string; since: string; until: string }) {
      if (!account) throw new Error("meta_spend_account_unverified");
      const dates = datesBetween(scope.since, scope.until);
      const base = new URL(`${root}/insights`);
      base.searchParams.set("level", scope.level);
      base.searchParams.set("fields", scope.fields);
      base.searchParams.set("time_increment", "1");
      base.searchParams.set("time_range", JSON.stringify({ since: scope.since, until: scope.until }));
      base.searchParams.set("limit", "1000");
      const rows: MetaInsightsRow[] = [], keys = new Set<string>(), cursors = new Set<string>();
      let after: string | undefined;
      for (let page = 1; page <= 25; page++) {
        const url = new URL(base);
        if (after) url.searchParams.set("after", after);
        const body = await request(url);
        if (!Array.isArray(body.data)) throw new Error("meta_spend_schema");
        for (const value of body.data) {
          const row = object(value);
          if (typeof row.date_start !== "string" || !dates.includes(row.date_start) ||
              row.date_stop !== row.date_start ||
              scope.level === "adset" && (typeof row.adset_id !== "string" ||
                !/^[1-9]\d*$/.test(row.adset_id) || typeof row.campaign_id !== "string" ||
                !/^[1-9]\d*$/.test(row.campaign_id))) throw new Error("meta_spend_row_scope");
          metaSpendCents(row.spend);
          metaDeliveryCount(row.clicks); metaDeliveryCount(row.impressions);
          const key = `${row.date_start}:${scope.level === "adset" ? row.adset_id : ""}`;
          if (keys.has(key)) throw new Error("meta_spend_duplicate");
          keys.add(key); rows.push(row as unknown as MetaInsightsRow);
          if (rows.length > 1000) throw new Error("meta_spend_row_budget");
        }
        const paging = body.paging === undefined ? {} : object(body.paging);
        if (paging.next === undefined) {
          return { rows, account, pages: page, paginationComplete: true as const,
            missingDates: dates.filter(date => !rows.some(row => row.date_start === date)) };
        }
        if (typeof paging.next !== "string" || !paging.next) throw new Error("meta_spend_cursor");
        let next: URL;
        try { next = new URL(paging.next); } catch { throw new Error("meta_spend_cursor"); }
        const cursor = object(paging.cursors).after;
        if (next.origin !== base.origin || next.pathname !== base.pathname || next.username ||
            next.password || next.hash || typeof cursor !== "string" || !cursor || cursor.length > 4096 ||
            next.searchParams.get("after") !== cursor || cursors.has(cursor))
          throw new Error("meta_spend_cursor");
        for (const key of ["level", "fields", "time_increment", "time_range", "limit"]) {
          if (next.searchParams.has(key) && next.searchParams.get(key) !== base.searchParams.get(key))
            throw new Error("meta_spend_cursor_scope");
        }
        // Rebuild from our fixed request. Never fetch the provider's arbitrary URL
        // or copy its embedded access_token into logs or retained source metadata.
        cursors.add(cursor); after = cursor;
        if (page === 25 || rows.length === 1000) throw new Error("meta_spend_incomplete_pagination");
      }
      throw new Error("meta_spend_incomplete_pagination");
    },
  };
}
