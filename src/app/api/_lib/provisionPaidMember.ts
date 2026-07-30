/**
 * provisionPaidMember — shared logic for turning a paying Loop subscriber
 * into a fully-provisioned Firebase user + Firestore profile.
 *
 * Used by:
 *   - POST /api/auth/check-loop-status   (front-door fallback when a visitor's
 *                                          email is not yet in Firebase Auth)
 *   - POST /api/webhooks/shopify/orders-paid  (fresh purchase path)
 *   - GET  /api/admin/cron/loop-firebase-backfill (one-time legacy backfill)
 *
 * Contract:
 *   - Idempotent. Safe to call multiple times for the same email; existing
 *     users/docs are updated in place, never overwritten with defaults.
 *   - Never throws for expected "no active Loop sub" cases — returns a
 *     discriminated result instead, so callers can branch cleanly.
 *   - Sends the "Unlock your Mully account" magic-link email at most once
 *     per provisioning (guarded by users/{uid}.magic_link_sent_at).
 */

import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { sendPlainText } from "@/lib/email/resend";
import {
  getLoopSubscriptionStatus,
  getLoopRawSubscriptions,
} from "@/app/api/_lib/loopAdmin";
import {
  resolveCustomerByEmail,
  getCustomerFirstNameById,
} from "@/app/api/_lib/shopifyAdmin";
import {
  resolveMemberTierFromVariantId,
  resolveLegacyFromVariantId,
  type MemberTier,
  type PaidMemberTier,
} from "@/lib/membershipConfig";
import { startFlow, type EmailFlow } from "@/lib/email/sequences";

/**
 * Result of a provisioning attempt.
 *
 * - `provisioned` — user is (now) linked to an active Loop sub. Firebase
 *   user + Firestore doc are up to date; magic-link email was sent if this
 *   was the first time we've ever surfaced this member.
 * - `not_paid`    — no active Loop subscription found under this email.
 *   Caller should fall through to the standard new-signup flow.
 * - `error`       — an unexpected failure. Caller should NOT auto-onboard;
 *   surface a soft error and let the user retry.
 */
export type ProvisionResult =
  | {
      status: "provisioned";
      uid: string;
      email: string;
      tier: PaidMemberTier;
      isLegacy: boolean;
      legacyPlan: string | null;
      shopifyCustomerId: string | null;
      isNewFirebaseUser: boolean;
      magicLinkSent: boolean;
    }
  | { status: "not_paid"; email: string }
  | { status: "error"; email: string; error: string };

interface ProvisionOptions {
  /** Where to point the magic link. Defaults to https://mymully.com/login?paid=1. */
  magicLinkReturnUrl?: string;
  /**
   * When true, send the "Unlock your Mully account" email even if
   * magic_link_sent_at is already set. Used by the backfill cron via a
   * `?resend=1` flag.
   */
  forceResendMagicLink?: boolean;
  /**
   * Skip the email send altogether (used by the backfill cron's dry-run
   * mode, and by the orders-paid webhook when it wants to reuse the write
   * logic but keep its own bespoke email copy).
   */
  skipMagicLink?: boolean;
  /**
   * Optional pre-resolved first name (avoids an extra Shopify round trip
   * when the caller already has it).
   */
  firstName?: string | null;
  /**
   * Where this provisioning was triggered from — persisted on the user doc
   * for observability.
   */
  source?:
    | "check_loop_status"
    | "orders_paid_webhook"
    | "loop_firebase_backfill";
}

const DEFAULT_MAGIC_LINK_RETURN_URL = "https://mymully.com/login?paid=1";

/**
 * Given a normalized email, resolve to (customerId, tier, isLegacy, subs).
 * Returns null if no active Loop subscription is found.
 */
