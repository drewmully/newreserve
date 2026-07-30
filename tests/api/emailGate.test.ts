/**
 * Unit tests for the send gate — src/lib/email/gate.ts.
 *
 * Supabase and Firestore are both mocked. Nothing here touches a network.
 */

import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------- Supabase test double ----------

interface Call {
  table: string;
  op: "select" | "insert" | "update";
  payload?: Record<string, unknown>;
  filters: Record<string, unknown>;
}

interface Result {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number;
}

const CHAINABLE = ["select", "insert", "update", "ilike", "eq", "gte", "in", "limit", "or"];

let calls: Call[] = [];

/**
 * Minimal PostgREST-shaped builder: every filter returns `this`, and the
 * builder is thenable so `await sb.from(...).insert(...)` resolves.
 */
function makeSupabase(handler: (call: Call) => Result): SupabaseClient {
  return {
    from(table: string) {
      const call: Call = { table, op: "select", filters: {} };
      calls.push(call);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {};
      for (const name of CHAINABLE) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        builder[name] = vi.fn((...args: any[]) => {
          if (name === "insert" || name === "update") {
            call.op = name;
            call.payload = args[0] as Record<string, unknown>;
          }
          if (name === "eq" || name === "ilike" || name === "gte") {
            call.filters[String(args[0])] = args[1];
          }
          return builder;
        });
      }
      const run = () => Promise.resolve(handler(call));
      builder.single = vi.fn(() => run());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      builder.then = (onOk: any, onErr: any) => run().then(onOk, onErr);
      return builder;
    },
  } as unknown as SupabaseClient;
}

/** Rows returned per table. `send_log` selects resolve to a count. */
interface Fixture {
  suppression?: Record<string, unknown>[];
  customers?: Record<string, unknown>[];
  recentMarketingCount?: number;
  claimError?: { message: string; code?: string };
  activeFlows?: { flow: string }[];
}

function fixtureHandler(fx: Fixture) {
  return (call: Call): Result => {
    if (call.table === "suppression_list") return { data: fx.suppression ?? [], error: null };
    if (call.table === "customers") return { data: fx.customers ?? [], error: null };
    if (call.table === "send_log") {
      if (call.op === "select") return { count: fx.recentMarketingCount ?? 0, error: null };
      if (call.op === "insert") {
        if (fx.claimError && call.payload?.status === "queued") {
          return { data: null, error: fx.claimError };
        }
        return { data: { id: 4242 }, error: null };
      }
      return { error: null };
    }
    throw new Error(`unexpected table ${call.table}`);
  };
}

// ---------- Module mocks ----------

const getSupabaseServiceMock = vi.fn<() => SupabaseClient>();
const firestoreGetMock = vi.fn();
const firestoreWhereMock = vi.fn();

