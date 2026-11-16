/**
 * Firestore rules for users/{uid}. Runs only against the local emulator
 * (demo- project id, so it can never touch production):
 *   npm run test:rules
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc, deleteField } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const UID = "uid_alice";
let env: RulesTestEnvironment;

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  const [h, p] = host.split(":");
  env = await initializeTestEnvironment({
    projectId: "demo-mully-rules",
    firestore: { rules: readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8"), host: h, port: Number(p) },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

/** Seed as admin (bypasses rules), like server routes do. */
async function seed(data: Record<string, unknown>, uid = UID) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", uid), data);
  });
}
function asAlice(email = "alice@example.com") {
  return env.authenticatedContext(UID, { email }).firestore();
}

/** Typical doc created client-side by syncUserProfile. */
const clientDoc = () => ({
  email: "alice@example.com",
  created_at: Timestamp.fromMillis(1_700_000_000_000),
  last_login: Timestamp.fromMillis(1_700_000_000_000),
  updated_at: Timestamp.fromMillis(1_700_000_000_000),
  shopify_customer_id: null,
  username: "",
  onboarding_completed: false,
  messaging_preferences: { email_marketing: true, sms_marketing: false, push_notifications: false },
  tier: "free",
});

/** Doc written by orders-paid / start-account / Loop provisioning (Admin SDK). */
const serverCreatedDoc = () => ({
  email: "alice@example.com",
  tier: "member",
  onboarding_completed: false,
  updated_at: 1_700_000_000_000,
});

const onboardingUpdate = (extra: Record<string, unknown> = {}) => ({
  username: "alice",
  onboarding_completed: true,
  onboarding_profile: { handicap: "12" },
  updated_at: serverTimestamp(),
  "messaging_preferences.email_marketing": true,
  "messaging_preferences.sms_marketing": true,
  ...extra,
});

describe("onboarding phone + SMS consent (#7)", () => {
  it("accepts phone_e164 and sms_consent_given_at = request.time with sms opt-in", async () => {
    await seed(clientDoc());
    const ref = doc(asAlice(), "users", UID);
    await assertSucceeds(updateDoc(ref, onboardingUpdate({ phone_e164: "+15555550123", sms_consent_given_at: serverTimestamp() })));
    const snap = await getDoc(ref);
    expect(snap.get("phone_e164")).toBe("+15555550123");
  });

  it("accepts phone_e164 without SMS consent", async () => {
    await seed(clientDoc());
    await assertSucceeds(updateDoc(doc(asAlice(), "users", UID), onboardingUpdate({ "messaging_preferences.sms_marketing": false, phone_e164: "+447911123456" })));
  });

  it.each(["5555550123", "+0555550123", "+1 555 555 0123", "+1555", "+1234567890123456", "tel:+15555550123"])(
    "rejects non-E.164 phone %s", async (phone) => {
      await seed(clientDoc());
      await assertFails(updateDoc(doc(asAlice(), "users", UID), onboardingUpdate({ phone_e164: phone })));
    });

  it("rejects a non-string phone", async () => {
    await seed(clientDoc());
    await assertFails(updateDoc(doc(asAlice(), "users", UID), { phone_e164: 15555550123 }));
  });

  it("rejects a backdated or client-chosen consent timestamp", async () => {
    await seed(clientDoc());
    await assertFails(updateDoc(doc(asAlice(), "users", UID), onboardingUpdate({ phone_e164: "+15555550123", sms_consent_given_at: Timestamp.fromMillis(1_600_000_000_000) })));
    await assertFails(updateDoc(doc(asAlice(), "users", UID), onboardingUpdate({ phone_e164: "+15555550123", sms_consent_given_at: Date.now() })));
  });

  it("rejects consent without a phone or without sms opt-in", async () => {
    await seed(clientDoc());
    await assertFails(updateDoc(doc(asAlice(), "users", UID), onboardingUpdate({ sms_consent_given_at: serverTimestamp() })));
    await assertFails(updateDoc(doc(asAlice(), "users", UID), onboardingUpdate({
      phone_e164: "+15555550123", "messaging_preferences.sms_marketing": false, sms_consent_given_at: serverTimestamp(),
    })));
  });

  it("does not let the owner delete a recorded consent", async () => {
    await seed({ ...clientDoc(), phone_e164: "+15555550123", sms_consent_given_at: Timestamp.now(), messaging_preferences: { email_marketing: true, sms_marketing: true, push_notifications: false } });
    await assertFails(updateDoc(doc(asAlice(), "users", UID), { sms_consent_given_at: deleteField() }));
  });
});

