/**
 * Identity resolution for inbound events.
 *
 * The single most important invariant in this module:
 *
 *   public.customers.id IS the Shopify customer id.
 *
 * mully-hub's daily Shopify sync upserts public.customers with
 * onConflict: "id". A row we create using the real Shopify id therefore merges
 * natively on the next sync — no duplicate, no collision.
 *
 * The same sync has an email-collision recovery path that DELETES the colliding
 * row, and five foreign keys behind it are ON DELETE CASCADE. So the second
 * invariant is absolute:
 *
 *   Never insert a row whose lower(email) already exists on a different id.
 *
 * Column contract: a row created here writes ONLY id, email, entity,
 * acquisition_source and created_at. It never touches a consent column, a name,
 * a phone, tags, or firebase_uid — every one of those is owned by a sync that
 * would fight us for it. Leaving consent NULL is the honest state: a purchase
 * is not marketing consent.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { raiseAlert } from "./alert";
import type { EventName, EventSource } from "./catalog";

export type Resolution =
  | "resolved"
  | "created"
  | "linked"
  | "unresolvable"
  | "pending";

export interface IdentityHint {
  shopifyCustomerId?: string;
  email?: string;
  firebaseUid?: string;
  phoneE164?: string;
}

export interface ResolveResult {
  customerId: string | null;
  resolution: Resolution;
  detail: string;
  identityHint: IdentityHint;
}

export interface ResolveInput {
  source: EventSource;
  eventName: EventName;
  payload: unknown;
  inboundEventId?: number | null;
}

/** Ids at or above this are synthetic; everything below is a real Shopify id. */
const SYNTHETIC_ID_BASE = BigInt("9000000000000000");

// ─── payload extraction ──────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

/** "gid://shopify/Customer/12345" → "12345". Plain numeric strings pass through. */
function numericTail(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/(\d+)\s*$/);
  return match ? match[1] : undefined;
}

function isPlausibleShopifyId(value: string | undefined): value is string {
  if (!value || !/^\d+$/.test(value)) return false;
  try {
    return BigInt(value) > BigInt(0);
  } catch {
    return false;
  }
}

/** E.164 US, matching the pattern already used by /api/consult. */
const E164_US = /^\+1[2-9]\d{9}$/;

function normalisePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (E164_US.test(trimmed)) return trimmed;

  const digits = trimmed.replace(/\D/g, "");
  const candidate =
    digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : null;

  return candidate && E164_US.test(candidate) ? candidate : undefined;
}

/**
 * Pulls every identifier we know how to look for out of a provider payload.
 *
 * customers/create and customers/update are the awkward case: for those topics
 * the payload IS the customer, so the Shopify id is top-level rather than under
 * `customer`.
 */
export function extractIdentity(
  eventName: EventName,
  payload: unknown,
): IdentityHint {
  const root = asRecord(payload) ?? {};
  const customer = asRecord(root.customer) ?? {};
  const shipping = asRecord(root.shipping_address) ?? {};
  const isCustomerTopic =
    eventName === "customer.created" || eventName === "customer.updated";

  const shopifyCustomerId = numericTail(
    firstString(
      customer.id,
      customer.shopifyId,
      customer.shopify_customer_id,
      customer.admin_graphql_api_id,
      root.shopifyCustomerId,
      root.shopify_customer_id,
      isCustomerTopic ? root.id : undefined,
      isCustomerTopic ? root.admin_graphql_api_id : undefined,
    ),
  );

  const hint: IdentityHint = {};

  if (isPlausibleShopifyId(shopifyCustomerId)) {
    hint.shopifyCustomerId = shopifyCustomerId;
  }

  const email = firstString(
    root.email,
    customer.email,
    root.contact_email,
    root.customer_email,
  );
  if (email && email.includes("@")) hint.email = email.toLowerCase();

  const firebaseUid = firstString(root.firebase_uid, root.firebaseUid, customer.firebase_uid);
  if (firebaseUid) hint.firebaseUid = firebaseUid;

  const phone = normalisePhone(
    firstString(root.phone, customer.phone, shipping.phone, root.phone_e164),
  );
  if (phone) hint.phoneE164 = phone;

  return hint;
}

// ─── the column contract ─────────────────────────────────────────────────────