async function findActiveLoopMembership(email: string): Promise<{
  shopifyCustomerId: string | null;
  loopIdentifier: string;
  tier: PaidMemberTier;
  variantId: unknown;
  isLegacy: boolean;
  legacyPlan: string | null;
} | null> {
  const shopifyCustomerId = await resolveCustomerByEmail(email);
  const loopIdentifier = shopifyCustomerId ?? email;

  const rawSubs = await getLoopRawSubscriptions(loopIdentifier);
  const active = rawSubs.find((s) => s.status === "ACTIVE");
  if (!active) return null;

  // Loop's list endpoint sometimes omits `lines`; try the top-level fields too.
  const lineVariantId =
    (active.lines as Array<Record<string, unknown>> | undefined)?.[0]
      ?.variantShopifyId ??
    active.shopify_variant_id ??
    active.variant_id ??
    null;

  const tier = resolveMemberTierFromVariantId(lineVariantId);
  if (!tier) {
    // Active subscription exists but variant isn't in the tier map. Treat
    // as "not_paid" for the login gate — safer than granting the wrong
    // tier — but the caller can inspect the returned sub for debugging.
    return null;
  }

  const { isLegacy, legacyPlan } = resolveLegacyFromVariantId(lineVariantId);

  return {
    shopifyCustomerId,
    loopIdentifier,
    tier,
    variantId: lineVariantId,
    isLegacy,
    legacyPlan,
  };
}

/**
 * Ensure a Firebase Auth user exists for the given email. Returns the uid
 * and a flag indicating whether we just created it.
 */
async function ensureFirebaseUser(email: string): Promise<{
  uid: string;
  isNewFirebaseUser: boolean;
}> {
  try {
    const existing = await adminAuth.getUserByEmail(email);
    return { uid: existing.uid, isNewFirebaseUser: false };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== "auth/user-not-found") throw err;
  }

  try {
    const created = await adminAuth.createUser({ email, emailVerified: false });
    return { uid: created.uid, isNewFirebaseUser: true };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "auth/email-already-exists") {
      // Race: another request created it after our getUserByEmail lookup.
      const after = await adminAuth.getUserByEmail(email);
      return { uid: after.uid, isNewFirebaseUser: false };
    }
    throw err;
  }
}

/**
 * Provision (or refresh) a Firebase user + Firestore doc for the paying
 * Loop subscriber at `email`. Returns a discriminated result so callers
 * can branch cleanly between "welcome them in" and "new signup".
 *
 * SIDE EFFECTS
 *   - May create a Firebase Auth user.
 *   - May write/merge `users/{uid}` (tier, shopify_customer_id, isLegacy,
 *     legacyPlan, tier_paid_at, provisioned_from, magic_link_sent_at).
 *   - May send exactly one "Unlock your Mully account" email.
 *   - Kicks off the appropriate Resend welcome sequence (access|member).
 */
