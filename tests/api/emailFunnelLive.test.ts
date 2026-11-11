import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/_lib/shopifyAdmin", () => ({ shopifyGraphQL: vi.fn() }));
vi.mock("@/app/api/_lib/adminAuth", () => ({
  requireAdmin: vi.fn(async (req: Request) =>
    req.headers.get("authorization") === "Bearer ok"
      ? { ok: true, email: "drew@mullybox.com", uid: "u" }
      : { ok: false, response: new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }) },
  ),
}));

import {
  SMS_ONLY_SOURCE,
  buildCohort,
  buildFlowTable,
  buildFunnel,
  buildPopupFunnel,
  buildSourceTable,
  matchesTriggerFilter,
  profileOutcome,
  rankLeaks,
  triggerSources,
  type FlowDefinition,
  type ProfileEvent,
  type ProfileOutcome,
  type SignupEvent,
  type TriggerFilter,
} from "@/lib/emailFunnel/compute";
import { FLOWS, KLAVIYO_METRICS as M, WELCOME_FLOW_IDS, isTestEmail, parseWindow } from "@/lib/emailFunnel/config";
import { buildFunnelReport, type Sources } from "@/lib/emailFunnel/build";
import { posthogQueries, shotOrdersQuery } from "@/lib/emailFunnel/sources";
import { fmtPct, shortName } from "@/app/admin/email-funnel/EmailFunnelView";

const cond = (field: string, operator: string, value: unknown) => ({
  conditions: [{ type: "metric-property", metric_id: M.siteSignup, field, filter: { type: "string", operator, value } }],
});
const welcomeFilter = (source: unknown, op = "equals"): TriggerFilter => ({
  condition_groups: [cond("email_consent", "equals", true), cond("stage", "equals", "email"), cond("source", op, source)],
});
const flow = (id: string, filter: TriggerFilter, status = "live"): FlowDefinition => ({
  id,
  name: id,
  status,
  triggerMetricId: M.siteSignup,
  triggerFilter: filter,
});
const WELCOME: FlowDefinition[] = [
  flow("ShW6Z4", welcomeFilter(["editorial-drop-bar", "shop-newsletter"], "in")),
  flow("Yi5Z7a", welcomeFilter("shop-edit-popup")),
  flow("Uw8b3k", welcomeFilter("meta-email-offer")),
  flow("TZymKc", welcomeFilter("take-a-shot")),
  flow("Secuhs", welcomeFilter("gift-reminders")),
];

let seq = 0;
function signup(profileId: string, source: string, stage = "email", emailConsent: boolean | null = true, email: string | null = null): SignupEvent {
  seq++;
  return {
    profileId,
    email: email ?? `${profileId}@example.com`,
    datetime: new Date(Date.UTC(2026, 10, 1, 0, seq)).toISOString(),
    source,
    stage,
    emailConsent,
    props: { source, stage, email_consent: emailConsent },
  };
}
const ev = (metricId: string, minutesAfter: number, props: Record<string, unknown> = {}): ProfileEvent => ({
  metricId,
  datetime: new Date(Date.UTC(2026, 10, 2, 0, minutesAfter)).toISOString(),
  props,
});

describe("config", () => {
  it("parses windows and flags test emails", () => {
    expect(parseWindow("7")).toBe(7);
    expect(parseWindow("90")).toBe(90);
    expect(parseWindow("31")).toBe(30);
    expect(parseWindow(null)).toBe(30);
    expect(isTestEmail("drew@mullybox.com")).toBe(true);
    expect(isTestEmail("leo+abc@gmail.com")).toBe(true);
    expect(isTestEmail("a+synctest@x.com")).toBe(true);
    expect(isTestEmail("leo@gmail.com")).toBe(false);
  });
  it("lists the five welcome flows", () => {
    expect(WELCOME_FLOW_IDS).toEqual(["ShW6Z4", "Yi5Z7a", "Uw8b3k", "TZymKc", "Secuhs"]);
    expect(FLOWS).toHaveLength(11);
  });
});

