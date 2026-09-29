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

vi.mock("@/lib/onboardingProfile", () => ({
  buildCompleteOnboardingUpdatePayload: vi.fn(),
  fromFirestoreOnboardingProfile: () => null,
}));

function makeShopifyCart(id: string) {
  return {
    id,
    checkoutUrl: `https://checkout.example/${id}`,
    lines: [
      {
        id: "line_1",
        productSlug: "club-cap",
        productName: "Club Cap",
        brand: "Mully",
        price: 38,
        quantity: 1,
        variantId: "gid://shopify/ProductVariant/1",
        image: "https://cdn.example/cap.jpg",
      },
    ],
  };
}

type MembershipValue = ReturnType<typeof import("@/app/context/MembershipContext")["useMembership"]>;
let useMembershipHook: (() => MembershipValue) | null = null;
let membership: MembershipValue;

function CartProbe() {
  if (!useMembershipHook) {
    throw new Error("Membership hook not initialized");
  }
  membership = useMembershipHook();
  const { cart, cartId } = membership;
  return (
    <div>
      <span data-testid="cart-id">{cartId ?? "none"}</span>
      <span data-testid="cart-count">{String(cart.length)}</span>
    </div>
  );
}

async function loadProvider() {
  const mod = await import("@/app/context/MembershipContext");
  useMembershipHook = mod.useMembership;
  return mod.MembershipProvider;
}