vi.mock("@/app/api/_lib/supabaseService", () => ({
  getSupabaseService: () => getSupabaseServiceMock(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  adminDb: {
    collection: () => {
      const chain = { where: firestoreWhereMock, get: firestoreGetMock };
      firestoreWhereMock.mockReturnValue(chain);
      return chain;
    },
  },
}));

async function loadGate() {
  return import("@/lib/email/gate");
}

function useFixture(fx: Fixture) {
  getSupabaseServiceMock.mockReturnValue(makeSupabase(fixtureHandler(fx)));
  firestoreGetMock.mockResolvedValue({
    docs: (fx.activeFlows ?? []).map((d) => ({ data: () => d })),
  });
}

const SUPPRESSED_ROW = {
  email: "member@example.com",
  channel: "email",
  scope: "all",
  reason: "bot_detection",
};

function sendLogInserts() {
  return calls.filter((c) => c.table === "send_log" && c.op === "insert");
}

beforeEach(() => {
  calls = [];
  getSupabaseServiceMock.mockReset();
  firestoreGetMock.mockReset();
  firestoreWhereMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------- Suppression ----------

describe("checkSend — suppression", () => {
  it("blocks a marketing send when the email is suppressed on the email channel", async () => {
    useFixture({ suppression: [SUPPRESSED_ROW] });
    const { checkSend } = await loadGate();

    const decision = await checkSend({ to: "member@example.com", sendClass: "campaign" });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("suppressed");
  });

  it("blocks a transactional send when scope is 'all'", async () => {
    useFixture({ suppression: [SUPPRESSED_ROW] });
    const { checkSend } = await loadGate();

    const decision = await checkSend({ to: "member@example.com", sendClass: "transactional" });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("suppressed");
  });

  it("lets a transactional send through when scope is only 'marketing'", async () => {
    useFixture({ suppression: [{ ...SUPPRESSED_ROW, scope: "marketing" }] });
    const { checkSend } = await loadGate();

    await expect(
      checkSend({ to: "member@example.com", sendClass: "transactional" })
    ).resolves.toEqual({ allowed: true });
  });

  it("still blocks a marketing send when scope is 'marketing'", async () => {
    useFixture({ suppression: [{ ...SUPPRESSED_ROW, scope: "marketing" }] });
    const { checkSend } = await loadGate();

    const decision = await checkSend({ to: "member@example.com", sendClass: "campaign" });
    expect(decision.reason).toBe("suppressed");
  });

  it("ignores an sms-only suppression for email sends", async () => {
    useFixture({ suppression: [{ ...SUPPRESSED_ROW, channel: "sms" }] });
    const { checkSend } = await loadGate();

    await expect(
      checkSend({ to: "member@example.com", sendClass: "campaign" })
    ).resolves.toEqual({ allowed: true });
  });

  it("honours channel 'both'", async () => {
    useFixture({ suppression: [{ ...SUPPRESSED_ROW, channel: "both" }] });
    const { checkSend } = await loadGate();

    const decision = await checkSend({ to: "member@example.com", sendClass: "campaign" });
    expect(decision.reason).toBe("suppressed");
  });

  it("matches suppression case-insensitively and lowercases the lookup", async () => {
    useFixture({ suppression: [{ ...SUPPRESSED_ROW, email: "Member@Example.COM" }] });
    const { checkSend } = await loadGate();

    const decision = await checkSend({ to: "  MEMBER@example.com ", sendClass: "campaign" });

    expect(decision.reason).toBe("suppressed");
    const lookup = calls.find((c) => c.table === "suppression_list");
    expect(lookup?.filters.email).toBe("member@example.com");
  });

  it("discards rows that only matched because of a LIKE metacharacter", async () => {
    // `ilike` treats `_` as a wildcard, so PostgREST can hand back a row for a
    // different address. The JS re-check has to drop it.
    useFixture({ suppression: [{ ...SUPPRESSED_ROW, email: "aXb@example.com" }] });
    const { checkSend } = await loadGate();

    await expect(
      checkSend({ to: "a_b@example.com", sendClass: "campaign" })
    ).resolves.toEqual({ allowed: true });
  });

  it("denies an empty recipient", async () => {
    useFixture({});
    const { checkSend } = await loadGate();

    const decision = await checkSend({ to: "   ", sendClass: "transactional" });
    expect(decision.allowed).toBe(false);
  });
});

// ---------- Consent ----------

describe("checkSend — consent", () => {
  it("denies marketing when accepts_email_marketing is false", async () => {
    useFixture({
      customers: [{ id: 7, email: "member@example.com", accepts_email_marketing: false }],
    });
    const { checkSend } = await loadGate();

    const decision = await checkSend({ to: "member@example.com", sendClass: "campaign" });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("no_consent");
  });

  it("exempts transactional from the consent check", async () => {
    useFixture({
      customers: [{ id: 7, email: "member@example.com", accepts_email_marketing: false }],
    });
    const { checkSend } = await loadGate();

    await expect(
      checkSend({ to: "member@example.com", sendClass: "transactional" })
    ).resolves.toEqual({ allowed: true });
  });

  it("treats unknown consent as allowed", async () => {
    useFixture({
      customers: [{ id: 7, email: "member@example.com", accepts_email_marketing: null }],
    });
    const { checkSend } = await loadGate();

    await expect(
      checkSend({ to: "member@example.com", sendClass: "campaign" })
    ).resolves.toEqual({ allowed: true });
  });

  it("allows marketing to an address with no customer row", async () => {
    useFixture({ customers: [] });
    const { checkSend } = await loadGate();

    await expect(
      checkSend({ to: "prospect@example.com", sendClass: "campaign" })
    ).resolves.toEqual({ allowed: true });
  });
});

// ---------- Frequency cap ----------

describe("checkSend — frequency cap", () => {
  it("denies a fourth marketing message in the trailing week", async () => {
    useFixture({ recentMarketingCount: 3 });
    const { checkSend } = await loadGate();

    const decision = await checkSend({ to: "member@example.com", sendClass: "campaign" });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("frequency_cap");
  });

  it("allows the third marketing message", async () => {
    useFixture({ recentMarketingCount: 2 });
    const { checkSend } = await loadGate();

    await expect(
      checkSend({ to: "member@example.com", sendClass: "campaign" })
    ).resolves.toEqual({ allowed: true });
  });

  it("counts only marketing-scoped rows over a seven day window", async () => {
    useFixture({ recentMarketingCount: 0 });
    const { checkSend } = await loadGate();

    await checkSend({ to: "member@example.com", sendClass: "lifecycle", flow: "reserve" });

    const countQuery = calls.find((c) => c.table === "send_log" && c.op === "select");
    expect(countQuery?.filters.scope).toBe("marketing");
    expect(countQuery?.filters.status).toBe("sent");
    const since = new Date(String(countQuery?.filters.sent_at)).getTime();
    expect(Date.now() - since).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -4);
  });

  it("exempts transactional from the cap", async () => {
    useFixture({ recentMarketingCount: 99 });
    const { checkSend } = await loadGate();

    await expect(
      checkSend({ to: "member@example.com", sendClass: "transactional" })
    ).resolves.toEqual({ allowed: true });
  });
});

// ---------- Flow exclusivity ----------

describe("checkSend — flow exclusivity", () => {
  it("denies a lower-priority flow when a higher-priority one is active", async () => {
    useFixture({ activeFlows: [{ flow: "member" }] });
    const { checkSend } = await loadGate();

    const decision = await checkSend({
      to: "member@example.com",
      sendClass: "lifecycle",
      flow: "reserve",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("wrong_flow");
  });

  it("allows a higher-priority flow to send over a lower-priority enrollment", async () => {
    useFixture({ activeFlows: [{ flow: "reserve" }] });
    const { checkSend } = await loadGate();

    await expect(
      checkSend({ to: "member@example.com", sendClass: "lifecycle", flow: "abandon" })
    ).resolves.toEqual({ allowed: true });
  });

  it("allows a send for the flow the person is actually enrolled in", async () => {
    useFixture({ activeFlows: [{ flow: "reserve" }] });
    const { checkSend } = await loadGate();

    await expect(
      checkSend({ to: "member@example.com", sendClass: "lifecycle", flow: "reserve", step: 2 })
    ).resolves.toEqual({ allowed: true });
  });

  it("denies when an equal-priority sibling flow is active", async () => {
    useFixture({ activeFlows: [{ flow: "member" }] });
    const { checkSend } = await loadGate();

    const decision = await checkSend({
      to: "member@example.com",
      sendClass: "lifecycle",
      flow: "access",
    });
    expect(decision.reason).toBe("wrong_flow");
  });

  it("treats an unrecognised active flow as outranking everything", async () => {
    useFixture({ activeFlows: [{ flow: "mystery_flow" }] });
    const { checkSend } = await loadGate();

    const decision = await checkSend({
      to: "member@example.com",
      sendClass: "lifecycle",
      flow: "member",
    });
    expect(decision.reason).toBe("wrong_flow");
  });

  it("does not apply flow exclusivity to campaign or transactional sends", async () => {
    useFixture({ activeFlows: [{ flow: "member" }] });
    const { checkSend } = await loadGate();

    await expect(
      checkSend({ to: "member@example.com", sendClass: "campaign" })
    ).resolves.toEqual({ allowed: true });
    expect(firestoreGetMock).not.toHaveBeenCalled();
  });
});

// ---------- Fail open / fail closed ----------

describe("checkSend — database unavailable", () => {
  beforeEach(() => {
    getSupabaseServiceMock.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
    });
  });

  it("fails OPEN for transactional so a password reset still goes out", async () => {
    const { checkSend } = await loadGate();

    const decision = await checkSend({ to: "member@example.com", sendClass: "transactional" });
    expect(decision.allowed).toBe(true);
  });

  it("fails CLOSED for campaign so a blast can never escape", async () => {
    const { checkSend } = await loadGate();

    const decision = await checkSend({ to: "member@example.com", sendClass: "campaign" });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("gate_unavailable");
  });

  it("fails CLOSED for lifecycle, which is marketing too", async () => {
    const { checkSend } = await loadGate();

    const decision = await checkSend({
      to: "member@example.com",
      sendClass: "lifecycle",
      flow: "reserve",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("gate_unavailable");
  });

  it("fails CLOSED for lifecycle when Firestore is the thing that is down", async () => {
    useFixture({});
    firestoreGetMock.mockRejectedValue(new Error("firestore unavailable"));
    const { checkSend } = await loadGate();

    const decision = await checkSend({
      to: "member@example.com",
      sendClass: "lifecycle",
      flow: "reserve",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("gate_unavailable");
  });
});

// ---------- gatedSend: logging and the claim ----------

describe("gatedSend", () => {
  it("never supplies `id` on a send_log insert", async () => {
    useFixture({});
    const { gatedSend } = await loadGate();

    await gatedSend({ to: "member@example.com", sendClass: "transactional" }, async () => "msg_1");

    const inserts = sendLogInserts();
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).not.toHaveProperty("id");
  });

  it("logs a denial as skipped_suppressed with the real reason in `error`", async () => {
    useFixture({ recentMarketingCount: 5 });
    const send = vi.fn();
    const { gatedSend } = await loadGate();

    const result = await gatedSend(
      { to: "member@example.com", sendClass: "campaign", campaignId: "spring_blast" },
      send
    );

    expect(result).toBeNull();
    expect(send).not.toHaveBeenCalled();
    const [insert] = sendLogInserts();
    expect(insert.payload).toMatchObject({
      status: "skipped_suppressed",
      error: "frequency_cap",
      scope: "marketing",
      channel: "email",
      provider: "resend",
      entity: "mully",
      campaign_id: "spring_blast",
    });
    expect(insert.payload).not.toHaveProperty("id");
  });

  it("maps lifecycle to scope 'marketing' and records the step", async () => {
    useFixture({});
    const { gatedSend } = await loadGate();

    await gatedSend(
      { to: "member@example.com", sendClass: "lifecycle", flow: "reserve", step: 2 },
      async () => "msg_2"
    );

    const [claim] = sendLogInserts();
    expect(claim.payload).toMatchObject({
      scope: "marketing",
      status: "queued",
      step_index: 2,
      template_key: "flow_reserve",
      dedupe_key: "flow_reserve:member@example.com:2",
      sent_at: null,
    });
  });

  it("maps transactional to scope 'transactional' and leaves dedupe_key null without a key", async () => {
    useFixture({});
    const { gatedSend } = await loadGate();

    await gatedSend({ to: "member@example.com", sendClass: "transactional" }, async () => "m");

    const [claim] = sendLogInserts();
    expect(claim.payload).toMatchObject({ scope: "transactional", dedupe_key: null });
  });

  it("resolves customer_id from the customers table", async () => {
    useFixture({
      customers: [{ id: 91, email: "member@example.com", accepts_email_marketing: true }],
    });
    const { gatedSend } = await loadGate();

    await gatedSend({ to: "member@example.com", sendClass: "transactional" }, async () => "m");

    expect(sendLogInserts()[0].payload).toMatchObject({ customer_id: 91 });
  });

  it("leaves customer_id null rather than failing when the address is unknown", async () => {
    useFixture({ customers: [] });
    const { gatedSend } = await loadGate();

    const id = await gatedSend(
      { to: "stranger@example.com", sendClass: "transactional" },
      async () => "m"
    );

    expect(id).toBe("m");
    expect(sendLogInserts()[0].payload).toMatchObject({ customer_id: null });
  });

  it("does not send when the dedupe_key claim hits a unique violation", async () => {
    useFixture({
      claimError: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    const send = vi.fn().mockResolvedValue("msg_3");
    const { gatedSend } = await loadGate();

    const result = await gatedSend(
      { to: "member@example.com", sendClass: "lifecycle", flow: "reserve", step: 1 },
      send
    );

    expect(result).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("settles the claimed row as sent with the provider message id", async () => {
    useFixture({});
    const { gatedSend } = await loadGate();

    const id = await gatedSend(
      { to: "member@example.com", sendClass: "transactional" },
      async () => "provider_abc"
    );

    expect(id).toBe("provider_abc");
    const update = calls.find((c) => c.table === "send_log" && c.op === "update");
    expect(update?.payload).toMatchObject({
      status: "sent",
      provider_message_id: "provider_abc",
    });
    expect(update?.filters.id).toBe(4242);
  });

  it("settles as failed, releases the dedupe claim, and rethrows on a provider error", async () => {
    useFixture({});
    const { gatedSend } = await loadGate();

    await expect(
      gatedSend({ to: "member@example.com", sendClass: "transactional" }, async () => {
        throw new Error("Resend error: rate limited");
      })
    ).rejects.toThrow("rate limited");

    const update = calls.find((c) => c.table === "send_log" && c.op === "update");
    expect(update?.payload).toMatchObject({ status: "failed", dedupe_key: null });
    expect(String(update?.payload?.error)).toContain("rate limited");
  });

  it("sends without a log row when the database is down and the send is transactional", async () => {
    getSupabaseServiceMock.mockImplementation(() => {
      throw new Error("supabase down");
    });
    const send = vi.fn().mockResolvedValue("msg_4");
    const { gatedSend } = await loadGate();

    const result = await gatedSend({ to: "member@example.com", sendClass: "transactional" }, send);

    expect(result).toBe("msg_4");
    expect(send).toHaveBeenCalledOnce();
  });

  it("blocks the send and writes nothing when the database is down and the send is a campaign", async () => {
    getSupabaseServiceMock.mockImplementation(() => {
      throw new Error("supabase down");
    });
    const send = vi.fn();
    const { gatedSend } = await loadGate();

    const result = await gatedSend({ to: "member@example.com", sendClass: "campaign" }, send);

    expect(result).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(sendLogInserts()).toHaveLength(0);
  });

  it("fails closed for a campaign when the claim insert errors for a non-duplicate reason", async () => {
    useFixture({ claimError: { code: "42501", message: "permission denied" } });
    const send = vi.fn();
    const { gatedSend } = await loadGate();

    const result = await gatedSend({ to: "member@example.com", sendClass: "campaign" }, send);

    expect(result).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