describe("trigger filters", () => {
  it("ANDs groups and handles equals / in", () => {
    const f = WELCOME[0].triggerFilter;
    expect(matchesTriggerFilter(f, { source: "shop-newsletter", stage: "email", email_consent: true })).toBe(true);
    expect(matchesTriggerFilter(f, { source: "shop-newsletter", stage: "sms", email_consent: true })).toBe(false);
    expect(matchesTriggerFilter(f, { source: "shop-newsletter", stage: "email", email_consent: false })).toBe(false);
    expect(matchesTriggerFilter(f, { source: "outings-submit", stage: "email", email_consent: true })).toBe(false);
  });
  it("fails closed on unknown operators and lists sources", () => {
    expect(matchesTriggerFilter({ condition_groups: [cond("source", "starts-with", "x")] }, { source: "xy" })).toBe(false);
    expect(triggerSources(WELCOME[0].triggerFilter)).toEqual(["editorial-drop-bar", "shop-newsletter"]);
    expect(triggerSources(WELCOME[1].triggerFilter)).toEqual(["shop-edit-popup"]);
  });
});

describe("cohort and outcomes", () => {
  const signups = [
    signup("p1", "shop-edit-popup"),
    signup("p1", "shop-edit-popup", "sms", true),
    signup("p2", "outings-submit", "contact", false),
    signup("p3", "shop-edit-popup", "sms", false),
    signup("p4", "shop-newsletter"),
    signup("t1", "shop-newsletter", "email", true, "leo+test@gmail.com"),
    signup("x1", "shop-newsletter"),
  ];
  const cohort = buildCohort(signups, { excludedProfileIds: new Set(["x1"]), welcomeFlows: WELCOME });

  it("dedupes profiles, drops exclusions, routes from live triggers", () => {
    expect(cohort.map((p) => p.profileId).sort()).toEqual(["p1", "p2", "p3", "p4"]);
    const byId = Object.fromEntries(cohort.map((p) => [p.profileId, p]));
    expect(byId.p1.routedFlowIds).toEqual(["Yi5Z7a"]);
    expect(byId.p2.routedFlowIds).toEqual([]);
    expect(byId.p3.smsOnly).toBe(true);
    expect(byId.p3.routedFlowIds).toEqual([]);
    expect(byId.p4.routedFlowIds).toEqual(["ShW6Z4"]);
  });

  it("ignores flows that are not live", () => {
    const c = buildCohort([signup("q", "take-a-shot")], {
      excludedProfileIds: new Set(),
      welcomeFlows: [flow("TZymKc", welcomeFilter("take-a-shot"), "draft")],
    });
    expect(c[0].routedFlowIds).toEqual([]);
  });

  it("derives stages from welcome-flow events and non-renewal orders", () => {
    const p1 = cohort.find((p) => p.profileId === "p1")!;
    const o = profileOutcome(
      p1,
      [
        ev(M.receivedEmail, 1, { $flow: "Yi5Z7a" }),
        ev(M.openedEmail, 2, { $flow: "Yi5Z7a" }),
        ev(M.placedOrder, 3, { "Source Name": "web", Items: ["Polo"] }),
        ev(M.placedOrder, 4, { "Source Name": "subscription_contract_checkout_one" }),
      ],
      WELCOME_FLOW_IDS,
    );
    expect(o).toMatchObject({ entered: true, enteredFlowIds: ["Yi5Z7a"], engaged: true, firstOrder: true, repeatOrReserve: false });

    const reserve = profileOutcome(p1, [ev(M.placedOrder, 3, { "Source Name": "web", Items: ["Mully Reserve | The Seasonal Edit"] })], WELCOME_FLOW_IDS);
    expect(reserve.repeatOrReserve).toBe(true);

    const other = profileOutcome(p1, [ev(M.receivedEmail, 1, { $flow: "YkuGwj" }), ev(M.openedEmail, 2, { $flow: "YkuGwj" })], WELCOME_FLOW_IDS);
    expect(other.entered).toBe(false);
    expect(other.engaged).toBe(false);

    const before = profileOutcome(p1, [{ metricId: M.receivedEmail, datetime: "2026-10-01T00:00:00Z", props: { $flow: "Yi5Z7a" } }], WELCOME_FLOW_IDS);
    expect(before.entered).toBe(false);
  });

  it("builds a nested funnel, source table and ranked leaks", () => {
    const outcomes = new Map<string, ProfileOutcome>([
      ["p1", { entered: true, enteredFlowIds: ["Yi5Z7a"], engaged: true, firstOrder: true, repeatOrReserve: false }],
      ["p2", { entered: false, enteredFlowIds: [], engaged: false, firstOrder: true, repeatOrReserve: false }],
      ["p3", { entered: false, enteredFlowIds: [], engaged: false, firstOrder: false, repeatOrReserve: false }],
      ["p4", { entered: true, enteredFlowIds: ["ShW6Z4"], engaged: false, firstOrder: false, repeatOrReserve: false }],
    ]);
    const f = buildFunnel({ visitors: 1000, popupViewers: null, cohort, outcomes });
    expect(f.stages.map((s) => [s.key, s.count])).toEqual([
      ["visitors", 1000],
      ["popup_viewers", null],
      ["signups", 4],
      ["entered", 2],
      ["engaged", 1],
      ["first_order", 1],
      ["repeat", 0],
    ]);
    expect(f.stages.find((s) => s.key === "signups")!.rateFromPrev).toBeCloseTo(0.004);
    expect(f.stages.find((s) => s.key === "signups")!.rateBase).toBe("Visitors");
    expect(f.stages.find((s) => s.key === "entered")!.rateBase).toBeUndefined();
    expect(f.stages.find((s) => s.key === "popup_viewers")!.rateFromPrev).toBeNull();
    expect(f.stages.find((s) => s.key === "entered")!.rateFromPrev).toBe(0.5);
    expect(f.signupsWithOrder).toBe(2);

    const label = (id: string) => FLOWS.find((x) => x.id === id)!.label;
    const rows = buildSourceTable(cohort, outcomes, label);
    const row = (s: string) => rows.find((r) => r.source === s)!;
    expect(row("shop-edit-popup")).toMatchObject({ signups: 2, flows: ["F1b"], entered: 1, unrouted: false, noFlowShare: 0.5 });
    expect(row("shop-edit-popup").emailConsentRate).toBe(0.5);
    expect(row("outings-submit")).toMatchObject({ signups: 1, unrouted: true, emailConsentRate: 0, noFlowShare: 1 });
    expect(row(SMS_ONLY_SOURCE)).toMatchObject({ signups: 1, unrouted: true });
    expect(rows[rows.length - 1].source).toBe(SMS_ONLY_SOURCE);

    const popup = buildPopupFunnel({
      popupViews: null,
      steps: [
        { event: "take_a_shot_open", label: "Opened", count: 10 },
        { event: "take_a_shot_email", label: "Email", count: 4 },
      ],
      redeemed: 1,
    });
    expect(popup.map((s) => s.rateFromPrev)).toEqual([null, null, 0.4, 0.25]);

    const leaks = rankLeaks({ funnel: f.stages, sources: rows, popup, cohort, outcomes });
    expect(leaks.map((l) => [l.key, l.lost])).toEqual([
      ["popup:take_a_shot_open->take_a_shot_email", 6],
      ["popup:take_a_shot_email->redeemed", 3],
      ["entered->engaged", 1],
    ]);
    const withPhone = buildPopupFunnel({
      popupViews: null,
      steps: [
        { event: "take_a_shot_email", label: "Email", count: 4 },
        { event: "take_a_shot_phone", label: "Added phone", count: 0, optional: true },
        { event: "take_a_shot_shot", label: "Shot", count: 4 },
      ],
      redeemed: 0,
    });
    expect(withPhone.map((s) => s.rateFromPrev)).toEqual([null, null, 0, 1, 0]);
    const phoneLeaks = rankLeaks({ funnel: f.stages, sources: rows, popup: withPhone, cohort, outcomes, limit: 10 });
    expect(phoneLeaks.some((l) => l.key.includes("phone"))).toBe(false);
    expect(phoneLeaks.some((l) => l.key === "popup:take_a_shot_shot->redeemed")).toBe(true);

    const all = rankLeaks({ funnel: f.stages, sources: rows, popup: [], cohort, outcomes, limit: 10 });
    expect(all.map((l) => l.key)).toEqual(
      expect.arrayContaining(["unrouted:outings-submit", "unrouted:sms-only", "entered->engaged"]),
    );
    expect(all.find((l) => l.key === "gated:shop-edit-popup")).toBeUndefined();
  });
});

