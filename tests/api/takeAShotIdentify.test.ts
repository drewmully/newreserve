import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase-admin", () => ({ adminDb: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) } }));

import { identifiesPlayer, send } from "@/lib/takeAShot/http";
import type { ApiResult } from "@/lib/takeAShot/service";

const session = { sid: "s1" } as never;

describe("Take a Shot identity cookie gate", () => {
  it("identifies new games and own resumed or finished games only", () => {
    expect(identifiesPlayer({ status: "new", session, claim: null })).toBe(true);
    expect(identifiesPlayer({ status: "resume", session, claim: null, identify: true })).toBe(true);
    expect(identifiesPlayer({ status: "existing", claim: null, emailed: false, identify: true })).toBe(true);
    expect(identifiesPlayer({ status: "resume", session, claim: null, identify: false })).toBe(false);
    expect(identifiesPlayer({ status: "existing", claim: null, emailed: true, identify: false })).toBe(false);
    expect(identifiesPlayer({ status: "existing", claim: null, emailed: true })).toBe(false);
    expect(identifiesPlayer({ status: "ok" })).toBe(false);
    expect(identifiesPlayer({ status: "error", error: "x" })).toBe(false);
  });

  it("never sends the identify flag to the browser", async () => {
    for (const r of [
      { status: "existing", claim: null, emailed: true, identify: true },
      { status: "resume", session, claim: null, identify: false },
    ] as ApiResult[]) {
      const body = await send(r).json();
      expect(body).not.toHaveProperty("identify");
      expect(body.status).toBe(r.status);
    }
  });
});
