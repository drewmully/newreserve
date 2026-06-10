import { Resend } from "resend";

export const FROM = "Drew Amato <drew@mymully.com>";
export const REPLY_TO = "drew@mail.mymully.com";

export interface PlainTextEmail {
  to: string;
  subject: string;
  text: string;
  idempotencyKey?: string;
  tags?: { name: string; value: string }[];
  /**
   * Value used for `utm_campaign` on any mymully.com link inside the email
   * body. If omitted, we auto-derive from `tags`:
   *   - if `tags[name=flow]` exists, use `flow_{value}`
   *   - else if `tags[name=category]` exists, use that
   *   - else `transactional`
   *
   * Pass explicitly to override (e.g. `"reactivation_q2"` for ad-hoc sends).
   */
  utmCampaign?: string;
  /**
   * Value used for `utm_content` (typically the specific email/step within a
   * campaign — e.g. `"step_2"`, `"reminder"`). Omitted from the URL if absent.
   */
  utmContent?: string;
  /**
   * Disable ALL link/UTM rewriting and Resend click/open tracking for this
   * send. Required for emails that contain single-use security links —
   * Firebase magic sign-in links, password resets, etc.
   *
   * Why: Firebase email-link `oobCode`s are single-use. If the link is wrapped
   * for click-tracking (Resend) or rewritten with extra query params, the
   * recipient's mail provider link-scanner (Gmail/Yahoo/Outlook safe-links)
   * pre-fetches the redirect and CONSUMES the one-time code before the human
   * clicks — so the real click returns `auth/invalid-action-code` /
   * `auth/expired-action-code` ("This link has expired"). Sending the bare URL
   * in a text-only email with tracking off prevents the code from being burned
   * in transit.
   */
  disableTracking?: boolean;
}

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing required env var: RESEND_API_KEY");
  }
  return new Resend(apiKey);
}

/**
 * Hosts whose links we rewrite to add attribution UTMs. We're intentionally
 * conservative — only first-party hosts get rewritten so external links
 * (Klaviyo, partner sites, etc.) stay untouched.
 */
const FIRST_PARTY_HOSTS = new Set([
  "mymully.com",
  "www.mymully.com",
  "mullybox.com",
  "www.mullybox.com",
]);

/**
 * Trailing punctuation that frequently sneaks into hand-written email copy
 * (sentence-ending periods, commas inside lists, closing parens, etc.) and
 * gets greedily captured by the URL regex. We strip these from the URL and
 * preserve them as literal text after the anchor.
 *
 * This is the fix for the trailing-dot bug observed on Jacob Gray's order:
 * the email CTA was `https://mymully.com/lp/subscription.` and that dot
 * became part of the URL path, polluting analytics.
 */
const TRAILING_PUNCT_REGEX = /[.,;:!?)\]}>'"]+$/;

/**
 * Append (or merge) UTM params on a first-party URL. URLs that already have
 * `utm_source` set are left untouched — the author's intent wins.
 *
 * Returns `{ url, trailing }` where `trailing` is any punctuation that was
 * captured by the URL regex but isn't really part of the URL (e.g. the
 * sentence-ending period). The caller stitches `trailing` back after the
 * closing anchor tag.
 */
function rewriteFirstPartyUrl(
  rawUrl: string,
  utmCampaign: string,
  utmContent: string | undefined
): { url: string; trailing: string } {
  // Pull off trailing punctuation that isn't part of the URL. Loop so we
  // can strip e.g. `).` not just `)`.
  let trailing = "";
  let working = rawUrl;
  let match: RegExpExecArray | null;
  while ((match = TRAILING_PUNCT_REGEX.exec(working))) {
    trailing = match[0] + trailing;
    working = working.slice(0, working.length - match[0].length);
  }

  let parsed: URL;
  try {
    parsed = new URL(working);
  } catch {
    // Malformed URL — return as-is (no rewrite, but trailing still stripped).
    return { url: working, trailing };
  }

  if (!FIRST_PARTY_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { url: working, trailing };
  }

  // Author already set their own attribution — respect it.
  if (parsed.searchParams.has("utm_source")) {
    return { url: parsed.toString(), trailing };
  }

  parsed.searchParams.set("utm_source", "resend");
  parsed.searchParams.set("utm_medium", "email");
  parsed.searchParams.set("utm_campaign", utmCampaign);
  if (utmContent) {
    parsed.searchParams.set("utm_content", utmContent);
  }

  return { url: parsed.toString(), trailing };
}

/**
 * Resolve the utm_campaign value to stamp into outbound links. Order of
 * preference: explicit arg > flow tag > category tag > "transactional".
 */
function resolveUtmCampaign(
  explicit: string | undefined,
  tags: { name: string; value: string }[] | undefined
): string {
  if (explicit && explicit.trim().length > 0) return explicit.trim();
  const flowTag = tags?.find((t) => t.name === "flow")?.value;
  if (flowTag) return `flow_${flowTag}`;
  const categoryTag = tags?.find((t) => t.name === "category")?.value;
  if (categoryTag) return categoryTag;
  return "transactional";
}

/**
 * Converts plain text to minimal HTML so Resend can inject its tracking pixel
 * (open tracking) and wrap links (click tracking). The email still ships with
 * a plain-text part — clients that prefer text render that instead.
 *
 * As of this version, any first-party (`mymully.com`) link in the body is
 * also rewritten to:
 *   1. Strip trailing punctuation that the URL regex would otherwise capture
 *      (fixes the `/lp/subscription.` trailing-dot bug).
 *   2. Append `utm_source=resend&utm_medium=email&utm_campaign={campaign}`
 *      (+ optional `utm_content`) so PostHog/GA4/Shopify can attribute
 *      conversions back to the broadcast. Author-provided UTMs win.
 */