describe("flow table", () => {
  it("sums message rows and divides by delivered", () => {
    const t = buildFlowTable(
      FLOWS.slice(0, 2),
      new Map([["ShW6Z4", { name: "Mully | F1 | Website Welcome | DRAFT HOLD | V2 AND-FIX | 20261007", status: "live" }]]),
      [
        { flowId: "ShW6Z4", messageId: "a", recipients: 3, delivered: 3, opensUnique: 1, clicksUnique: 0, conversionUniques: 0, conversionValue: 0 },
        { flowId: "ShW6Z4", messageId: "b", recipients: 1, delivered: 1, opensUnique: 1, clicksUnique: 1, conversionUniques: 1, conversionValue: 40 },
      ],
    );
    expect(t[0]).toMatchObject({ messages: 2, recipients: 4, delivered: 4, openRate: 0.5, clickRate: 0.25, placedOrderRate: 0.25, revenue: 40, revenuePerRecipient: 10 });
    expect(t[1]).toMatchObject({ recipients: 0, openRate: null, revenuePerRecipient: null, status: "unknown" });
    expect(shortName(t[0].name)).toBe("Website Welcome");
  });
});

describe("queries and formatting", () => {
  it("builds PostHog and Shopify queries for the window", () => {
    const q = posthogQueries(30);
    expect(q.visitors).toContain("event = 'page_view'");
    expect(q.visitors).toContain("'www.mymully.com'");
    expect(q.visitors).toContain("INTERVAL 30 DAY");
    expect(q.popup).toContain("'take_a_shot_claim'");
    expect(shotOrdersQuery("2026-10-12")).toBe("discount_code:SHOT* created_at:>=2026-10-12");
    expect(fmtPct(0.0026)).toBe("0.26%");
    expect(fmtPct(0.3846)).toBe("38%");
    expect(fmtPct(null)).toBe("—");
  });
});

