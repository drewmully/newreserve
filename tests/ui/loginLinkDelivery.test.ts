import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLoginContinueUrl, loginLinkTargetFromLocation, resolveLoginOrigin } from "@/lib/loginLink";
import { LoginLinkError, requestLoginLink } from "@/lib/requestLoginLink";
import { mapAuthError } from "@/app/login/loginErrors";

const mocks = vi.hoisted(() => ({ sendSignInLinkToEmail: vi.fn() }));

vi.mock("firebase/app", () => ({ initializeApp: vi.fn(() => ({})), getApps: () => [], getApp: vi.fn() }));
vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({ name: "auth" })),
  sendSignInLinkToEmail: mocks.sendSignInLinkToEmail,
  isSignInWithEmailLink: vi.fn(),
  signInWithEmailLink: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: vi.fn(),
  connectAuthEmulator: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));
vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(() => ({})), doc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn(),
  updateDoc: vi.fn(), serverTimestamp: vi.fn(), connectFirestoreEmulator: vi.fn(),
}));
vi.mock("firebase/storage", () => ({
  getStorage: vi.fn(() => ({})), ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn(),
}));

function jsonResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** The pre-change sendOTPEmail continue URL logic, verbatim, for parity checks. */
async function legacyContinueUrl(origin: string, pathname: string, search: string) {
  const { shopReturnFromLogin } = await import("@/lib/shopLogin");
  const destination = new URL("/login", origin);
  const shopReturn = pathname === "/login" ? shopReturnFromLogin(search) : null;
  if (shopReturn) destination.searchParams.set("returnTo", shopReturn);
  if (pathname === "/login" && new URLSearchParams(search).get("paid") === "1") {
    destination.searchParams.set("paid", "1");
  }
  return destination.toString();
}

describe("continue URL parity with the old client-side sendOTPEmail", () => {
  it.each([
    ["/login", ""],
    ["/login", "?returnTo=%2Fshop%23edit"],
    ["/login", "?returnTo=%2Fshop%2Fproducts%2Fvest%3Fcolor%3Dnavy"],
    ["/login", "?returnTo=%2F"],
    ["/login", "?returnTo=https%3A%2F%2Fevil.example"],
    ["/login", "?returnTo=%2Faccount"],
    ["/login", "?paid=1"],
    ["/login", "?paid=1&returnTo=%2Fshop"],
    ["/login", "?paid_member=1&returnTo=%2Fshop"],
    ["/login", "?paid=0&returnTo=%2Fshop"],
    ["/onboarding", "?returnTo=%2Fshop&paid=1"],
    ["/account", ""],
    ["/home", "?paid=1"],
  ])("%s%s", async (pathname, search) => {
    const origin = "https://www.mymully.com";
    const target = loginLinkTargetFromLocation(pathname, search);
    expect(buildLoginContinueUrl(origin, target)).toBe(await legacyContinueUrl(origin, pathname, search));
  });

  it("resolveLoginOrigin falls back to production for anything unknown", () => {
    expect(resolveLoginOrigin(undefined, {})).toBe("https://www.mymully.com");
    expect(resolveLoginOrigin("https://evil.example", { NODE_ENV: "development" })).toBe("https://www.mymully.com");
    expect(resolveLoginOrigin("http://localhost:3000", { NODE_ENV: "production" })).toBe("https://www.mymully.com");
    expect(resolveLoginOrigin("http://localhost:3000", { NODE_ENV: "development" })).toBe("http://localhost:3000");
  });
});

