import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const onAuthStateChanged = vi.fn();
  const firebaseSignOut = vi.fn();
  const getDoc = vi.fn();
  const updateDoc = vi.fn();
  const doc = vi.fn((_: unknown, collection: string, id: string) => `${collection}/${id}`);
  const serverTimestamp = vi.fn(() => "server-ts");
  const syncUserProfile = vi.fn();
  const getCart = vi.fn();
  const cartAttributesUpdate = vi.fn();
  const updateCartBuyerIdentity = vi.fn();
  const cartCreate = vi.fn();
  const cartLinesAdd = vi.fn();
  const cartLinesRemove = vi.fn();
  const cartLinesUpdate = vi.fn();
  const cartDiscountCodesUpdate = vi.fn();
  const trackEvent = vi.fn().mockResolvedValue(undefined);
  const fetchMock = vi.fn();

  let currentUser: Record<string, unknown> | null = null;

  return {
    onAuthStateChanged,
    firebaseSignOut,
    getDoc,
    updateDoc,
    doc,
    serverTimestamp,
    syncUserProfile,
    getCart,
    cartAttributesUpdate,
    updateCartBuyerIdentity,
    cartCreate,
    cartLinesAdd,
    cartLinesRemove,
    cartLinesUpdate,
    cartDiscountCodesUpdate,
    trackEvent,
    fetchMock,
    getCurrentUser: () => currentUser,
    setCurrentUser: (value: Record<string, unknown> | null) => {
      currentUser = value;
    },
  };
});

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: mocks.onAuthStateChanged,
  signOut: mocks.firebaseSignOut,
}));

vi.mock("firebase/firestore", () => ({
  doc: mocks.doc,
  updateDoc: mocks.updateDoc,
  getDoc: mocks.getDoc,
  serverTimestamp: mocks.serverTimestamp,
}));

vi.mock("@/lib/firebase", () => ({
  auth: {},
  db: {},
  syncUserProfile: mocks.syncUserProfile,
  sendOTPEmail: vi.fn(),
  confirmOTPSignIn: vi.fn(),
}));

vi.mock("@/lib/tracking", () => ({
  identifyAnalyticsUser: vi.fn().mockResolvedValue(undefined),
  trackEvent: mocks.trackEvent,
}));

vi.mock("@/lib/shopify", () => ({
  cartCreate: mocks.cartCreate,
  cartAttributesUpdate: mocks.cartAttributesUpdate,
  cartLinesAdd: mocks.cartLinesAdd,
  cartLinesRemove: mocks.cartLinesRemove,
  cartLinesUpdate: mocks.cartLinesUpdate,
  cartDiscountCodesUpdate: mocks.cartDiscountCodesUpdate,
  updateCartBuyerIdentity: mocks.updateCartBuyerIdentity,
  getCart: mocks.getCart,
}));

vi.mock("@/lib/shopifyCheckoutOrigin", () => ({
  buildCheckoutOriginAttributes: () => [{ key: "origin", value: "newreserve" }],
}));

vi.mock("@/lib/membershipConfig", () => ({
  resolveMemberTierFromVariantId: () => null,
  resolveLegacyFromVariantId: () => null,
  getTierLabel: () => "Free",
}));

vi.mock("@/lib/onboardingProfile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/onboardingProfile")>();
  return {
    ...actual,
    buildCompleteOnboardingUpdatePayload: () => ({
      normalizedOnboardingProfile: { goal: "x" },
      normalizedFitProfile: null,
      updates: { username: "jane", onboarding_completed: true },
    }),
    fromFirestoreOnboardingProfile: () => null,
  };
});

type MembershipValue = ReturnType<typeof import("@/app/context/MembershipContext")["useMembership"]>;
let membership: MembershipValue;

async function renderProvider() {
  const mod = await import("@/app/context/MembershipContext");
  const capture = (value: MembershipValue) => { membership = value; };
  function Probe({ onValue }: { onValue: (v: MembershipValue) => void }) {
    const value = mod.useMembership();
    onValue(value);
    return <span data-testid="completed">{String(value.onboardingCompleted)}</span>;
  }
  render(<mod.MembershipProvider><Probe onValue={capture} /></mod.MembershipProvider>);
  await waitFor(() => expect(mocks.syncUserProfile).toHaveBeenCalled());
}

describe("completeOnboarding", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.setCurrentUser({ uid: "uid_1", email: "jane@example.com", getIdToken: vi.fn().mockResolvedValue("t"), providerData: [], displayName: null, phoneNumber: null });
    mocks.onAuthStateChanged.mockReset().mockImplementation((_: unknown, cb: (u: unknown) => void) => {
      cb(mocks.getCurrentUser());
      return vi.fn();
    });
    mocks.updateDoc.mockReset().mockResolvedValue(undefined);
    mocks.syncUserProfile.mockReset().mockResolvedValue({
      username: "", onboarding_completed: false,
      messaging_preferences: { email_marketing: true, sms_marketing: false },
      fit_profile: null, onboarding_profile: null, tier: "free",
      store_credit: { balance_cents: 0, currency: "USD" },
      subscriptions: { mullybox_active: false, status: "none", total_subscription_count: 0, active_subscription_ids: [], manage_url: null, next_unblock_url: null },
    });
    mocks.getCart.mockReset();
    mocks.cartCreate.mockReset();
    mocks.fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ subscriptions: [], source: "no_customer" }) });
    vi.stubGlobal("fetch", mocks.fetchMock);
  });

  it("rejects with OnboardingSaveError and leaves local state untouched when Firestore denies the write", async () => {
    const { OnboardingSaveError } = await import("@/lib/onboardingProfile");
    mocks.updateDoc.mockRejectedValue(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }));
    await renderProvider();
    let caught: unknown;
    await act(async () => {
      await membership.completeOnboarding({ username: "jane", onboardingProfile: {} as never, phone: "+15555550123", smsOptIn: true }).catch((e) => { caught = e; });
    });
    expect(caught).toBeInstanceOf(OnboardingSaveError);
    expect((caught as Error).message).toMatch(/couldn.t save/i);
    expect(screen.getByTestId("completed").textContent).toBe("false");
  });

  it("writes E.164 phone + SMS consent and marks completed after a successful save", async () => {
    await renderProvider();
    await act(async () => {
      await membership.completeOnboarding({ username: "jane", onboardingProfile: {} as never, phone: "+15555550123", smsOptIn: true });
    });
    const updates = mocks.updateDoc.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(updates).toMatchObject({ phone_e164: "+15555550123", "messaging_preferences.sms_marketing": true, sms_consent_given_at: "server-ts" });
    expect(screen.getByTestId("completed").textContent).toBe("true");
  });

  it("drops a non-E.164 phone (and its SMS consent) instead of failing the save", async () => {
    await renderProvider();
    await act(async () => {
      await membership.completeOnboarding({ username: "jane", onboardingProfile: {} as never, phone: "555-0123", smsOptIn: true });
    });
    const updates = mocks.updateDoc.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(updates).not.toHaveProperty("phone_e164");
    expect(updates).not.toHaveProperty("sms_consent_given_at");
    expect(updates["messaging_preferences.sms_marketing"]).toBe(false);
  });
});
