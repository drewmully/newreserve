import Link from "next/link";
import { LETTER_SUBSCRIBE } from "@/lib/newsletterCollection";
import { BlogCommerceSlot } from "./commerce/BlogCommerceClient";
import "./commerce/blog-commerce.css";

/**
 * The Mully Letter signup, linking to the existing /join form.
 * `inline` is the compact one-line version after the intro; `end` is the
 * card at the end. Both report blog_cta_viewed / blog_cta_clicked with
 * block "letter_signup" and a `placement` property.
 */
export function LetterSignup({ placement }: { placement: "inline" | "end" }) {
  if (placement === "inline") {
    return <BlogCommerceSlot block="letter_signup" placement="inline" targetPath={LETTER_SUBSCRIBE.href} className="bc-letter-inline">
      <p>{LETTER_SUBSCRIBE.inline}</p>
      <Link className="bc-panel__cta" href={LETTER_SUBSCRIBE.href}>{LETTER_SUBSCRIBE.cta} →</Link>
    </BlogCommerceSlot>;
  }
  return <BlogCommerceSlot block="letter_signup" placement="end" targetPath={LETTER_SUBSCRIBE.href}>
    <aside className="bc-panel bc-panel--end" aria-label={LETTER_SUBSCRIBE.eyebrow}>
      <p className="bc-eyebrow">{LETTER_SUBSCRIBE.eyebrow}</p>
      <h2 className="bc-panel__title">{LETTER_SUBSCRIBE.heading}</h2>
      <p className="bc-panel__body">{LETTER_SUBSCRIBE.body}</p>
      <Link className="bc-panel__cta" href={LETTER_SUBSCRIBE.href}>{LETTER_SUBSCRIBE.cta} →</Link>
    </aside>
  </BlogCommerceSlot>;
}
