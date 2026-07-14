/**
 * POST /api/consult
 *
 * The one endpoint /lp/consult submits to. Handles the phone opt-in and
 * kicks off the Martine SMS conversation.
 *
 * Flow:
 *   1. Validate the phone number to E.164 US format.
 *   2. Create (or find) the Shopify customer, marking sms_marketing_consent
 *      as SUBSCRIBED with the exact consent text the user saw. This is the
 *      TCPA-defensible record of consent.
 *   3. Tag the customer with `consult-lead` so Drew can filter and
 *      manually apply the $50 Pro Shop credit on member conversion.
 *   4. POST to mully-sms-agent /api/agent/enroll (segment=consult_landing)
 *      so Martine sends the first two openers within ~90 seconds.
 *   5. Fire a PostHog event for attribution.
 *
 * Failure isolation:
 *   Steps 2 and 3 (Shopify) failing should NOT block step 4 (SMS agent).
 *   If Shopify is down, we still want Martine to text the visitor and
 *   record the consent server-side. Any Shopify sync happens best-effort;
 *   on failure we log and continue, returning 200 to the client.
 *
 *   Step 4 failing IS blocking: if we cannot enroll them, we cannot text
 *   them. Return 502 so the client shows an error and can retry.
 *
 * Auth: no auth. This is a public opt-in endpoint. Rate-limiting relies
 * on Vercel's default per-IP limits. If abuse becomes a problem, add a
 * Cloudflare Turnstile check on the form.
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConsultBody {
  phone?: string;
  source?: string;
  consent_text?: string;
  landing_url?: string | null;
}

interface EnrollResult {
  ok: boolean;
  contact_id?: string;
  error?: string;
}

const CONSENT_TEXT_FALLBACK =
  "By tapping Text me, you agree to receive texts from Mully at this number. Reply STOP to opt out. Msg and data rates may apply.";

// E.164 US: +1 followed by exactly 10 digits, first digit 2-9.
const E164_US = /^\+1[2-9]\d{9}$/;

export async function POST(request: Request): Promise<Response> {
  let body: ConsultBody;
  try {
    body = (await request.json()) as ConsultBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const phone = (body.phone ?? "").trim();
  if (!E164_US.test(phone)) {
    return NextResponse.json(
      { ok: false, error: "invalid_phone" },
      { status: 400 },
    );
  }

  const hdrs = await headers();
  const clientIp =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    hdrs.get("x-real-ip") ||
    null;
  const userAgent = hdrs.get("user-agent") ?? null;
  const consentText = body.consent_text ?? CONSENT_TEXT_FALLBACK;
  const consentAt = new Date().toISOString();

  // ---- Step 2 + 3: Shopify customer create + tag (best-effort) ----
  let shopifyCustomerId: string | null = null;
  try {
    shopifyCustomerId = await upsertShopifyCustomer({
      phone,
      consentText,
      consentAt,
      clientIp,
      landingUrl: body.landing_url ?? null,
    });
  } catch (err) {
    // Log but do not fail — we still want to text them.
    // eslint-disable-next-line no-console
    console.error("[consult] shopify_upsert_failed", {
      message: err instanceof Error ? err.message : String(err),
      phone_last4: phone.slice(-4),
    });
  }

  // ---- Step 4: enroll into mully-sms-agent (blocking) ----
  const enrollResult = await enrollWithSmsAgent({
    phone,
    shopifyCustomerId,
    consentText,
    consentAt,
    clientIp,
    landingUrl: body.landing_url ?? null,
  });

  if (!enrollResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `enroll_failed: ${enrollResult.error ?? "unknown"}`,
      },
      { status: 502 },
    );
  }

  // ---- Step 5: PostHog attribution (best-effort) ----
  try {
    await firePostHog({
      phoneLast4: phone.slice(-4),
      landingUrl: body.landing_url ?? null,
      userAgent,
      shopifyCustomerId,
      contactId: enrollResult.contact_id ?? null,
    });
  } catch {
    // Silent — analytics never blocks the user.
  }

  return NextResponse.json(
    {
      ok: true,
      contact_id: enrollResult.contact_id ?? null,
    },
    { status: 200 },
  );
}

// ---------------------------------------------------------------------------
// Shopify customer upsert with SMS marketing consent
// ---------------------------------------------------------------------------

interface UpsertInput {
  phone: string;
  consentText: string;
  consentAt: string;
  clientIp: string | null;
  landingUrl: string | null;
}

async function upsertShopifyCustomer(input: UpsertInput): Promise<string | null> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token =
    process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_CLIENT_SECRET;
  if (!domain || !token) {
    throw new Error("Shopify Admin env not configured");
  }
  const version = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";
  const endpoint = `https://${domain}/admin/api/${version}/graphql.json`;

  // 1. Try to find an existing customer by phone.
  const findQuery = /* GraphQL */ `
    query FindCustomerByPhone($q: String!) {
      customers(first: 1, query: $q) {
        edges {
          node {
            id
            phone
            tags
          }
        }
      }
    }
  `;
  const findRes = await shopifyAdminFetch(endpoint, token, findQuery, {
    q: `phone:${input.phone}`,
  });
  const existing = (findRes as any)?.customers?.edges?.[0]?.node;

  const note = [
    "Consult landing opt-in",
    `Landed: ${input.landingUrl ?? "unknown"}`,
    `IP: ${input.clientIp ?? "unknown"}`,
    `At: ${input.consentAt}`,
    `Text: ${input.consentText}`,
  ].join("\n");

  if (existing?.id) {
    // Update: ensure SMS consent + consult-lead tag are set. We do not
    // overwrite the customer's other fields.
    const updateMutation = /* GraphQL */ `
      mutation UpdateCustomer($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id }
          userErrors { field message }
        }
      }
    `;
    const nextTags = mergeTags(existing.tags ?? [], ["consult-lead"]);
    const upd = await shopifyAdminFetch(endpoint, token, updateMutation, {
      input: {
        id: existing.id,
        smsMarketingConsent: {
          marketingState: "SUBSCRIBED",
          marketingOptInLevel: "SINGLE_OPT_IN",
          consentUpdatedAt: input.consentAt,
        },
        tags: nextTags,
        note,
      },
    });
    const errs = (upd as any)?.customerUpdate?.userErrors;
    if (errs?.length) {
      throw new Error(
        `customerUpdate userErrors: ${JSON.stringify(errs)}`,
      );
    }
    return existing.id as string;
  }

  // Create fresh.
  const createMutation = /* GraphQL */ `
    mutation CreateCustomer($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }
  `;
  const created = await shopifyAdminFetch(endpoint, token, createMutation, {
    input: {
      phone: input.phone,
      smsMarketingConsent: {
        marketingState: "SUBSCRIBED",
        marketingOptInLevel: "SINGLE_OPT_IN",
        consentUpdatedAt: input.consentAt,
      },
      tags: ["consult-lead"],
      note,
    },
  });
  const cErrs = (created as any)?.customerCreate?.userErrors;
  if (cErrs?.length) {
    throw new Error(`customerCreate userErrors: ${JSON.stringify(cErrs)}`);
  }
  return ((created as any)?.customerCreate?.customer?.id as string) ?? null;
}

