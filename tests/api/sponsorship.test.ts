import { describe, it, expect } from "vitest";
import {
  buildSponsorshipCode,
  parseSponsorshipCode,
  verifySponsorshipCode,
  evaluateNewBadges,
  type SponsorshipEvent,
} from "@/lib/sponsorship";

describe("sponsorship code", () => {
  it("generates a deterministic code for the same customer", () => {
    const a = buildSponsorshipCode({ customerId: 12345, firstName: "Drew" });
    const b = buildSponsorshipCode({ customerId: 12345, firstName: "Drew" });
    expect(a).toBe(b);
  });

  it("uppercases and ASCII-fies the prefix from first name", () => {
    const code = buildSponsorshipCode({ customerId: 1, firstName: "José" });
    expect(code.startsWith("JOSE-")).toBe(true);
  });

  it("falls back to MULLY when no first name is provided", () => {
    const code = buildSponsorshipCode({ customerId: 999, firstName: null });
    expect(code.startsWith("MULLY-")).toBe(true);
  });

  it("parses well-formed codes and rejects malformed ones", () => {
    expect(parseSponsorshipCode("DREW-A4F2")).toEqual({
      prefix: "DREW",
      suffix: "A4F2",
    });
    expect(parseSponsorshipCode("drew-a4f2")).toEqual({
      prefix: "DREW",
      suffix: "A4F2",
    });
    expect(parseSponsorshipCode("bogus")).toBeNull();
    expect(parseSponsorshipCode("DREW-12345")).toBeNull();
  });

  it("verifies a code against the original customer id", () => {
    const code = buildSponsorshipCode({ customerId: 4242, firstName: "Megan" });
    expect(verifySponsorshipCode(code, 4242)).toBe(true);
    expect(verifySponsorshipCode(code, 4243)).toBe(false);
  });
});

function event(daysAgo: number, now: Date): SponsorshipEvent {
  return {
    attributedAt: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000),
  };
}

describe("badge evaluation", () => {
  const NOW = new Date("2026-06-15T12:00:00Z");

  it("awards first_dozen on the first sponsorship", () => {
    const badges = evaluateNewBadges({
      events: [event(0, NOW)],
      yearBadgesEarned: { the_18: [] },
      lifetimeBadgesHeld: new Set(),
      foursomeBadgesCount: 0,
      now: NOW,
    });
    expect(badges).toContain("first_dozen");
  });

  it("does not re-award first_dozen once already held", () => {
    const badges = evaluateNewBadges({
      events: [event(10, NOW), event(0, NOW)],
      yearBadgesEarned: { the_18: [] },
      lifetimeBadgesHeld: new Set(["first_dozen"]),
      foursomeBadgesCount: 0,
      now: NOW,
    });
    expect(badges).not.toContain("first_dozen");
  });

  it("awards foursome when 3 sponsorships happen within 30 days", () => {
    const badges = evaluateNewBadges({
      events: [event(20, NOW), event(10, NOW), event(0, NOW)],
      yearBadgesEarned: { the_18: [] },
      lifetimeBadgesHeld: new Set(["first_dozen"]),
      foursomeBadgesCount: 0,
      now: NOW,
    });
    expect(badges).toContain("foursome");
  });

  it("does NOT award foursome when 3 sponsorships span more than 30 days", () => {
    const badges = evaluateNewBadges({
      events: [event(60, NOW), event(35, NOW), event(0, NOW)],
      yearBadgesEarned: { the_18: [] },
      lifetimeBadgesHeld: new Set(["first_dozen"]),
      foursomeBadgesCount: 0,
      now: NOW,
    });
    expect(badges).not.toContain("foursome");
  });

  it("awards path_to_black at exactly 10 lifetime sponsorships", () => {
    const events = Array.from({ length: 10 }, (_, i) => event(i * 5, NOW));
    const badges = evaluateNewBadges({
      events,
      yearBadgesEarned: { the_18: [] },
      lifetimeBadgesHeld: new Set(["first_dozen"]),
      foursomeBadgesCount: 0,
      now: NOW,
    });
    expect(badges).toContain("path_to_black");
  });

  it("awards the_18 when 18 sponsorships land in current calendar year", () => {
    const events = Array.from({ length: 18 }, (_, i) =>
      event(i * 3, NOW),
    );
    const badges = evaluateNewBadges({
      events,
      yearBadgesEarned: { the_18: [] },
      lifetimeBadgesHeld: new Set(["first_dozen", "path_to_black"]),
      foursomeBadgesCount: 0,
      now: NOW,
    });
    expect(badges).toContain("the_18");
  });

  it("does not re-award the_18 in the same year", () => {
    const events = Array.from({ length: 18 }, (_, i) => event(i * 3, NOW));
    const badges = evaluateNewBadges({
      events,
      yearBadgesEarned: { the_18: [2026] },
      lifetimeBadgesHeld: new Set(["first_dozen", "path_to_black", "the_18"]),
      foursomeBadgesCount: 0,
      now: NOW,
    });
    expect(badges).not.toContain("the_18");
  });
});
