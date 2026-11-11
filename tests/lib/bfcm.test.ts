import { describe, it, expect } from "vitest";
import {
  BFCM_QA_NOW,
  BFCM_WINDOWS,
  bfcmOverrideAllowed,
  bfcmPhase,
  isInWindow,
  mysteryBoxAccess,
  nextBfcmBoundary,
  parseBfcmNow,
  resolveBfcmNow,
} from "@/lib/bfcm";

const at = (iso: string) => new Date(iso);
const justBefore = (iso: string) => new Date(Date.parse(iso) - 1);

describe("bfcmPhase boundaries (ET)", () => {
  const cases: Array<[string, Date, ReturnType<typeof bfcmPhase>]> = [
    ["11/22 23:59:59.999", justBefore("2026-11-23T00:00:00-05:00"), null],
    ["11/23 00:00", at("2026-11-23T00:00:00-05:00"), "members_first"],
    ["11/26 11:59:59.999", justBefore("2026-11-26T12:00:00-05:00"), "members_first"],
    ["11/26 12:00 noon", at("2026-11-26T12:00:00-05:00"), "early_access"],
    ["11/26 23:59:59.999", justBefore("2026-11-27T00:00:00-05:00"), "early_access"],
    ["11/27 00:00", at("2026-11-27T00:00:00-05:00"), "bf"],
    ["11/29 23:59:59.999", justBefore("2026-11-30T00:00:00-05:00"), "bf"],
    ["11/30 00:00", at("2026-11-30T00:00:00-05:00"), "cm"],
    ["12/1 23:59:59.999", justBefore("2026-12-02T00:00:00-05:00"), "cm"],
    ["12/2 00:00", at("2026-12-02T00:00:00-05:00"), null],
  ];
  it.each(cases)("%s", (_label, now, phase) => {
    expect(bfcmPhase(now)).toBe(phase);
  });

  it("noon ET on 11/26 is 17:00 UTC", () => {
    expect(bfcmPhase(at("2026-11-26T16:59:59.999Z"))).toBe("members_first");
    expect(bfcmPhase(at("2026-11-26T17:00:00Z"))).toBe("early_access");
  });

  it("midnight ET is 05:00 UTC, not UTC midnight", () => {
    expect(bfcmPhase(at("2026-11-23T00:00:00Z"))).toBeNull();
    expect(bfcmPhase(at("2026-11-23T04:59:59.999Z"))).toBeNull();
    expect(bfcmPhase(at("2026-11-23T05:00:00Z"))).toBe("members_first");
    expect(bfcmPhase(at("2026-12-02T04:59:59.999Z"))).toBe("cm");
    expect(bfcmPhase(at("2026-12-02T05:00:00Z"))).toBeNull();
  });

  it("accepts epoch ms", () => {
    expect(bfcmPhase(Date.parse(BFCM_QA_NOW.bf))).toBe("bf");
  });

  it("QA presets map to their phase", () => {
    expect(bfcmPhase(at(BFCM_QA_NOW.before))).toBeNull();
    expect(bfcmPhase(at(BFCM_QA_NOW.members_first))).toBe("members_first");
    expect(bfcmPhase(at(BFCM_QA_NOW.early_access))).toBe("early_access");
    expect(bfcmPhase(at(BFCM_QA_NOW.bf))).toBe("bf");
    expect(bfcmPhase(at(BFCM_QA_NOW.cm))).toBe("cm");
    expect(bfcmPhase(at(BFCM_QA_NOW.after))).toBeNull();
  });
});

describe("windows", () => {
  it("every window is written with an explicit ET offset", () => {
    for (const w of Object.values(BFCM_WINDOWS)) {
      expect(w.start).toMatch(/-05:00$/);
      expect(w.end).toMatch(/-05:00$/);
      expect(Date.parse(w.start)).toBeLessThan(Date.parse(w.end));
    }
  });

  it("doorbusters run 11/27 to 11/28 ET", () => {
    expect(isInWindow("doorbusters", justBefore("2026-11-27T00:00:00-05:00"))).toBe(false);
    expect(isInWindow("doorbusters", at("2026-11-27T00:00:00-05:00"))).toBe(true);
    expect(isInWindow("doorbusters", justBefore("2026-11-29T00:00:00-05:00"))).toBe(true);
    expect(isInWindow("doorbusters", at("2026-11-29T00:00:00-05:00"))).toBe(false);
  });

  it("gift season bonus runs 11/23 to 12/1 ET", () => {
    expect(isInWindow("giftSeasonBonus", justBefore("2026-11-23T00:00:00-05:00"))).toBe(false);
    expect(isInWindow("giftSeasonBonus", at("2026-11-23T00:00:00-05:00"))).toBe(true);
    expect(isInWindow("giftSeasonBonus", justBefore("2026-12-02T00:00:00-05:00"))).toBe(true);
    expect(isInWindow("giftSeasonBonus", at("2026-12-02T00:00:00-05:00"))).toBe(false);
  });
});

describe("mysteryBoxAccess", () => {
  it("walks closed, members, public, ended", () => {
    expect(mysteryBoxAccess(justBefore("2026-11-23T00:00:00-05:00"))).toBe("closed_before");
    expect(mysteryBoxAccess(at("2026-11-23T00:00:00-05:00"))).toBe("members");
    expect(mysteryBoxAccess(at("2026-11-26T12:00:00-05:00"))).toBe("members");
    expect(mysteryBoxAccess(justBefore("2026-11-27T00:00:00-05:00"))).toBe("members");
    expect(mysteryBoxAccess(at("2026-11-27T00:00:00-05:00"))).toBe("public");
    expect(mysteryBoxAccess(justBefore("2026-12-02T00:00:00-05:00"))).toBe("public");
    expect(mysteryBoxAccess(at("2026-12-02T00:00:00-05:00"))).toBe("ended");
  });
});

describe("?bfcm_now override", () => {
  const realNow = at("2026-11-11T09:00:00-05:00");

  it("is ignored in production", () => {
    expect(bfcmOverrideAllowed("production")).toBe(false);
    const now = resolveBfcmNow({ override: BFCM_QA_NOW.bf, allowOverride: bfcmOverrideAllowed("production"), realNow });
    expect(now).toBe(realNow);
    expect(bfcmPhase(now)).toBeNull();
  });

  it("is honored on preview and local", () => {
    expect(bfcmOverrideAllowed("preview")).toBe(true);
    expect(bfcmOverrideAllowed(undefined)).toBe(true);
    const now = resolveBfcmNow({ override: BFCM_QA_NOW.bf, allowOverride: true, realNow });
    expect(bfcmPhase(now)).toBe("bf");
  });

  it("falls back to the real clock on junk", () => {
    expect(parseBfcmNow("not-a-date")).toBeNull();
    expect(parseBfcmNow(undefined)).toBeNull();
    expect(resolveBfcmNow({ override: "nope", allowOverride: true, realNow })).toBe(realNow);
    expect(parseBfcmNow(["2026-11-30T00:00:00-05:00", "x"])?.toISOString()).toBe("2026-11-30T05:00:00.000Z");
  });
});

describe("nextBfcmBoundary", () => {
  it("finds the next edge", () => {
    expect(nextBfcmBoundary(at("2026-11-24T00:00:00-05:00"))?.toISOString()).toBe("2026-11-26T17:00:00.000Z");
    expect(nextBfcmBoundary(at("2026-11-26T12:00:00-05:00"))?.toISOString()).toBe("2026-11-27T05:00:00.000Z");
    expect(nextBfcmBoundary(at("2026-12-02T00:00:00-05:00"))).toBeNull();
  });
});
