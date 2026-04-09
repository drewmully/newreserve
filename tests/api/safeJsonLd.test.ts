import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "@/lib/safeJsonLd";

describe("serializeJsonLd", () => {
  it("escapes script-breaking content while preserving the data payload", () => {
    const payload = {
      headline: '</script><script>alert("xss")</script>',
      text: "line one\u2028line two\u2029line three",
    };

    const serialized = serializeJsonLd(payload);

    expect(serialized).not.toContain("</script>");
    expect(serialized).not.toContain("\u2028");
    expect(serialized).not.toContain("\u2029");
    expect(JSON.parse(serialized)).toEqual(payload);
  });
});