export async function provisionPaidMemberFromLoop(
  rawEmail: string,
  options: ProvisionOptions = {}
): Promise<ProvisionResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return { status: "not_paid", email: "" };

  let membership;
  try {
    membership = await findActiveLoopMembership(email);
  } catch (err) {
    console.error("[provisionPaidMember] Loop lookup failed:", err);
    return {
      status: "error",
      email,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!membership) return { status: "not_paid", email };

  const { shopifyCustomerId, tier, isLegacy, legacyPlan } = membership;

  // 1. Ensure the Firebase Auth user exists.
  let uid: string;
  let isNewFirebaseUser: boolean;
  try {
    ({ uid, isNewFirebaseUser } = await ensureFirebaseUser(email));
  } catch (err) {
    console.error("[provisionPaidMember] ensureFirebaseUser failed:", err);
    return {
      status: "error",
      email,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 2. Upsert the Firestore profile.
  const userRef = adminDb.collection("users").doc(uid);
  let existingData: Record<string, unknown> = {};
  try {
    const snap = await userRef.get();
    if (snap.exists) existingData = (snap.data() ?? {}) as Record<string, unknown>;

    const now = Date.now();
    const isFirstTimeDoc = !snap.exists;
    const currentTier = existingData.tier as MemberTier | undefined;

    const updates: Record<string, unknown> = {
      email,
      updated_at: now,
      // Never downgrade — only write tier if it's currently unset or "free",
      // or if the tier is genuinely different from what's on the doc.
      ...(currentTier === undefined || currentTier === "free" || currentTier !== tier
        ? { tier, tier_paid_at: now }
        : {}),
      isLegacy,
      legacyPlan,
      provisioned_from: options.source ?? "check_loop_status",
    };

    if (shopifyCustomerId && !existingData.shopify_customer_id) {
      updates.shopify_customer_id = shopifyCustomerId;
    }

    if (isFirstTimeDoc) {
      updates.created_at = now;
      // Anyone being provisioned via this helper already has an active Loop
      // membership — they've paid, sometimes for years. They should NOT be
      // dumped into the new-signup /onboarding flow on first login. Mark
      // onboarding complete so login/page.tsx routes them to /home. If they
      // haven't filled out fit profile / sizing yet, the WelcomeDrawer on
      // /home is the right place to capture it — non-blocking on first miss.
      updates.onboarding_completed = true;
      updates.onboarding_source = "loop_provision_auto";
    }

    await userRef.set(updates, { merge: true });
  } catch (err) {
    console.error("[provisionPaidMember] Firestore upsert failed:", err);
    return {
      status: "error",
      email,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 3. Send the "Unlock your Mully account" magic-link email, once.
  let magicLinkSent = false;
  const alreadySent = Boolean(existingData.magic_link_sent_at);
  const shouldSend =
    !options.skipMagicLink && (options.forceResendMagicLink || !alreadySent);

  if (shouldSend) {
    try {
      const magicLink = await adminAuth.generateSignInWithEmailLink(email, {
        url: options.magicLinkReturnUrl ?? DEFAULT_MAGIC_LINK_RETURN_URL,
        handleCodeInApp: true,
      });

      let firstName = options.firstName ?? null;
      if (firstName === null && shopifyCustomerId) {
        try {
          firstName = await getCustomerFirstNameById(shopifyCustomerId);
        } catch {
          // Non-fatal — email can address them without a name.
        }
      }

      await sendPlainText({
        to: email,
        subject: "Unlock your Mully account",
        text: `Hey${firstName ? ` ${firstName}` : ""},\n\nYour Mully membership is active. Click the link below to unlock your dashboard — no password needed:\n\n${magicLink}\n\nSee you inside,\nDrew`,
        disableTracking: true,
        sendClass: "transactional",
        category: "magic_link_unlock",
      });

      await userRef.set(
        { magic_link_sent_at: Date.now() },
        { merge: true }
      );
      magicLinkSent = true;
    } catch (err) {
      // Email failure should NOT roll back provisioning. The user can still
      // request a fresh magic link from /login themselves.
      console.error("[provisionPaidMember] magic link email failed:", err);
    }
  }

  // 4. Kick off the tier-appropriate welcome sequence. Fire-and-forget.
  const flow: EmailFlow = tier === "member" ? "member" : "access";
  void startFlow(uid, email, options.firstName ?? null, flow).catch((err) => {
    console.error("[provisionPaidMember] startFlow failed:", err);
  });

  return {
    status: "provisioned",
    uid,
    email,
    tier,
    isLegacy,
    legacyPlan,
    shopifyCustomerId,
    isNewFirebaseUser,
    magicLinkSent,
  };
}

/**
 * Cheap read-only variant used by the homepage EmailCTA. Does NOT touch
 * Firebase Auth or Firestore — just answers "is this email an active
 * Loop subscriber?". Callers that get `true` should then POST to
 * /api/auth/check-loop-status to actually provision + send the link.
 *
 * Kept here so both the read and write paths share the exact same
 * definition of "active Loop membership".
 */
export async function isActiveLoopSubscriber(
  rawEmail: string
): Promise<boolean> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return false;

  try {
    const shopifyCustomerId = await resolveCustomerByEmail(email);
    const identifier = shopifyCustomerId ?? email;
    const status = await getLoopSubscriptionStatus(identifier);
    return status.mullybox_active === true;
  } catch (err) {
    console.error("[isActiveLoopSubscriber] lookup failed:", err);
    return false;
  }
}
