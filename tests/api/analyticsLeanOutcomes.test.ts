import { describe, expect, it, vi, beforeEach } from "vitest";
import { assessCompletion, canCheckpoint } from "@/lib/analytics/outcomes";
const mocks = vi.hoisted(() => ({ updates: [] as Record<string, unknown>[], fail: false }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: 1 }, error: null }) }) }),
      update: (row: Record<string, unknown>) => {
        mocks.updates.push(row);
        return { eq: async () => ({ error: mocks.fail ? { message: "db unavailable" } : null }) };
      },
    }),
  }),
}));
import { withJobRun } from "@/app/api/_lib/supabaseService";
const complete = { paginationComplete: true, writesComplete: true, schemaValid: true, sourceRows: 1, writtenRows: 1, evidenceRef: "fixture" };
beforeEach(() => { mocks.updates.length = 0; mocks.fail = false; process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic"; });
describe("truthful shared job wrapper", () => {
  it.each(["missing_auth", "partial", "schema_drift", "failed", "unverified"] as const)("never checkpoints %s", outcome => {
    expect(canCheckpoint(outcome)).toBe(false);
  });
  it("distinguishes verified empty from failed pagination and schema drift", () => {
    expect(assessCompletion({ ...complete, sourceRows: 0, writtenRows: 0 })).toBe("verified_empty");
    expect(assessCompletion({ ...complete, paginationComplete: false })).toBe("partial");
    expect(assessCompletion({ ...complete, schemaValid: false })).toBe("schema_drift");
  });
  it("does not turn a normal return into completeness evidence", async () => {
    expect((await withJobRun("fixture", async c => { c.setWatermark("unsafe"); return { rows: 3 }; })).ok).toBe(false);
    expect(mocks.updates[0].watermark).toBeNull();
  });
  it("reports missing auth instead of a green skipped run", async () => {
    const result = await withJobRun("fixture", async () => ({ skipped: true, missing: ["TOKEN"] }));
    expect(result.ok).toBe(false);
    expect(mocks.updates[0].meta).toMatchObject({ analytics_outcome: "missing_auth" });
  });
  it("commits a proposed checkpoint only with explicit successful evidence", async () => {
    expect((await withJobRun("fixture", async c => { c.setWatermark("next"); c.complete(complete); return 1; })).ok).toBe(true);
    expect(mocks.updates[0].watermark).toBe("next");
  });
  it("clears a proposed watermark on a thrown partial write", async () => {
    await withJobRun("fixture", async c => { c.setWatermark("unsafe"); throw new Error("write failed"); });
    expect(mocks.updates[0].watermark).toBeNull();
  });
  it("fails loudly if status writes themselves fail", async () => {
    mocks.fail = true;
    await expect(withJobRun("fixture", async () => 1)).rejects.toThrow("could not be persisted");
  });
});
