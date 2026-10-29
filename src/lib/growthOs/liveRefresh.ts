/**
 * Growth OS live refresh (Vercel cron, no Perplexity credits).
 *
 * Every 30 minutes: pulls MyMully Meta ad-level daily insights, ad/ad set/campaign status and
 * budgets, Google Ads campaign-day metrics + PMax detail + campaign status/budgets (via the
 * locked gateway lib), and Shopify order click attributes; then hands everything to
 * public.gos_live_ingest() in Supabase, which upserts idempotently and rebuilds the dashboard cache.
 *
 * Read-only against every ad platform. MyMully Meta ad account only.
 */
import { runGateway } from "@/lib/growthOs/googleAdsGateway";

export const META_AD_ACCOUNT = "act_2796962933960445";
export const PMAX_CAMPAIGN_ID = "24165010315";
/** AgentCocoon Search campaign (not MyMully): detail rows only, kept out of MyMully totals in Supabase. */
export const AC_SEARCH_CAMPAIGN_ID = "24405645267";
type Env = Record<string, string | undefined>;
type Json = Record<string, unknown>;
type Action = { action_type: string; value: string };

const day = (d: Date) => d.toISOString().slice(0, 10);
export function etToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function daysBack(today: string, n: number): string {
  const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return day(d);
}

/** Map a Graph API insights row to the shape growth_os.ingest_meta expects (same as the Meta connector). */
export function mapMetaInsight(x: Json) {
  const a = Object.fromEntries(((x.actions as Action[]) ?? []).map((y) => [y.action_type, y.value]));
  const v = Object.fromEntries(((x.action_values as Action[]) ?? []).map((y) => [y.action_type, y.value]));
  return { id: x.ad_id, name: x.ad_name, date_start: x.date_start, campaign_id: x.campaign_id, campaign_name: x.campaign_name,
    adset_id: x.adset_id, adset_name: x.adset_name, amount_spent: x.spend ?? "0", impressions: x.impressions ?? "0",
    link_click: a.link_click ?? "0", omni_add_to_cart: a.omni_add_to_cart ?? "0", omni_initiated_checkout: a.omni_initiated_checkout ?? "0",
    omni_purchase: a.omni_purchase ?? "0", omni_purchase_values: v.omni_purchase ?? "0" };
}

async function graph(path: string, params: Record<string, string>, env: Env, fetcher: typeof fetch) {
  const token = env.META_MARKETING_API_TOKEN ?? "";
  if (!token) throw new Error("META_MARKETING_API_TOKEN missing");
  const ver = env.META_API_VERSION || "v21.0";
  let url: string | undefined = `https://graph.facebook.com/${ver}/${path}?` + new URLSearchParams({ ...params, access_token: token });
  const out: Json[] = [];
  for (let i = 0; url && i < 20; i++) {
    const res = await fetcher(url, { signal: AbortSignal.timeout(30000) });
    const body = (await res.json()) as { data?: Json[]; paging?: { next?: string }; error?: { message?: string } };
    if (!res.ok || body.error) throw new Error(`meta ${path}: ${body.error?.message ?? res.status}`);
    out.push(...(body.data ?? [])); url = body.paging?.next;
  }
  return out;
}

export async function fetchMeta(today: string, env: Env, fetcher: typeof fetch = fetch) {
  const since = daysBack(today, 7);
  const ins = await graph(`${META_AD_ACCOUNT}/insights`, { level: "ad", time_increment: "1", limit: "500",
    time_range: JSON.stringify({ since, until: today }),
    fields: "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,actions,action_values",
    filtering: JSON.stringify([{ field: "spend", operator: "GREATER_THAN", value: 0 }]) }, env, fetcher);
  const active = JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]);
  const usd = (c: unknown) => (c == null || c === "" ? null : Number(c) / 100); // Graph budgets are in cents
  const [camps, sets] = await Promise.all([
    graph(`${META_AD_ACCOUNT}/campaigns`, { fields: "id,name,effective_status,daily_budget", filtering: active, limit: "200" }, env, fetcher),
    graph(`${META_AD_ACCOUNT}/adsets`, { fields: "id,name,campaign_id,effective_status,daily_budget", filtering: active, limit: "200" }, env, fetcher),
  ]);
  const adIds = [...new Set(ins.map((x) => String(x.ad_id)))];
  const ads: Json[] = [];
  for (let i = 0; i < adIds.length; i += 50) {
    const r = await fetcher(`https://graph.facebook.com/${env.META_API_VERSION || "v21.0"}/?` + new URLSearchParams({
      ids: adIds.slice(i, i + 50).join(","), fields: "id,name,adset_id,campaign_id,effective_status", access_token: env.META_MARKETING_API_TOKEN ?? "" }),
      { signal: AbortSignal.timeout(30000) });
    const body = (await r.json()) as Record<string, Json> & { error?: { message?: string } };
    if (!r.ok || body.error) throw new Error(`meta ads status: ${body.error?.message ?? r.status}`);
    ads.push(...Object.values(body));
  }
  const states = [
    ...camps.map((x) => ({ channel: "meta", level: "campaign", id: x.id, name: x.name, campaign_id: x.id, status: x.effective_status, daily_budget: usd(x.daily_budget), snapshot: true })),
    ...sets.map((x) => ({ channel: "meta", level: "adset", id: x.id, name: x.name, campaign_id: x.campaign_id, status: x.effective_status, daily_budget: usd(x.daily_budget), snapshot: true })),
    ...ads.map((x) => ({ channel: "meta", level: "ad", id: x.id, name: x.name, campaign_id: x.campaign_id, parent_id: x.adset_id, status: x.effective_status })),
  ];
  return { rows: ins.map(mapMetaInsight), states };
}

