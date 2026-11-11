import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanHref, cleanText, emailToDraft, insertSql, suggestSlug, toRow, validateLetterRow, type LetterDraft } from "@/lib/newsletterToPost";

const EMAIL = `<html><body>
<div style="display:none;max-height:0">Preview line here</div>
<table><tr><td style="font-family:Arial">The Mully Newsletter · This Past Week in Golf · Nov. 8, 2026</td></tr>
<tr><td style="font-size:12px">01 · Lead Story</td></tr>
<tr><td style="font-family:'Playfair Display',Georgia,serif;font-size:28px">A big Sunday</td></tr>
<tr><td><img src="https://cdn.klaviyomail.com/company/X/images/a.jpeg" alt="A green at dusk"></td></tr>
<tr><td style="font-size:16px">Hi {{ first_name|default:'there' }}, the story is here \u2014 read on.</td></tr>
<tr><td><a href="https://www.mymully.com/shop/sloat-merino-polo?utm_source=klaviyo&amp;_kx=abc">Merino Polo</a> Navy · $215</td></tr>
<tr><td><a href="https://www.mymully.com/shop/sloat-merino-polo?utm_source=klaviyo">Shop the polo</a></td></tr>
<tr><td>You're receiving this email because you signed up. <a href="{% unsubscribe_link %}">Unsubscribe</a></td></tr>
</table></body></html>`;

describe("newsletterToPost", () => {
  it("cleans links", () => {
    expect(cleanHref("https://www.mymully.com/shop/x?utm_source=klaviyo&_kx=1")).toBe("/shop/x");
    expect(cleanHref("https://mymully.com/lp/gift-season/?utm_campaign=a&color=navy")).toBe("/lp/gift-season?color=navy");
    expect(cleanHref("http://golf.com/news/a?utm_medium=email")).toBe("https://golf.com/news/a");
    expect(cleanHref("{% unsubscribe_link %}")).toBeNull();
    expect(cleanHref("mailto:info@mullybox.com")).toBeNull();
  });

  it("cleans text", () => {
    expect(cleanText("Hi {{ first_name }}, golf \u2014 fall \u{1F943}")).toBe("Hi, golf, fall");
  });

  it("converts an email and drops footer, tags, tracking, prices and buttons", () => {
    const doc = new DOMParser().parseFromString(EMAIL, "text/html");
    const draft = emailToDraft(doc, { campaignId: "c1", previewText: "Preview line here", sentAt: "2026-11-08T14:00:00Z" });
    expect(draft.slug).toBe("this-past-week-in-golf-november-8-2026");
    expect(draft.date).toBe("Nov 08, 2026");
    expect(draft.sections[0].heading).toBe("A big Sunday");
    expect(draft.sections[0].image).toContain("cdn.klaviyomail.com");
    const body = JSON.stringify(draft.sections);
    expect(body).toContain("[Merino Polo](/shop/sloat-merino-polo)");
    expect(body).not.toMatch(/\{\{|utm_|_kx|\$|Unsubscribe|receiving|Shop the polo|\u2014/);
    expect(draft._products).toEqual(["sloat-merino-polo"]);
  });

  it("suggests ET date slugs", () => {
    expect(suggestSlug("The Mully Letter", "2026-11-13T02:00:00Z")).toBe("the-mully-letter-november-12-2026");
  });

  it("blocks rows that break the rules", () => {
    const doc = new DOMParser().parseFromString(EMAIL, "text/html");
    const problems = validateLetterRow(toRow(emailToDraft(doc, { campaignId: "c1", sentAt: "2026-11-08T14:00:00Z" })));
    expect(problems.some(p => p.includes("excerpt"))).toBe(true);
    expect(problems.some(p => p.includes("TODO"))).toBe(true);
  });

  const dir = path.resolve(__dirname, "../../content/newsletters");
  for (const file of readdirSync(dir).filter(f => f.endsWith(".json"))) {
    it(`archived issue ${file} is ready to insert`, () => {
      const draft = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as LetterDraft;
      const row = toRow(draft);
      expect(validateLetterRow(row)).toEqual([]);
      expect(insertSql(row)).toContain("on conflict (slug) do nothing");
    });
  }
});
