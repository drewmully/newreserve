import { describe, expect, it } from "vitest";
import {
  computeDedupeHash,
  getPriorFridayThursdayWindow,
} from "@/lib/siteHealth";

const baseInput = {
  severity: "P1" as const,
  source: "llm-ux" as const,
  journey: "upgrade" as const,
  title: "Loop API error on plan change",
  description: "Plan change modal fails for legacy members",
  evidence: { url: "https://mymully.com/account" },
};

describe("computeDedupeHash", () => {
  it("is stable for identical inputs", () => {
    const a = computeDedupeHash(baseInput);
    const b = computeDedupeHash(baseInput);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });

  it("changes when title changes", () => {
    const other = computeDedupeHash({ ...baseInput, title: "Different title" });
    expect(other).not.toBe(computeDedupeHash(baseInput));
  });

  it("changes when journey changes", () => {
    const other = computeDedupeHash({ ...baseInput, journey: "shop" });
    expect(other).not.toBe(computeDedupeHash(baseInput));
  });

  it("changes when source changes", () => {
    const other = computeDedupeHash({
      ...baseInput,
      source: "synthetic",
    });
    expect(other).not.toBe(computeDedupeHash(baseInput));
  });

  it("ignores query strings on the evidence URL (same pathname → same hash)", () => {
    const a = computeDedupeHash({
      ...baseInput,
      evidence: { url: "https://mymully.com/account?upgrade=1" },
    });
    const b = computeDedupeHash({
      ...baseInput,
      evidence: { url: "https://mymully.com/account?utm_source=email" },
    });
    expect(a).toBe(b);
  });
});

describe("getPriorFridayThursdayWindow", () => {
  it("returns a ~7-day window with start < end and label strings", () => {
    const fridayNoonEt = new Date("2026-05-29T16:00:00.000Z"); // Fri 12pm ET (EDT)
    const w = getPriorFridayThursdayWindow(fridayNoonEt);

    const dayMs = 24 * 60 * 60 * 1000;
    const duration = w.endMs - w.startMs;
    expect(duration).toBeGreaterThanOrEqual(6.9 * dayMs);
    expect(duration).toBeLessThanOrEqual(7.1 * dayMs);
    expect(w.endMs).toBeGreaterThan(w.startMs);
    expect(w.startLabel.length).toBeGreaterThan(0);
    expect(w.endLabel.length).toBeGreaterThan(0);
  });

  it("produces a deterministic window when called twice at the same moment", () => {
    const m = new Date("2026-05-29T16:00:00.000Z");
    const a = getPriorFridayThursdayWindow(m);
    const b = getPriorFridayThursdayWindow(m);
    expect(a.startMs).toBe(b.startMs);
    expect(a.endMs).toBe(b.endMs);
  });
});