type GRow = { campaign?: Json; segments?: Json; metrics?: Json; campaignBudget?: Json; campaignSearchTermInsight?: Json;
  adGroup?: Json; adGroupCriterion?: Json; searchTermView?: Json };
export async function fetchGoogle(today: string, env: Env, fetcher: typeof fetch = fetch) {
  const since = daysBack(today, 14);
  const q = async (query: string) => (await runGateway({ action: "search", query, maxPages: 5 }, env, fetcher)) as { rows: GRow[] };
  const [camp, prod, net, theme, st] = await Promise.all([
    q(`SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${since}' AND '${today}'`),
    q(`SELECT campaign.id, segments.date, segments.product_item_id, segments.product_title, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM shopping_performance_view WHERE campaign.id = ${PMAX_CAMPAIGN_ID} AND segments.date BETWEEN '${since}' AND '${today}'`),
    q(`SELECT segments.date, segments.ad_network_type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE campaign.id = ${PMAX_CAMPAIGN_ID} AND segments.date BETWEEN '${since}' AND '${today}'`),
    q(`SELECT campaign_search_term_insight.category_label, campaign_search_term_insight.id, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign_search_term_insight WHERE segments.date DURING LAST_30_DAYS AND campaign_search_term_insight.campaign_id = ${PMAX_CAMPAIGN_ID}`),
    q(`SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'`),
  ]);
  const m = (r: GRow) => r.metrics ?? {};
  const ac = await fetchAcSearchDetail(since, today, q);
  const detail = [
    ...ac.detail,
    ...prod.rows.map((r) => ({ kind: "product", campaign_id: PMAX_CAMPAIGN_ID, date: r.segments?.date, key: r.segments?.productItemId ?? "", label: r.segments?.productTitle,
      impressions: m(r).impressions ?? 0, clicks: m(r).clicks ?? 0, cost_micros: m(r).costMicros ?? 0, conversions: m(r).conversions ?? 0, conv_value: m(r).conversionsValue ?? 0 })),
    ...net.rows.map((r) => ({ kind: "network", campaign_id: PMAX_CAMPAIGN_ID, date: r.segments?.date, key: r.segments?.adNetworkType ?? "", label: r.segments?.adNetworkType,
      impressions: m(r).impressions ?? 0, clicks: m(r).clicks ?? 0, cost_micros: m(r).costMicros ?? 0, conversions: m(r).conversions ?? 0, conv_value: m(r).conversionsValue ?? 0 })),
    ...theme.rows.map((r) => ({ kind: "search_theme", campaign_id: PMAX_CAMPAIGN_ID, date: null, key: String(r.campaignSearchTermInsight?.id ?? "0"),
      label: r.campaignSearchTermInsight?.categoryLabel ?? "", window_days: 30, impressions: m(r).impressions ?? 0, clicks: m(r).clicks ?? 0, conversions: m(r).conversions ?? 0 })),
  ];
  const states = st.rows.map((r) => ({ channel: "google", level: "campaign", id: r.campaign?.id, name: r.campaign?.name, status: r.campaign?.status,
    daily_budget: Number(r.campaignBudget?.amountMicros ?? 0) / 1e6 }));
  const rows = camp.rows.map((r) => ({ date: r.segments?.date, campaign_id: String(r.campaign?.id ?? ""), campaign_name: r.campaign?.name,
    cost_micros: m(r).costMicros ?? 0, impressions: m(r).impressions ?? 0, clicks: m(r).clicks ?? 0,
    conversions: m(r).conversions ?? 0, conversions_value: m(r).conversionsValue ?? 0 })).filter((r) => r.date && r.campaign_id);
  return { rows, detail, states, detailErrors: ac.errors };
}