function fixtureSources(overrides: Partial<Sources> = {}): Sources {
  return {
    fetchSignupEvents: async () => ({
      events: [signup("a", "shop-newsletter"), signup("b", "back-in-stock", "request", false), signup("c", "shop-edit-popup", "sms", false)],
      truncated: false,
    }),
    fetchProfileEvents: async (id) => ({
      events: id === "a" ? [ev(M.receivedEmail, 1, { $flow: "ShW6Z4" }), ev(M.clickedEmail, 2, { $flow: "ShW6Z4" })] : [],
      truncated: false,
    }),
    fetchExclusionProfileIds: async () => new Set<string>(),
    fetchFlowDefinitions: async () => WELCOME,
    fetchFlowReport: async () => ({
      rows: [{ flowId: "ShW6Z4", messageId: "m", recipients: 1, delivered: 1, opensUnique: 1, clicksUnique: 1, conversionUniques: 0, conversionValue: 0 }],
      truncated: false,
    }),
    fetchPosthog: async (days) => ({
      visitors: 500,
      popupCounts: { take_a_shot_open: 4, take_a_shot_start: 3, take_a_shot_email: 2, take_a_shot_claim: 2 },
      popupViewTracked: false,
      queries: posthogQueries(days),
    }),
    fetchShotRedemptions: async (since) => ({ orders: 0, codes: [], query: shotOrdersQuery(since) }),
    ...overrides,
  };
}

describe("buildFunnelReport", () => {
  const now = new Date("2026-11-11T20:00:00Z");

  it("assembles every section from injected sources", async () => {
    const r = await buildFunnelReport(30, { now, sources: fixtureSources() });
    expect(r.range.start).toBe("2026-10-12T20:00:00Z");
    expect(r.funnel.map((s) => s.count)).toEqual([500, null, 3, 1, 1, 0, 0]);
    expect(r.sources.find((s) => s.source === "back-in-stock")!.unrouted).toBe(true);
    expect(r.flows.find((f) => f.flowId === "ShW6Z4")!.openRate).toBe(1);
    expect(r.popup.map((s) => s.count)).toEqual([null, 4, 3, 2, 0, 0, 2, 0]);
    expect(r.leaks).toHaveLength(3);
    expect(r.routing.find((x) => x.flowId === "Yi5Z7a")!.sources).toEqual(["shop-edit-popup"]);
    expect(r.coverage.join(" ")).toContain("Popup views are not tracked yet");
    expect(r.issues).toEqual([]);
  });

  it("reports a failing source instead of inventing numbers", async () => {
    const r = await buildFunnelReport(7, {
      now,
      sources: fixtureSources({
        fetchPosthog: async () => {
          throw new Error("posthog_not_configured");
        },
      }),
    });
    expect(r.funnel[0].count).toBeNull();
    expect(r.issues).toEqual([{ source: "posthog", what: "traffic and popup events", error: "posthog_not_configured" }]);
  });
});

describe("GET /api/admin/email-funnel-live", () => {
  it("rejects requests without an admin token", async () => {
    const { GET } = await import("@/app/api/admin/email-funnel-live/route");
    const { NextRequest } = await import("next/server");
    const res = await GET(new NextRequest("http://localhost/api/admin/email-funnel-live?days=7"));
    expect(res.status).toBe(401);
  });
});