function toTrackableHtml(
  text: string,
  utmCampaign: string,
  utmContent: string | undefined
): string {
  // Step 1: extract markdown links `[label](url)` BEFORE escaping so the
  // brackets/parens don't get HTML-escaped away. Replace with sentinels.
  // After escaping we'll swap the sentinels for the final <a> tags. This
  // lets template authors write short anchor text without giving up the
  // single-source-of-truth body shared with the plain-text MIME part.
  const mdLinks: Array<{ label: string; href: string; trailing: string }> = [];
  const SENTINEL = "\u0000MDLINK\u0000";
  const withSentinels = text.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_full, label: string, rawUrl: string) => {
      const { url, trailing } = rewriteFirstPartyUrl(rawUrl, utmCampaign, utmContent);
      const idx = mdLinks.push({ label, href: url, trailing }) - 1;
      return `${SENTINEL}${idx}${SENTINEL}`;
    }
  );

  const escaped = withSentinels
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Wrap bare URLs in anchor tags so Resend can track clicks. First-party
  // URLs additionally get UTM params + trailing-punct cleanup.
  const linked = escaped.replace(
    /https?:\/\/[^\s<>"]+/g,
    (matchedUrl) => {
      const { url, trailing } = rewriteFirstPartyUrl(matchedUrl, utmCampaign, utmContent);
      return `<a href="${url}" style="color:#2d5016">${url}</a>${trailing}`;
    }
  );

  // Step 2: swap sentinels back for the markdown-link anchors.
  const withMdLinks = linked.replace(
    new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, "g"),
    (_m, idxStr: string) => {
      const link = mdLinks[Number(idxStr)];
      if (!link) return "";
      // Label is plain text from the template author. Escape HTML in it.
      const safeLabel = link.label
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<a href="${link.href}" style="color:#2d5016">${safeLabel}</a>${link.trailing}`;
    }
  );

  const paragraphs = withMdLinks
    .split(/\n\n+/)
    .map((p) => `<p style="margin:0 0 1em 0;line-height:1.6">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Georgia,serif;font-size:16px;color:#333;max-width:580px;margin:0 auto;padding:20px">${paragraphs}</body></html>`;
}

/**
 * Same UTM rewrite logic, applied to the plain-text MIME part. We want both
 * parts of the multipart message to point to the same tracked URL so a
 * recipient reading the text/plain version still attributes correctly when
 * they click. Resend's click-tracking only rewrites the HTML part, so
 * without this the plain-text URL would lose the campaign attribution.
 */
function rewriteFirstPartyUrlsInPlainText(
  text: string,
  utmCampaign: string,
  utmContent: string | undefined
): string {
  // First, expand markdown links `[label](url)` to `label: url` so the
  // plain-text MIME part stays readable for clients that don't render HTML.
  // Label first, then the raw URL on the same line so a reader still sees
  // the destination.
  const expanded = text.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_full, label: string, rawUrl: string) => {
      const { url, trailing } = rewriteFirstPartyUrl(rawUrl, utmCampaign, utmContent);
      return `${label}: ${url}${trailing}`;
    }
  );
  return expanded.replace(/https?:\/\/[^\s<>"]+/g, (matchedUrl) => {
    const { url, trailing } = rewriteFirstPartyUrl(matchedUrl, utmCampaign, utmContent);
    return url + trailing;
  });
}

export async function sendPlainText(email: PlainTextEmail): Promise<string | null> {
  const resend = getResendClient();

  if (email.disableTracking) {
    // Security-link mode for single-use URLs (Firebase magic sign-in / password
    // reset). Resend's click-tracking only rewrites links that appear inside an
    // HTML body — it routes them through a track.resend.com redirect that
    // mailbox link-scanners (Gmail/Yahoo/Outlook) pre-fetch, which consumes the
    // one-time Firebase oobCode and yields "This link has expired".
    //
    // The Resend Node SDK v6 has NO per-send tracking toggle (open_tracking /
    // click_tracking live on DomainApiOptions, i.e. the domain dashboard, not
    // CreateEmailOptions). The reliable per-message fix is to send TEXT ONLY
    // (no `html`): with no anchors to rewrite, Resend leaves the raw URL
    // untouched and the code reaches the user un-consumed. We also skip the
    // first-party UTM rewrite so the URL is delivered byte-for-byte.
    const { data, error } = await resend.emails.send(
      {
        from: FROM,
        replyTo: REPLY_TO,
        to: email.to,
        subject: email.subject,
        text: email.text,
        headers: {
          "X-Entity-Ref-ID": email.idempotencyKey ?? "",
        },
        ...(email.tags ? { tags: email.tags } : {}),
      },
      email.idempotencyKey ? { idempotencyKey: email.idempotencyKey } : undefined
    );
    if (error) {
      throw new Error(`Resend error: ${JSON.stringify(error)}`);
    }
    return data?.id ?? null;
  }

  const utmCampaign = resolveUtmCampaign(email.utmCampaign, email.tags);
  const rewrittenText = rewriteFirstPartyUrlsInPlainText(
    email.text,
    utmCampaign,
    email.utmContent
  );

  const { data, error } = await resend.emails.send(
    {
      from: FROM,
      replyTo: REPLY_TO,
      to: email.to,
      subject: email.subject,
      text: rewrittenText,
      html: toTrackableHtml(email.text, utmCampaign, email.utmContent),
      ...(email.tags ? { tags: email.tags } : {}),
    },
    email.idempotencyKey ? { idempotencyKey: email.idempotencyKey } : undefined
  );
  if (error) {
    throw new Error(`Resend error: ${JSON.stringify(error)}`);
  }
  return data?.id ?? null;
}
