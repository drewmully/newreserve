import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseServiceMock = vi.fn();
const firestoreCollectionMock = vi.fn();

vi.mock("@/app/api/_lib/supabaseService", () => ({
  getSupabaseService: getSupabaseServiceMock,
}));

vi.mock("@/lib/firebase-admin", () => ({
  adminDb: {
    collection: firestoreCollectionMock,
  },
}));

interface QueryResult {
  data?: unknown;
  error?: { message: string } | null;
  count?: number | null;
}

/** Recorded filter call, e.g. `["eq", "email", "a@b.com"]`. */
type FilterCall = [string, ...unknown[]];

const CHAIN_METHODS = ["select", "eq", "in", "gte", "lte", "limit", "order"];

/**
 * Minimal stand-in for the supabase-js query builder: every filter method is
 * chainable and the builder itself is awaitable, which is how the real client
 * behaves.
 */
function makeSupabaseStub(responses: Record<string, QueryResult>) {
  const filterCalls: Record<string, FilterCall[]> = {};
  const inserted: { table: string; row: unknown }[] = [];

  const resolve = (key: string): QueryResult =>
    responses[key] ?? { data: [], error: null, count: 0 };

  const client = {
    from: vi.fn((table: string) => {
      filterCalls[table] ??= [];
      const chain: Record<string, unknown> = {};
      for (const method of CHAIN_METHODS) {
        chain[method] = vi.fn((...args: unknown[]) => {
          filterCalls[table].push([method, ...args]);
          return chain;
        });
      }
      chain.insert = vi.fn((row: unknown) => {
        inserted.push({ table, row });
        return {
          then: (ok: (v: QueryResult) => unknown, fail?: (e: unknown) => unknown) =>
            Promise.resolve(resolve(`${table}:insert`)).then(ok, fail),
        };
      });
      chain.then = (ok: (v: QueryResult) => unknown, fail?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(table)).then(ok, fail);
      return chain;
    }),
  };

  return { client, filterCalls, inserted };
}

/** Stubs `email_sequences` query results. `flows` become one active doc each. */
function stubFirestore(flows: (string | undefined)[], err?: Error) {
  const get = vi.fn(() =>
    err
      ? Promise.reject(err)
      : Promise.resolve({
          docs: flows.map((flow) => ({ data: () => ({ flow }) })),
        })
  );
  const where = vi.fn(() => ({ where, get }));
  firestoreCollectionMock.mockReturnValue({ where, get });
  return { where, get };
}

async function loadGate() {
  vi.resetModules();
  return import("@/lib/email/gate");
}

const SUPPRESSED_ROW = { data: [{ scope: "all", reason: "bot_detection" }], error: null };
const DB_DOWN = { error: { message: "connection refused" } };

