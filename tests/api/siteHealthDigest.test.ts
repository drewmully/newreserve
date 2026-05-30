import { describe, expect, it } from "vitest";
import {
  filterFindingsForDigest,
  pdfFilename,
  summarizeBySeverity,
  summarizeByJourney,
} from "@/lib/siteHealthDigest";
import type { SiteHealthFinding } from "@/lib/siteHealth";

function mockFinding(p: Partial<SiteHealthFinding>): SiteHealthFinding {
  return {
    id: "abc123",
    dedupe_hash: "abc123",
    date: "2026-05-28",
    title: "Sample finding",
    description: "Description",
    severity: "P1",
    journey: "shop",
    evidence: { url: "https://mymully.com/shop" },
    first_seen_at: Date.now() - 5 * 86_400_000,
    last_seen_at: Date.now(),
    occurrence_count: 1,
    status: "new",
    source: "llm-ux",
    last_sweep_id: "sweep_1",
    ...p,
  };
}

describe("filterFindingsForDigest", () => {
  const startMs = Date.UTC(2026, 4, 22); // 2026-05-22
  const endMs = startMs + 7 * 86_400_000;
  const window = {
    startMs,
    endMs,
    startLabel: "May 22",
    endLabel: "May 28",
  };

  it("attaches PDFs for every P0 and P1 regardless of first_seen_at", () => {
    const findings: SiteHealthFinding[] = [
      mockFinding({
        id: "p0-old",
        severity: "P0",
        first_seen_at: startMs - 30 * 86_400_000,
      }),
      mockFinding({
        id: "p1-new",
        severity: "P1",
        first_seen_at: startMs + 1000,
      }),
    ];
    const { withPdf, bullets } = filterFindingsForDigest(findings, window);
    expect(withPdf.map((f) => f.id).sort()).toEqual(["p0-old", "p1-new"]);
    expect(bullets).toEqual([]);
  });

  it("attaches PDF for new-this-window P2 but bullets recurring P2", () => {
    const findings: SiteHealthFinding[] = [
      mockFinding({
        id: "p2-new",
        severity: "P2",
        first_seen_at: startMs + 100,
      }),
      mockFinding({
        id: "p2-recurring",
        severity: "P2",
        first_seen_at: startMs - 10 * 86_400_000,
      }),
    ];
    const { withPdf, bullets } = filterFindingsForDigest(findings, window);
    expect(withPdf.map((f) => f.id)).toEqual(["p2-new"]);
    expect(bullets.map((f) => f.id)).toEqual(["p2-recurring"]);
  });

  it("orders withPdf by severity (P0 before P1 before P2)", () => {
    const findings: SiteHealthFinding[] = [
      mockFinding({ id: "p2", severity: "P2", first_seen_at: startMs + 1 }),
      mockFinding({ id: "p1", severity: "P1" }),
      mockFinding({ id: "p0", severity: "P0" }),
    ];
    const { withPdf } = filterFindingsForDigest(findings, window);
    expect(withPdf.map((f) => f.severity)).toEqual(["P0", "P1", "P2"]);
  });
});

describe("pdfFilename", () => {
  it("produces a safe slugified filename", () => {
    const f = mockFinding({
      id: "abc12345xyz",
      severity: "P0",
      title: "Loop API error: can't upgrade subscription",
    });
    const name = pdfFilename(f);
    expect(name.endsWith(".pdf")).toBe(true);
    expect(name).toContain("P0");
    expect(name).not.toMatch(/[':\/?*<>|"]/); // filesystem-unsafe chars stripped
  });
});

describe("summarizeBySeverity", () => {
  it("counts each severity bucket", () => {
    const result = summarizeBySeverity([
      mockFinding({ severity: "P0" }),
      mockFinding({ severity: "P1" }),
      mockFinding({ severity: "P1" }),
      mockFinding({ severity: "P2" }),
    ]);
    expect(result).toEqual({ P0: 1, P1: 2, P2: 1 });
  });

  it("returns zeros for empty input", () => {
    expect(summarizeBySeverity([])).toEqual({ P0: 0, P1: 0, P2: 0 });
  });
});

describe("summarizeByJourney", () => {
  it("counts each journey bucket", () => {
    const result = summarizeByJourney([
      mockFinding({ journey: "shop" }),
      mockFinding({ journey: "shop" }),
      mockFinding({ journey: "upgrade" }),
    ]);
    expect(result.shop).toBe(2);
    expect(result.upgrade).toBe(1);
  });
});