describe("requestLoginLink fallback", () => {
  const firebaseFallback = vi.fn();
  beforeEach(() => {
    firebaseFallback.mockReset().mockResolvedValue(undefined);
  });

  it("uses Resend and skips Firebase on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    await expect(requestLoginLink("a@b.co", { paid: true }, { fetchImpl, firebaseFallback })).resolves.toBe("resend");
    expect(firebaseFallback).not.toHaveBeenCalled();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/auth/send-login-link");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ email: "a@b.co", paid: true });
  });

  it.each([500, 502, 503, 504, 404])("falls back to Firebase on %s", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status));
    const onFallback = vi.fn();
    await expect(
      requestLoginLink("a@b.co", {}, { fetchImpl, firebaseFallback, onFallback })
    ).resolves.toBe("firebase");
    expect(firebaseFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith(`status ${status}`);
  });

  it("falls back to Firebase on a 200 that isn't the route's JSON (e.g. an HTML page)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>maintenance</html>", { status: 200 }));
    await expect(requestLoginLink("a@b.co", {}, { fetchImpl, firebaseFallback })).resolves.toBe("firebase");
    expect(firebaseFallback).toHaveBeenCalledTimes(1);
  });

  it("falls back to Firebase on a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(requestLoginLink("a@b.co", {}, { fetchImpl, firebaseFallback })).resolves.toBe("firebase");
    expect(firebaseFallback).toHaveBeenCalledTimes(1);
  });

  it("falls back to Firebase when the route hangs past the timeout", async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })
    );
    await expect(
      requestLoginLink("a@b.co", {}, { fetchImpl: fetchImpl as unknown as typeof fetch, firebaseFallback, timeoutMs: 10 })
    ).resolves.toBe("firebase");
    expect(firebaseFallback).toHaveBeenCalledTimes(1);
  });

  it("does NOT fall back on 429 and surfaces a too-many-requests code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { code: "auth/too-many-requests" }));
    const err = await requestLoginLink("a@b.co", {}, { fetchImpl, firebaseFallback }).catch((e) => e);
    expect(err).toBeInstanceOf(LoginLinkError);
    expect(err.code).toBe("auth/too-many-requests");
    expect(mapAuthError(err.code)).toBe("Too many attempts. Please wait a few minutes and try again.");
    expect(firebaseFallback).not.toHaveBeenCalled();
  });

  it("does NOT fall back on 400 and surfaces an invalid-email code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400));
    const err = await requestLoginLink("a@b.co", {}, { fetchImpl, firebaseFallback }).catch((e) => e);
    expect(err.code).toBe("auth/invalid-email");
    expect(mapAuthError(err.code, "send")).toBe("Please enter a valid email address.");
    expect(firebaseFallback).not.toHaveBeenCalled();
  });

  it("propagates Firebase fallback errors (e.g. quota) so callers show the mapped copy", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503));
    firebaseFallback.mockRejectedValue(Object.assign(new Error("quota"), { code: "auth/quota-exceeded" }));
    const err = await requestLoginLink("a@b.co", {}, { fetchImpl, firebaseFallback }).catch((e) => e);
    expect(err.code).toBe("auth/quota-exceeded");
  });
});

describe("sendOTPEmail (lib/firebase)", () => {
  beforeEach(() => {
    mocks.sendSignInLinkToEmail.mockReset().mockResolvedValue(undefined);
    localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("posts returnTo from /login to the route and remembers the email", async () => {
    window.history.replaceState({}, "", "/login?returnTo=%2Fshop%23edit");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { sendOTPEmail } = await import("@/lib/firebase");
    await sendOTPEmail("jane@yahoo.com");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: "jane@yahoo.com", continuePath: "/shop#edit" });
    expect(mocks.sendSignInLinkToEmail).not.toHaveBeenCalled();
    expect(localStorage.getItem("emailForSignIn")).toBe("jane@yahoo.com");
    vi.unstubAllGlobals();
  });

  it("falls back to sendSignInLinkToEmail with the same continue URL as before", async () => {
    window.history.replaceState({}, "", "/login?paid=1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(503)));
    const { sendOTPEmail } = await import("@/lib/firebase");
    await sendOTPEmail("jane@yahoo.com");
    expect(mocks.sendSignInLinkToEmail).toHaveBeenCalledWith(expect.anything(), "jane@yahoo.com", {
      url: `${window.location.origin}/login?paid=1`,
      handleCodeInApp: true,
    });
    expect(localStorage.getItem("emailForSignIn")).toBe("jane@yahoo.com");
    vi.unstubAllGlobals();
  });

  it("does not store the email or fall back when rate limited", async () => {
    window.history.replaceState({}, "", "/account");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429)));
    const { sendOTPEmail } = await import("@/lib/firebase");
    await expect(sendOTPEmail("jane@yahoo.com")).rejects.toMatchObject({ code: "auth/too-many-requests" });
    expect(mocks.sendSignInLinkToEmail).not.toHaveBeenCalled();
    expect(localStorage.getItem("emailForSignIn")).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("auth/quota-exceeded copy", () => {
  it("has specific, non-generic copy", () => {
    const copy = mapAuthError("auth/quota-exceeded", "send");
    expect(copy).not.toBe("Something went wrong. Please try again.");
    expect(copy).toMatch(/try again later/);
  });
});
