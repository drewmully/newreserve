// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GIFT_CARD_FAQS,
  GIFT_CARD_PROPS,
  giftCardAmountLabel,
  giftCardLineAttributes,
  sendOnRange,
  validateGiftCardForm,
} from "@/lib/giftCard";

const today = new Date(2026, 10, 11); // Nov 11 2026, local

describe("gift card form", () => {
  it("needs no recipient fields when emailing the buyer", () => {
    expect(validateGiftCardForm({ sendTo: "me" }, today)).toEqual({});
    expect(giftCardLineAttributes({ sendTo: "me", recipientEmail: "x@y.com" }, today)).toEqual([]);
  });

  it("requires a valid recipient email", () => {
    expect(validateGiftCardForm({ sendTo: "them" }, today).recipientEmail).toBeTruthy();
    expect(validateGiftCardForm({ sendTo: "them", recipientEmail: "not-an-email" }, today).recipientEmail).toBeTruthy();
    expect(validateGiftCardForm({ sendTo: "them", recipientEmail: "pat@example.com" }, today)).toEqual({});
  });

  it("limits the send date to today through 90 days out", () => {
    expect(sendOnRange(today)).toEqual({ min: "2026-11-11", max: "2027-02-09" });
    const base = { sendTo: "them" as const, recipientEmail: "pat@example.com" };
    expect(validateGiftCardForm({ ...base, sendOn: "2026-12-25" }, today)).toEqual({});
    expect(validateGiftCardForm({ ...base, sendOn: "2026-11-10" }, today).sendOn).toBeTruthy();
    expect(validateGiftCardForm({ ...base, sendOn: "2027-02-10" }, today).sendOn).toBeTruthy();
  });

  it("builds the Shopify gift card line properties", () => {
    const attrs = giftCardLineAttributes(
      { sendTo: "them", recipientEmail: " pat@example.com ", recipientName: "Pat", message: "Merry Christmas", sendOn: "2026-12-25" },
      today,
    );
    expect(attrs).toEqual([
      { key: GIFT_CARD_PROPS.email, value: "pat@example.com" },
      { key: GIFT_CARD_PROPS.name, value: "Pat" },
      { key: GIFT_CARD_PROPS.message, value: "Merry Christmas" },
      { key: GIFT_CARD_PROPS.sendOn, value: "2026-12-25" },
      { key: "__shopify_send_gift_card_to_recipient", value: "on" },
    ]);
  });

  it("treats today's date as send now", () => {
    const attrs = giftCardLineAttributes({ sendTo: "them", recipientEmail: "pat@example.com", sendOn: "2026-11-11" }, today);
    expect(attrs.find((a) => a.key === GIFT_CARD_PROPS.sendOn)).toBeUndefined();
  });

  it("formats amounts from the live price", () => {
    expect(giftCardAmountLabel(50)).toBe("$50");
    expect(giftCardAmountLabel(49.5)).toBe("$49.50");
  });
});

describe("gift card copy", () => {
  const files = [
    "src/lib/giftCard.ts",
    "src/app/shop/gift-card/page.tsx",
    "src/app/shop/gift-card/GiftCardClient.tsx",
  ].map((f) => readFileSync(resolve(__dirname, "../..", f), "utf8"));
  const faqText = GIFT_CARD_FAQS.map((f) => `${f.q} ${f.a}`).join(" ");

  it("uses the approved delivery and resend lines", () => {
    expect(faqText).toContain("Most gift cards arrive by email within minutes.");
    expect(faqText).toContain("Check spam, then reach out and we'll resend it.");
  });

  it("never mentions fraud, em dashes or hard-coded dollar amounts", () => {
    for (const src of files) {
      expect(src.toLowerCase()).not.toContain("fraud");
      expect(src).not.toContain("\u2014");
    }
    expect(faqText).not.toMatch(/\$\d/);
  });

  it("is tracked and redirected", () => {
    const track = readFileSync(resolve(__dirname, "../../src/app/api/analytics/track/route.ts"), "utf8");
    expect(track).toContain('"gift_card_added"');
    expect(track).toContain('"gift_card_click"');
    const pdp = readFileSync(resolve(__dirname, "../../src/app/shop/[slug]/page.tsx"), "utf8");
    expect(pdp).toContain("permanentRedirect(GIFT_CARD_PATH)");
  });
});