/**
 * The ONLY shape this module ever inserts into public.customers.
 *
 * Exported so a unit test can assert its exact key set. If a future edit adds a
 * consent column here, that test fails the build — which is the point.
 */
export function buildBackboneCustomerRow(input: {
  id: string;
  email: string | null;
}): Record<string, unknown> {
  return {
    id: input.id,
    email: input.email,
    entity: "mully",
    acquisition_source: "event_backbone",
    created_at: new Date().toISOString(),
  };
}

// ─── database primitives ─────────────────────────────────────────────────────

async function findById(sb: SupabaseClient, id: string): Promise<string | null> {
  const { data, error } = await sb
    .from("customers")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`customers lookup by id failed: ${error.message}`);
  const row = data as { id: number | string } | null;
  return row ? String(row.id) : null;
}

/**
 * Case-insensitive lookup via the migration's SQL function. Never `.ilike`:
 * a literal `_` or `%` in an address would become a wildcard, and
 * customers_email_key is UNIQUE on the raw, case-sensitive email.
 */
async function findByEmail(sb: SupabaseClient, email: string): Promise<string | null> {
  const { data, error } = await sb.rpc("event_backbone_find_customer_by_email", {
    p_email: email,
  });
  if (error) throw new Error(`customers lookup by email failed: ${error.message}`);
  const rows = (data ?? []) as { id: number | string }[];
  return rows.length > 0 ? String(rows[0].id) : null;
}

async function findByColumn(
  sb: SupabaseClient,
  column: "firebase_uid" | "phone_e164",
  value: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("customers")
    .select("id")
    .eq(column, value)
    .order("id", { ascending: true })
    .limit(1);
  if (error) throw new Error(`customers lookup by ${column} failed: ${error.message}`);
  const rows = (data ?? []) as { id: number | string }[];
  return rows.length > 0 ? String(rows[0].id) : null;
}

async function insertCustomer(
  sb: SupabaseClient,
  row: Record<string, unknown>,
): Promise<{ conflicted: boolean }> {
  const { error } = await sb
    .from("customers")
    .upsert(row, { onConflict: "id", ignoreDuplicates: true });

  if (!error) return { conflicted: false };
  // 23505 = unique violation. Anything else is a real failure.
  if ((error as { code?: string }).code === "23505") return { conflicted: true };
  throw new Error(`customer insert failed: ${error.message}`);
}

async function nextSyntheticId(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb.rpc("event_backbone_next_synthetic_id");
  if (error) throw new Error(`synthetic id allocation failed: ${error.message}`);
  const value = typeof data === "object" && data !== null ? (data as unknown[])[0] : data;
  const id = BigInt(String(value ?? SYNTHETIC_ID_BASE + BigInt(1)));
  if (id < SYNTHETIC_ID_BASE) {
    throw new Error(`synthetic id ${id} is below the synthetic base`);
  }
  return String(id);
}

// ─── the ladder ──────────────────────────────────────────────────────────────