function mergeTags(existing: string[], adds: string[]): string[] {
  const set = new Set<string>();
  for (const t of existing) set.add(t.trim());
  for (const t of adds) set.add(t.trim());
  return [...set];
}

async function shopifyAdminFetch(
  endpoint: string,
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Shopify admin ${res.status}: ${await res.text()}`);
  }
  const j = (await res.json()) as { data?: unknown; errors?: unknown[] };
  if (Array.isArray(j.errors) && j.errors.length) {
    throw new Error(`Shopify admin GraphQL errors: ${JSON.stringify(j.errors)}`);
  }
  return j.data;
}

// ---------------------------------------------------------------------------
// mully-sms-agent enrollment
// ---------------------------------------------------------------------------

interface EnrollInput {
  phone: string;
  shopifyCustomerId: string | null;
  consentText: string;
  consentAt: string;
  clientIp: string | null;
  landingUrl: string | null;
}

async function enrollWithSmsAgent(input: EnrollInput): Promise<EnrollResult> {
  const agentUrl = process.env.MULLY_SMS_AGENT_URL;
  const sharedSecret = process.env.INTERNAL_SHARED_SECRET;
  if (!agentUrl || !sharedSecret) {
    return {
      ok: false,
      error:
        "MULLY_SMS_AGENT_URL or INTERNAL_SHARED_SECRET not set on newreserve",
    };
  }

  const endpoint = `${agentUrl.replace(/\/$/, "")}/api/agent/enroll`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mully-secret": sharedSecret,
      },
      body: JSON.stringify({
        phone: input.phone,
        segment: "consult_landing",
        shopify_customer_id: input.shopifyCustomerId,
        browsed: {
          enrollment_source: "consult_landing",
        },
        consent: {
          source: "lp_consult",
          at: input.consentAt,
          text: input.consentText,
          ip: input.clientIp ?? undefined,
        },
      }),
    });
  } catch (err) {
    return {
      ok: false,
      error: `network: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const bodyText = await res.text();
  if (!res.ok) {
    return { ok: false, error: `agent ${res.status}: ${bodyText.slice(0, 200)}` };
  }
  let data: any;
  try {
    data = JSON.parse(bodyText);
  } catch {
    return { ok: false, error: "agent returned non-JSON" };
  }
  if (!data?.ok) {
    return {
      ok: false,
      error: `agent said not ok: ${JSON.stringify(data).slice(0, 200)}`,
    };
  }
  return { ok: true, contact_id: data.contact_id ?? data.contactId ?? undefined };
}

// ---------------------------------------------------------------------------
// PostHog server event (best-effort)
// ---------------------------------------------------------------------------

interface PostHogInput {
  phoneLast4: string;
  landingUrl: string | null;
  userAgent: string | null;
  shopifyCustomerId: string | null;
  contactId: string | null;
}

async function firePostHog(input: PostHogInput): Promise<void> {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY || process.env.POSTHOG_KEY;
  const host =
    process.env.NEXT_PUBLIC_POSTHOG_HOST ||
    process.env.POSTHOG_HOST ||
    "https://us.i.posthog.com";
  if (!apiKey) return;

  await fetch(`${host}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      event: "consult_submit",
      distinct_id: input.shopifyCustomerId ?? `phone_${input.phoneLast4}`,
      properties: {
        $lib: "server",
        source: "lp_consult",
        landing_url: input.landingUrl,
        user_agent: input.userAgent,
        phone_last4: input.phoneLast4,
        shopify_customer_id: input.shopifyCustomerId,
        sms_contact_id: input.contactId,
      },
    }),
  });
}
