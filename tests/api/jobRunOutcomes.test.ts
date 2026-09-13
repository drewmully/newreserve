import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: Array<Record<string, unknown>> = [];

const fakeClient = {
  from(table: string) {
    if (table !== "job_runs") throw new Error(`Unexpected table ${table}`);
    return {
      insert() {
        return {
          select() {
            return {
              single: async () => ({ data: { id: 41 }, error: null }),
            };
          },
        };
      },
      update(payload: Record<string, unknown>) {
        updates.push(payload);
        return {
          eq: async () => ({ data: null, error: null }),
        };
      },
    };
  },
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => fakeClient,
}));

import {
  summarizeSourceOutcomes,
  withJobRun,
} from "@/app/api/_lib/supabaseService";

describe("job run outcomes", () => {
  beforeEach(() => {
    updates.length = 0;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });

  it("records a skipped return as unhealthy and suppresses its watermark", async () => {
    const result = await withJobRun("fixture-skip", async ({ setMeta, setOutcome, setWatermark }) => {
      setWatermark("should-not-advance");
      setMeta({ source: "fixture" });
      setOutcome("skipped");
      return { skipped: true };
    });

    expect(result).toEqual({
      ok: false,
      outcome: "skipped",
      runId: 41,
      result: { skipped: true },
    });
    expect(updates).toEqual([
      expect.objectContaining({
        status: "error",
        watermark: null,
        meta: { source: "fixture", outcome: "skipped" },
      }),
    ]);
  });

  it("keeps a genuine empty result healthy and records thrown work as failed", async () => {
    const empty = await withJobRun("fixture-empty", async ({ setOutcome }) => {
      setOutcome("empty");
      return { rows: 0 };
    });
    const failed = await withJobRun("fixture-failed", async ({ setWatermark }) => {
      setWatermark("should-not-advance");
      throw new Error("fixture unavailable");
    });

    expect(empty).toEqual({
      ok: true,
      outcome: "empty",
      runId: 41,
      result: { rows: 0 },
    });
    expect(failed).toEqual({
      ok: false,
      outcome: "failed",
      runId: 41,
      error: "fixture unavailable",
    });
    expect(updates.map(({ status, meta, watermark }) => ({ status, meta, watermark }))).toEqual([
      { status: "ok", meta: { outcome: "empty" }, watermark: null },
      { status: "error", meta: { outcome: "failed" }, watermark: null },
    ]);
  });

  it.each([
    [["success", "empty"], "success"],
    [["empty", "empty"], "empty"],
    [["success", "skipped"], "partial"],
    [["empty", "failed"], "partial"],
    [["skipped", "skipped"], "skipped"],
    [["skipped", "failed"], "failed"],
  ] as const)("summarizes %j sources as %s", (sources, expected) => {
    expect(summarizeSourceOutcomes([...sources])).toBe(expected);
  });
});