describe("server-created docs (PERMISSION_DENIED diagnosis)", () => {
  it("lets the owner sync last_login on a doc that has no created_at / shopify_customer_id", async () => {
    await seed(serverCreatedDoc());
    await assertSucceeds(updateDoc(doc(asAlice(), "users", UID), {
      email: "alice@example.com", last_login: serverTimestamp(), updated_at: serverTimestamp(),
    }));
  });

  it("lets the owner finish onboarding on a server-created doc", async () => {
    await seed(serverCreatedDoc());
    await assertSucceeds(updateDoc(doc(asAlice(), "users", UID), onboardingUpdate({ phone_e164: "+15555550123", sms_consent_given_at: serverTimestamp() })));
  });

  it("still forbids adding shopify_customer_id or created_at to such a doc", async () => {
    await seed(serverCreatedDoc());
    await assertFails(updateDoc(doc(asAlice(), "users", UID), { shopify_customer_id: "123" }));
    await assertFails(updateDoc(doc(asAlice(), "users", UID), { created_at: serverTimestamp() }));
  });
});

describe("unchanged protections", () => {
  it("shopify_customer_id and created_at remain immutable", async () => {
    await seed({ ...clientDoc(), shopify_customer_id: "999" });
    await assertFails(updateDoc(doc(asAlice(), "users", UID), { shopify_customer_id: "111" }));
    await assertFails(updateDoc(doc(asAlice(), "users", UID), { shopify_customer_id: null }));
    await assertFails(updateDoc(doc(asAlice(), "users", UID), { created_at: serverTimestamp() }));
  });

  it("fields outside the allowlist are still rejected", async () => {
    await seed(clientDoc());
    for (const field of ["store_credit", "subscriptions", "segments", "latest_purchase", "password_set", "tier_paid_at"]) {
      await assertFails(updateDoc(doc(asAlice(), "users", UID), { [field]: "x" }));
    }
  });

  it("other users cannot read or write", async () => {
    await seed(clientDoc());
    const bob = env.authenticatedContext("uid_bob", { email: "bob@example.com" }).firestore();
    await assertFails(getDoc(doc(bob, "users", UID)));
    await assertFails(updateDoc(doc(bob, "users", UID), { username: "bob" }));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "users", UID)));
  });

  it("email may only change to the signed-in token email (now case-insensitive)", async () => {
    await seed({ ...clientDoc(), email: "Alice@Example.com" });
    // syncUserProfile now writes the lowercased token email.
    await assertSucceeds(updateDoc(doc(asAlice("Alice@Example.com"), "users", UID), { email: "alice@example.com" }));
    await assertFails(updateDoc(doc(asAlice(), "users", UID), { email: "mallory@example.com" }));
  });

  it("KNOWN (#2, separate PR): tier / isLegacy / legacyPlan are still client-writable", async () => {
    await seed(clientDoc());
    await assertSucceeds(updateDoc(doc(asAlice(), "users", UID), { tier: "member", isLegacy: true, legacyPlan: "x" }));
  });

  it("deletes are denied", async () => {
    await seed(clientDoc());
    const { deleteDoc } = await import("firebase/firestore");
    await assertFails(deleteDoc(doc(asAlice(), "users", UID)));
  });
});
