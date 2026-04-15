import { describe, expect, it } from "vitest";
import { getClientIp } from "@/app/api/_lib/clientIp";

describe("getClientIp", () => {
  it("uses the first valid x-forwarded-for address", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
    });

    expect(getClientIp(headers)).toBe("203.0.113.10");
  });

  it("supports Cloudflare and standard Forwarded headers", () => {
    expect(
      getClientIp(
        new Headers({
          "cf-connecting-ip": "2001:db8::1",
        })
      )
    ).toBe("2001:db8::1");

    expect(
      getClientIp(
        new Headers({
          forwarded: 'for="[2001:db8::2]:443";proto=https',
        })
      )
    ).toBe("2001:db8::2");
  });

  it("ignores invalid or obfuscated values", () => {
    expect(
      getClientIp(
        new Headers({
          "x-forwarded-for": "unknown, not-an-ip",
          forwarded: "for=_hidden;proto=https",
        })
      )
    ).toBeUndefined();
  });
});