/** Daily ad group, keyword and search term rows for the AgentCocoon Search campaign (gads_detail). Each part fails independently. */
export async function fetchAcSearchDetail(since: string, today: string, q: (query: string) => Promise<{ rows: GRow[] }>) {
  const C = AC_SEARCH_CAMPAIGN_ID;
  const met = "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value";
  const where = `campaign.id = ${C} AND segments.date BETWEEN '${since}' AND '${today}'`;
  const parts = await Promise.allSettled([
    q(`SELECT segments.date, ad_group.id, ad_group.name, ${met} FROM ad_group WHERE ${where}`),
    q(`SELECT segments.date, ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ${met} FROM keyword_view WHERE ${where}`),
    q(`SELECT segments.date, ad_group.id, search_term_view.search_term, ${met} FROM search_term_view WHERE ${where}`),
  ]);
  const kinds = ["ad_group", "keyword", "search_term"] as const;
  const errors: Array<{ source: string; error: string }> = [];
  const detail: Json[] = [];
  parts.forEach((p, i) => {
    if (p.status === "rejected") { errors.push({ source: `google_ac_${kinds[i]}`, error: String((p.reason as Error)?.message ?? p.reason).slice(0, 300) }); return; }
    for (const r of p.value.rows) {
      const mm = r.metrics ?? {}, ag = String(r.adGroup?.id ?? "");
      const crit = (r.adGroupCriterion ?? {}) as Json, kw = (crit.keyword ?? {}) as Json;
      const key = kinds[i] === "ad_group" ? ag : kinds[i] === "keyword" ? `${ag}~${crit.criterionId ?? ""}` : `${ag}~${r.searchTermView?.searchTerm ?? ""}`;
      const label = kinds[i] === "ad_group" ? r.adGroup?.name : kinds[i] === "keyword" ? `${kw.text ?? ""} [${kw.matchType ?? ""}]` : r.searchTermView?.searchTerm;
      if (!r.segments?.date || !ag) continue;
      detail.push({ kind: kinds[i], campaign_id: C, date: r.segments.date, key, label,
        impressions: mm.impressions ?? 0, clicks: mm.clicks ?? 0, cost_micros: mm.costMicros ?? 0, conversions: mm.conversions ?? 0, conv_value: mm.conversionsValue ?? 0 });
    }
  });
  return { detail, errors };
}

export async function fetchShopifyAttribution(today: string, env: Env, fetcher: typeof fetch = fetch) {
  const domain = env.SHOPIFY_STORE_DOMAIN, token = env.SHOPIFY_ADMIN_TOKEN;
  if (!domain || !token) throw new Error("SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN missing");
  const ver = env.SHOPIFY_ADMIN_API_VERSION || "2025-01";
  const out: Json[] = []; let after: string | null = null;
  for (let page = 0; page < 6; page++) {
    const res = await fetcher(`https://${domain}/admin/api/${ver}/graphql.json`, { method: "POST", signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: "query($q:String!,$after:String){ orders(first:50, after:$after, query:$q, sortKey:CREATED_AT){ nodes{ id name createdAt customAttributes{ key value } } pageInfo{ hasNextPage endCursor } } }",
        variables: { q: `created_at:>=${daysBack(today, 7)} -source_name:subscription_contract_checkout_one`, after } }) });
    const body = (await res.json()) as { data?: { orders?: { nodes: Array<{ id: string; name: string; createdAt: string; customAttributes?: Array<{ key: string; value: string }> }>; pageInfo: { hasNextPage: boolean; endCursor: string } } }; errors?: unknown };
    const d = body.data?.orders;
    if (!res.ok || !d) throw new Error("shopify orders: " + JSON.stringify(body.errors ?? res.status).slice(0, 200));
    for (const n of d.nodes) {
      const a = Object.fromEntries((n.customAttributes ?? []).map((x) => [x.key, x.value]));
      out.push({ order_name: n.name, shopify_order_id: n.id, created_at: n.createdAt, utm_source: a.utm_source ?? null, utm_medium: a.utm_medium ?? null,
        utm_campaign: a.utm_campaign ?? null, utm_content: a.utm_content ?? null, utm_term: a.utm_term ?? null,
        has_fbclid: !!a.fbclid, has_fbc: !!a.fbc, has_google_click: !!(a.gclid || a.gbraid || a.wbraid) });
    }
    if (!d.pageInfo.hasNextPage) break; after = d.pageInfo.endCursor;
  }
  return out;
}

/** Pull everything (each source independent), then one RPC to Supabase. */
export async function runLiveRefresh(env: Env, rpc: (fn: string, args: Json) => Promise<unknown>, fetcher: typeof fetch = fetch) {
  const today = etToday();
  const errors: Array<{ source: string; error: string }> = [];
  const err = (source: string) => (e: unknown) => { errors.push({ source, error: String((e as Error)?.message ?? e).slice(0, 300) }); return null; };
  const [meta, google, orders] = await Promise.all([
    fetchMeta(today, env, fetcher).catch(err("meta")),
    fetchGoogle(today, env, fetcher).catch(err("google")),
    fetchShopifyAttribution(today, env, fetcher).catch(err("shopify_attribution")),
  ]);
  errors.push(...(google?.detailErrors ?? []));
  const payload = { meta: meta?.rows ?? null, google: google?.rows ?? null, pmax: google?.detail ?? null,
    states: [...(meta?.states ?? []), ...(google?.states ?? [])], orders, errors };
  const result = await rpc("gos_live_ingest", { p: payload });
  return { today, counts: { meta: meta?.rows.length ?? null, google: google?.rows.length ?? null, pmax: google?.detail.length ?? null,
    states: payload.states.length, orders: orders?.length ?? null }, errors, result };
}