describe("send gate", () => {
  beforeEach(() => {
    getSupabaseServiceMock.mockReset();
    firestoreCollectionMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFirestore([]);
  });

  function useSupabase(responses: Record<string, QueryResult> = {}) {
    const stub = makeSupabaseStub(responses);
    getSupabaseServiceMock.mockReturnValue(stub.client);
    return stub;
  }

  describe("suppression", () => {
    it("denies a campaign send when the address is on the suppression list", async () => {
      useSupabase({ suppression_list: SUPPRESSED_ROW });
      const { checkSend } = await loadGate();

      const decision = await checkSend({
        to: "blocked@example.com",
        sendClass: "campaign",
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("suppressed");
      expect(decision.detail).toContain("bot_detection");
    });

    it("denies transactional too — scope='all' is not exempt", async () => {
      useSupabase({ suppression_list: SUPPRESSED_ROW });
      const { checkSend } = await loadGate();

      const decision = await checkSend({
        to: "blocked@example.com",
        sendClass: "transactional",
      });

      expect(decision).toMatchObject({ allowed: false, reason: "suppressed" });
    });

    it("queries the lowercased address against the email and all scopes", async () => {
      const stub = useSupabase();
      const { checkSend } = await loadGate();

      await checkSend({ to: "  MiXeD@Example.COM ", sendClass: "transactional" });

      expect(stub.filterCalls.suppression_list).toEqual(
        expect.arrayContaining([
          ["eq", "email", "mixed@example.com"],
          ["in", "scope", ["all", "email"]],
        ])
      );
    });

    it("denies an empty recipient outright", async () => {
      useSupabase();
      const { checkSend } = await loadGate();

      const decision = await checkSend({ to: "   ", sendClass: "transactional" });

      expect(decision.allowed).toBe(false);
      expect(getSupabaseServiceMock).not.toHaveBeenCalled();
    });
  });

  describe("consent", () => {
    it("denies when accepts_email_marketing is false", async () => {
      useSupabase({ customers: { data: [{ accepts_email_marketing: false }], error: null } });
      const { checkSend } = await loadGate();

      const decision = await checkSend({
        to: "optout@example.com",
        sendClass: "campaign",
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("no_consent");
    });

    it("denies when any one of several customer rows says false", async () => {
      useSupabase({
        customers: {
          data: [{ accepts_email_marketing: null }, { accepts_email_marketing: false }],
          error: null,
        },
      });
      const { checkSend } = await loadGate();

      const decision = await checkSend({ to: "dupe@example.com", sendClass: "campaign" });

      expect(decision).toMatchObject({ allowed: false, reason: "no_consent" });
    });

    it("allows and logs when consent is unknown (null)", async () => {
      useSupabase({ customers: { data: [{ accepts_email_marketing: null }], error: null } });
      const { checkSend } = await loadGate();

      const decision = await checkSend({ to: "unknown@example.com", sendClass: "campaign" });

      expect(decision.allowed).toBe(true);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("unknown email-marketing consent")
      );
    });

    it("does not consult consent for transactional sends", async () => {
      const stub = useSupabase({
        customers: { data: [{ accepts_email_marketing: false }], error: null },
      });
      const { checkSend } = await loadGate();

      const decision = await checkSend({ to: "optout@example.com", sendClass: "transactional" });

      expect(decision.allowed).toBe(true);
      expect(stub.client.from).not.toHaveBeenCalledWith("customers");
    });
  });

  describe("frequency cap", () => {
    it("denies a lifecycle send at 3 sends in the trailing week", async () => {
      useSupabase({ send_log: { count: 3, error: null } });
      const { checkSend } = await loadGate();

      const decision = await checkSend({
        to: "chatty@example.com",
        sendClass: "lifecycle",
        flow: "reserve",
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("frequency_cap");
      expect(decision.detail).toContain("cap 3");
    });

    it("allows at 2 sends", async () => {
      useSupabase({ send_log: { count: 2, error: null } });
      const { checkSend } = await loadGate();

      const decision = await checkSend({
        to: "chatty@example.com",
        sendClass: "lifecycle",
        flow: "reserve",
      });

      expect(decision.allowed).toBe(true);
    });

    it("exempts transactional from the cap", async () => {
      const stub = useSupabase({ send_log: { count: 99, error: null } });
      const { checkSend } = await loadGate();

      const decision = await checkSend({ to: "chatty@example.com", sendClass: "transactional" });

      expect(decision.allowed).toBe(true);
      expect(stub.client.from).not.toHaveBeenCalledWith("send_log");
    });

    it("counts a trailing 7-day window", async () => {
      const stub = useSupabase({ send_log: { count: 0, error: null } });
      const { checkSend } = await loadGate();

      await checkSend({ to: "a@example.com", sendClass: "campaign" });

      const gte = stub.filterCalls.send_log.find((c) => c[0] === "gte");
      expect(gte?.[1]).toBe("sent_at");
      const cutoff = new Date(gte?.[2] as string).getTime();
      const expected = Date.now() - 7 * 24 * 60 * 60 * 1000;
      expect(Math.abs(cutoff - expected)).toBeLessThan(5000);
    });
  });

  describe("flow exclusivity", () => {
    it("denies a lower-priority flow when a higher-priority one is active", async () => {
      useSupabase();
      stubFirestore(["member"]);
      const { checkSend } = await loadGate();

      const decision = await checkSend({
        to: "member@example.com",
        sendClass: "lifecycle",
        flow: "reserve",
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("wrong_flow");
      expect(decision.detail).toContain("member");
    });

    it("denies an equal-priority sibling flow (access vs member)", async () => {
      useSupabase();
      stubFirestore(["member"]);
      const { checkSend } = await loadGate();

      const decision = await checkSend({
        to: "member@example.com",
        sendClass: "lifecycle",
        flow: "access",
      });

      expect(decision).toMatchObject({ allowed: false, reason: "wrong_flow" });
    });

    it("allows the flow the person is actually enrolled in", async () => {
      useSupabase();
      stubFirestore(["reserve"]);
      const { checkSend } = await loadGate();

      const decision = await checkSend({
        to: "prospect@example.com",
        sendClass: "lifecycle",
        flow: "reserve",
      });

      expect(decision.allowed).toBe(true);
    });

    it("allows a higher-priority flow to talk over a lower-priority enrollment", async () => {
      useSupabase();
      stubFirestore(["reserve"]);
      const { checkSend } = await loadGate();

      const decision = await checkSend({
        to: "converted@example.com",
        sendClass: "lifecycle",
        flow: "member",
      });

      expect(decision.allowed).toBe(true);
    });

    it("denies an unrecognized flow against any active enrollment", async () => {
      useSupabase();
      stubFirestore(["reserve"]);
      const { checkSend } = await loadGate();

      const decision = await checkSend({
        to: "prospect@example.com",
        sendClass: "lifecycle",
        flow: "some_new_experiment",
      });

      expect(decision).toMatchObject({ allowed: false, reason: "wrong_flow" });
    });

    it("allows when nobody is enrolled anywhere", async () => {
      useSupabase();
      stubFirestore([]);
      const { checkSend } = await loadGate();

      const decision = await checkSend({
        to: "nobody@example.com",
        sendClass: "lifecycle",
        flow: "reserve",
      });

      expect(decision.allowed).toBe(true);
    });

    it("does not consult Firestore for campaign or transactional sends", async () => {
      useSupabase();
      stubFirestore(["member"]);
      const { checkSend } = await loadGate();

      await checkSend({ to: "member@example.com", sendClass: "campaign", flow: "reserve" });
      await checkSend({ to: "member@example.com", sendClass: "transactional" });

      expect(firestoreCollectionMock).not.toHaveBeenCalled();
    });

    it("matches both the raw and lowercased address, since Firestore stores it unnormalized", async () => {
      useSupabase();
      const { where } = stubFirestore([]);
      const { checkSend } = await loadGate();

      await checkSend({ to: "MiXeD@Example.com", sendClass: "lifecycle", flow: "reserve" });

      expect(where).toHaveBeenCalledWith("email", "in", [
        "mixed@example.com",
        "MiXeD@Example.com",
      ]);
      expect(where).toHaveBeenCalledWith("status", "==", "active");
    });
  });

  describe("fail-open / fail-closed", () => {
    it("fails OPEN for transactional when Supabase is unreachable", async () => {
      useSupabase({ suppression_list: DB_DOWN });
      const { checkSend } = await loadGate();

      const decision = await checkSend({ to: "reset@example.com", sendClass: "transactional" });

      expect(decision.allowed).toBe(true);
      expect(decision.detail).toContain("fail_open");
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("failing OPEN"));
    });

    it("fails CLOSED for campaign when Supabase is unreachable", async () => {
      useSupabase({ suppression_list: DB_DOWN });
      const { checkSend } = await loadGate();

      const decision = await checkSend({ to: "blast@example.com", sendClass: "campaign" });

      expect(decision.allowed).toBe(false);
      expect(decision.detail).toContain("fail_closed");
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("failing CLOSED"));
    });

    it("fails CLOSED for lifecycle when Supabase is unreachable", async () => {
      useSupabase({ suppression_list: DB_DOWN });
      const { checkSend } = await loadGate();

      const decision = await checkSend({
        to: "drip@example.com",
        sendClass: "lifecycle",
        flow: "reserve",
      });

      expect(decision.allowed).toBe(false);
      expect(decision.detail).toContain("fail_closed");
    });

    it("fails OPEN for transactional when the Supabase client cannot even be built", async () => {
      getSupabaseServiceMock.mockImplementation(() => {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
      });
      const { checkSend } = await loadGate();

      const decision = await checkSend({ to: "reset@example.com", sendClass: "transactional" });

      expect(decision.allowed).toBe(true);
    });

    it("fails CLOSED for campaign when the consent lookup breaks", async () => {
      useSupabase({ customers: DB_DOWN });
      const { checkSend } = await loadGate();

      const decision = await checkSend({ to: "blast@example.com", sendClass: "campaign" });

      expect(decision.allowed).toBe(false);
      expect(decision.detail).toContain("customers_unavailable");
    });

    it("fails CLOSED for campaign when the send_log count breaks", async () => {
      useSupabase({ send_log: DB_DOWN });
      const { checkSend } = await loadGate();

      const decision = await checkSend({ to: "blast@example.com", sendClass: "campaign" });

      expect(decision.allowed).toBe(false);
      expect(decision.detail).toContain("send_log_unavailable");
    });

    it("fails CLOSED for lifecycle when Firestore is unreachable", async () => {
      useSupabase();
      stubFirestore([], new Error("firestore deadline exceeded"));
      const { checkSend } = await loadGate();

      const decision = await checkSend({
        to: "drip@example.com",
        sendClass: "lifecycle",
        flow: "reserve",
      });

      expect(decision.allowed).toBe(false);
      expect(decision.detail).toContain("email_sequences_unavailable");
    });
  });

  describe("recordSend", () => {
    it("appends a normalized row to send_log", async () => {
      const stub = useSupabase();
      const { recordSend } = await loadGate();

      await recordSend(
        {
          to: "Logged@Example.com",
          sendClass: "lifecycle",
          flow: "reserve",
          category: "abandon_nudge",
          step: 2,
        },
        "resend-msg-1"
      );

      expect(stub.inserted).toEqual([
        {
          table: "send_log",
          row: {
            email: "logged@example.com",
            phone_e164: null,
            send_class: "lifecycle",
            flow: "reserve",
            category: "abandon_nudge",
            step: 2,
            provider: "resend",
            provider_message_id: "resend-msg-1",
          },
        },
      ]);
    });

    it("nulls the optional columns and tolerates a missing provider id", async () => {
      const stub = useSupabase();
      const { recordSend } = await loadGate();

      await recordSend({ to: "a@example.com", sendClass: "transactional" }, null);

      expect(stub.inserted[0].row).toMatchObject({
        flow: null,
        category: null,
        step: null,
        provider_message_id: null,
      });
    });

    it("never throws when the insert fails — the email is already gone", async () => {
      useSupabase({ "send_log:insert": DB_DOWN });
      const { recordSend } = await loadGate();

      await expect(
        recordSend({ to: "a@example.com", sendClass: "campaign" }, "id-1")
      ).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("FAILED to record send")
      );
    });
  });
});