export async function resolveIdentity(
  input: ResolveInput,
  client?: SupabaseClient,
): Promise<ResolveResult> {
  const sb = client ?? getSupabaseService();
  const hint = extractIdentity(input.eventName, input.payload);
  const eventId = input.inboundEventId ?? null;

  // Rung 1 — the Shopify customer id, which IS our primary key.
  if (hint.shopifyCustomerId) {
    const existing = await findById(sb, hint.shopifyCustomerId);
    if (existing) {
      return {
        customerId: existing,
        resolution: "resolved",
        detail: "shopify_customer_id",
        identityHint: hint,
      };
    }

    // The row does not exist yet. Before minting it under the Shopify id, make
    // sure that email is not already living on a DIFFERENT id — inserting a
    // second row for the same address is what arms the sync's destructive
    // collision-recovery delete.
    if (hint.email) {
      const emailOwner = await findByEmail(sb, hint.email);
      if (emailOwner && emailOwner !== hint.shopifyCustomerId) {
        await raiseAlert({
          kind: "identity_linked",
          severity: "warning",
          customerId: emailOwner,
          inboundEventId: eventId,
          summary: `Event carried Shopify customer ${hint.shopifyCustomerId} but ${hint.email} already belongs to customer ${emailOwner}; linked instead of inserting.`,
          detail: {
            event_name: input.eventName,
            source: input.source,
            shopify_customer_id: hint.shopifyCustomerId,
            existing_customer_id: emailOwner,
            email: hint.email,
          },
        });
        return {
          customerId: emailOwner,
          resolution: "linked",
          detail: `email_owned_by_other_id:${emailOwner}`,
          identityHint: hint,
        };
      }
    }

    const { conflicted } = await insertCustomer(
      sb,
      buildBackboneCustomerRow({ id: hint.shopifyCustomerId, email: hint.email ?? null }),
    );
    const settled = (await findById(sb, hint.shopifyCustomerId)) ?? hint.shopifyCustomerId;

    if (!conflicted) {
      await raiseAlert({
        kind: "customer_created",
        severity: "info",
        customerId: settled,
        inboundEventId: eventId,
        summary: `Created customer ${settled} from ${input.source} ${input.eventName} using the Shopify customer id.`,
        detail: {
          event_name: input.eventName,
          source: input.source,
          customer_id: settled,
          email: hint.email ?? null,
          id_kind: "shopify",
        },
      });
    }

    return {
      customerId: settled,
      resolution: conflicted ? "resolved" : "created",
      detail: conflicted ? "shopify_customer_id_raced" : "created_with_shopify_id",
      identityHint: hint,
    };
  }

  // Rung 2 — Firebase uid.
  if (hint.firebaseUid) {
    const byUid = await findByColumn(sb, "firebase_uid", hint.firebaseUid);
    if (byUid) {
      return {
        customerId: byUid,
        resolution: "resolved",
        detail: "firebase_uid",
        identityHint: hint,
      };
    }
  }

  // Rung 3 — email, always case-insensitively.
  if (hint.email) {
    const byEmail = await findByEmail(sb, hint.email);
    if (byEmail) {
      return {
        customerId: byEmail,
        resolution: "resolved",
        detail: "lower_email",
        identityHint: hint,
      };
    }
  }

  // Rung 4 — phone.
  if (hint.phoneE164) {
    const byPhone = await findByColumn(sb, "phone_e164", hint.phoneE164);
    if (byPhone) {
      return {
        customerId: byPhone,
        resolution: "resolved",
        detail: "phone_e164",
        identityHint: hint,
      };
    }
  }

  // Rung 5 — nothing matched, but we have an email worth keeping. Mint a
  // synthetic id. Retried once, because the allocator races with mully-hub's.
  if (hint.email) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const id = await nextSyntheticId(sb);
      const { conflicted } = await insertCustomer(
        sb,
        buildBackboneCustomerRow({ id, email: hint.email }),
      );
      if (conflicted) continue;

      await raiseAlert({
        kind: "customer_created",
        severity: "info",
        customerId: id,
        inboundEventId: eventId,
        summary: `Created synthetic customer ${id} for ${hint.email} from ${input.source} ${input.eventName} — the event carried no Shopify customer id.`,
        detail: {
          event_name: input.eventName,
          source: input.source,
          customer_id: id,
          email: hint.email,
          id_kind: "synthetic",
          attempt,
        },
      });

      return {
        customerId: id,
        resolution: "created",
        detail: "created_with_synthetic_id",
        identityHint: hint,
      };
    }

    // Both allocations collided. Loud, not silent.
    await raiseAlert({
      kind: "unresolvable_event",
      severity: "warning",
      inboundEventId: eventId,
      summary: `Could not allocate a synthetic customer id for ${hint.email} after two attempts.`,
      detail: { event_name: input.eventName, source: input.source, email: hint.email },
    });
    return {
      customerId: null,
      resolution: "unresolvable",
      detail: "synthetic_id_allocation_exhausted",
      identityHint: hint,
    };
  }

  // Rung 6 — no usable identifier at all. Never skipped, never silent.
  await raiseAlert({
    kind: "unresolvable_event",
    severity: "warning",
    inboundEventId: eventId,
    summary: `${input.source} ${input.eventName} carried no usable identifier.`,
    detail: { event_name: input.eventName, source: input.source },
  });

  return {
    customerId: null,
    resolution: "unresolvable",
    detail: "no_identifier_in_payload",
    identityHint: hint,
  };
}
