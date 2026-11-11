/**
 * Take a Shot identity rules: one code per inbox, phone and browser.
 * Pure helpers (no I/O) plus an MX check with an injectable resolver.
 */
import { createHash } from "node:crypto";
import { normalizeSignupPhone } from "@/lib/shopSignup";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export type NormalizedEmail = { email: string; key: string; domain: string };

/**
 * `email` is what we store and send to; `key` is the inbox identity used for
 * dedupe: lowercased, googlemail -> gmail, +tags removed, Gmail dots removed.
 */
export function normalizeEmail(raw: unknown): NormalizedEmail | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return null;
  const m = /^([^\s@]+)@([^\s@]+\.[^\s@]{2,})$/.exec(email);
  if (!m) return null;
  let [, local, domain] = m;
  if (domain === "googlemail.com") domain = "gmail.com";
  local = local.split("+")[0];
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  if (!local) return null;
  return { email, key: `${local}@${domain}`, domain };
}

/** Same rule as the shop popup (US default, E.164 otherwise). */
export const normalizePhone = normalizeSignupPhone;

export const DISPOSABLE_DOMAINS = new Set((
  "mailinator.com guerrillamail.com guerrillamail.net sharklasers.com grr.la 10minutemail.com 10minutemail.net " +
  "temp-mail.org tempmail.com tempmail.net tempmailo.com yopmail.com yopmail.net trashmail.com trashmail.de getnada.com nada.email " +
  "dispostable.com maildrop.cc throwawaymail.com fakeinbox.com moakt.com emailondeck.com mintemail.com mohmal.com burnermail.io " +
  "mailnesia.com mailcatch.com spamgourmet.com tempinbox.com tempr.email discard.email mytemp.email inboxkitten.com 33mail.com " +
  "mail.tm emailfake.com fakemail.net tmpmail.org tmpmail.net mailpoof.com spambox.us anonaddy.me trbvm.com cs.email"
).split(/\s+/));

export function isDisposableDomain(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(domain);
}

/** Lead doc id: sha256 of the inbox key, so raw emails never appear in ids or logs. */
export const leadIdFor = (emailKey: string) => digest(`email:${emailKey}`);
/** Identity doc id for a phone or browser. */
export const identityIdFor = (kind: "phone" | "visitor", value: string) => digest(`${kind}:${value}`);

/**
 * true = domain receives mail, false = it definitely does not, null = unknown
 * (lookup failed or timed out; callers allow the signup).
 */
export async function hasMailServer(domain: string, timeoutMs = 2500): Promise<boolean | null> {
  const withTimeout = <T,>(p: Promise<T>) => Promise.race([
    p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
  ]);
  try {
    const { resolveMx } = await import("node:dns/promises");
    const records = await withTimeout(resolveMx(domain));
    return records.length > 0;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      // Only a confirmed NXDOMAIN rejects. A domain with no MX may still take mail on its A record.
      try {
        const res = await withTimeout(fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
          headers: { accept: "application/dns-json" },
        }));
        const json = (await res.json()) as { Status?: number; Answer?: unknown[] };
        if (json.Status === 3) return false; // NXDOMAIN
        if (json.Answer?.length) return true;
        return null;
      } catch { return null; }
    }
    return null;
  }
}