describe("Membership cart persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.onAuthStateChanged.mockReset().mockImplementation((_: unknown, callback: (user: unknown) => void) => {
      callback(mocks.getCurrentUser());
      return vi.fn();
    });
    mocks.firebaseSignOut.mockReset();
    mocks.getDoc.mockReset();
    mocks.updateDoc.mockReset().mockResolvedValue(undefined);
    mocks.doc.mockClear();
    mocks.serverTimestamp.mockClear();
    mocks.syncUserProfile.mockReset().mockResolvedValue({
      username: "",
      onboarding_completed: false,
      messaging_preferences: { email_marketing: true, sms_marketing: false },
      fit_profile: null,
      onboarding_profile: null,
      tier: "free",
      store_credit: { balance_cents: 0, currency: "USD" },
      subscriptions: {
        mullybox_active: false,
        status: "none",
        total_subscription_count: 0,
        active_subscription_ids: [],
        manage_url: null,
        next_unblock_url: null,
      },
    });
    mocks.getCart.mockReset();
    mocks.cartAttributesUpdate.mockReset();
    mocks.updateCartBuyerIdentity.mockReset();
    mocks.cartCreate.mockReset();
    mocks.cartLinesAdd.mockReset();
    mocks.cartLinesRemove.mockReset();
    mocks.cartLinesUpdate.mockReset();
    mocks.cartDiscountCodesUpdate.mockReset();
    mocks.trackEvent.mockClear();
    mocks.fetchMock.mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ subscriptions: [], source: "no_customer" }),
    });
    vi.stubGlobal("fetch", mocks.fetchMock);
  });

  it("rehydrates a guest cart from localStorage when no user is signed in", async () => {
    mocks.setCurrentUser(null);
    localStorage.setItem("mully_cart_id_guest", "guest-cart");
    mocks.getCart.mockResolvedValue(makeShopifyCart("guest-cart"));
    mocks.cartAttributesUpdate.mockResolvedValue(makeShopifyCart("guest-cart"));

    const MembershipProvider = await loadProvider();

    render(
      <MembershipProvider>
        <CartProbe />
      </MembershipProvider>
    );

    await waitFor(() => expect(screen.getByTestId("cart-id")).toHaveTextContent("guest-cart"));
    expect(screen.getByTestId("cart-count")).toHaveTextContent("1");
    expect(mocks.getCart).toHaveBeenCalledWith("guest-cart");
    expect(mocks.updateCartBuyerIdentity).not.toHaveBeenCalled();
  });

  it("batches different sizes, persists the real cart, and removes only the requested line", async () => {
    mocks.setCurrentUser(null);
    const Provider = await loadProvider();
    render(<Provider><CartProbe /></Provider>);
    const first = makeShopifyCart("batch");
    first.lines[0].variantId = "gid://shopify/ProductVariant/1";
    const second = {...first.lines[0],id:"line_2",variantId:"gid://shopify/ProductVariant/2"};
    const result = {...first,lines:[first.lines[0],second],discountCodes:[{code:"BOGO15",applicable:true}]};
    mocks.cartCreate.mockResolvedValue(result);
    mocks.cartDiscountCodesUpdate.mockResolvedValue(result);
    await act(async () => {
      await membership.addItemsToCart([1,2].map(id => ({slug:"club-cap",name:"Club Cap",brand:"Mully",price:38,variantId:`gid://shopify/ProductVariant/${id}`})), "BOGO15");
    });
    expect(mocks.cartCreate.mock.calls[0][0]).toHaveLength(2);
    expect(membership.cart).toHaveLength(2);
    expect(membership.cartOpen).toBe(true);
    expect(localStorage.getItem("mully_cart_id_guest")).toBe("batch");
    mocks.cartLinesRemove.mockResolvedValue({...result,lines:[second]});
    await act(async () => { await membership.removeFromCart("line_1"); });
    expect(mocks.cartLinesRemove).toHaveBeenCalledWith("batch",["line_1"]);
    expect(membership.cart[0].variantId).toBe(second.variantId);
  });

  it("does not create a simulated successful bag on Shopify failure", async () => {
    mocks.setCurrentUser(null);
    const Provider = await loadProvider();
    render(<Provider><CartProbe /></Provider>);
    mocks.cartCreate.mockRejectedValue(new Error("Unavailable"));
    await act(async () => {
      await expect(membership.addItemsToCart([{slug:"cap",name:"Cap",brand:"Mully",price:38,variantId:"gid://shopify/ProductVariant/1"}])).rejects.toThrow("Unavailable");
    });
    expect(membership.cart).toHaveLength(0);
    expect(membership.cartLoading).toBe(false);
  });

  it("clears stale signed-in cart ids and migrates a valid guest cart to the member", async () => {
    mocks.setCurrentUser({
      uid: "uid_123",
      email: "member@example.com",
      displayName: "",
      providerData: [{ providerId: "password" }],
      getIdToken: vi.fn().mockResolvedValue("token-123"),
    });

    localStorage.setItem("mully_cart_id_guest", "guest-cart");
    localStorage.setItem("mully_cart_id_uid_123", "user-local-cart");

    mocks.getDoc.mockImplementation(async (ref: string) => {
      if (ref === "users/uid_123") {
        return {
          data: () => ({
            cart: { cart_id: "stale-firestore-cart" },
          }),
        };
      }

      if (ref === "registry_applications/uid_123") {
        return {
          data: () => ({}),
        };
      }

      throw new Error(`Unexpected doc lookup ${ref}`);
    });

    mocks.getCart.mockImplementation(async (id: string) => {
      if (id === "stale-firestore-cart") return null;
      if (id === "user-local-cart") return null;
      if (id === "guest-cart") return makeShopifyCart("guest-cart");
      throw new Error(`Unexpected cart id ${id}`);
    });
    mocks.cartAttributesUpdate.mockResolvedValue(makeShopifyCart("guest-cart"));

    const MembershipProvider = await loadProvider();

    render(
      <MembershipProvider>
        <CartProbe />
      </MembershipProvider>
    );

    await waitFor(() => expect(screen.getByTestId("cart-id")).toHaveTextContent("guest-cart"));
    expect(screen.getByTestId("cart-count")).toHaveTextContent("1");

    expect(mocks.updateDoc).toHaveBeenCalledWith("users/uid_123", {
      "cart.cart_id": null,
      "cart.updated_at": "server-ts",
    });
    expect(mocks.updateDoc).toHaveBeenCalledWith("users/uid_123", {
      "cart.cart_id": "guest-cart",
      "cart.updated_at": "server-ts",
    });
    expect(localStorage.getItem("mully_cart_id_guest")).toBeNull();
    expect(localStorage.getItem("mully_cart_id_uid_123")).toBe("guest-cart");
    expect(mocks.updateCartBuyerIdentity).toHaveBeenCalledWith("guest-cart", {
      email: "member@example.com",
    });
  });
});
