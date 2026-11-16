import { describe, expect, it } from "vitest";
import {
  DEAD_LINK_MESSAGE, WRONG_EMAIL_FOR_LINK_MESSAGE, IN_APP_BROWSER_GOOGLE_HINT,
  isInAppBrowser, isRetryableAuthError, isValidEmail, isWrongEmailForLink, mapAuthError,
  normalizeEmail, shouldFallBackToGoogleRedirect, stripEmailLinkParams,
} from "@/app/login/loginErrors";

describe("mapAuthError", () => {
  it("maps invalid-email differently for link sign-in", () => {
    expect(mapAuthError("auth/invalid-email", "link")).toBe(WRONG_EMAIL_FOR_LINK_MESSAGE);
    expect(mapAuthError("auth/invalid-email", "send")).toBe("Please enter a valid email address.");
  });
  it.each([
    "auth/popup-blocked", "auth/popup-closed-by-user", "auth/operation-not-supported-in-this-environment",
    "auth/network-request-failed", "auth/account-exists-with-different-credential", "auth/missing-email",
    "auth/invalid-action-code", "auth/expired-action-code",
  ])("has specific copy for %s", (code) => {
    expect(mapAuthError(code, "google")).not.toBe("Something went wrong. Please try again.");
  });
  it("dead links and in-app browsers get the shared copy", () => {
    expect(mapAuthError("auth/expired-action-code", "link")).toBe(DEAD_LINK_MESSAGE);
    expect(mapAuthError("auth/invalid-action-code", "link")).toBe(DEAD_LINK_MESSAGE);
    expect(mapAuthError("auth/operation-not-supported-in-this-environment", "google")).toBe(IN_APP_BROWSER_GOOGLE_HINT);
    expect(mapAuthError("auth/whatever")).toBe("Something went wrong. Please try again.");
  });
});

describe("retry and fallback rules", () => {
  it("never retries dead or wrong-email codes", () => {
    for (const code of ["auth/invalid-action-code", "auth/expired-action-code", "auth/invalid-email", "auth/missing-email"]) {
      expect(isRetryableAuthError({ code })).toBe(false);
    }
    expect(isRetryableAuthError({ code: "auth/network-request-failed" })).toBe(true);
    expect(isWrongEmailForLink({ code: "auth/invalid-email" })).toBe(true);
    expect(isWrongEmailForLink({ code: "auth/expired-action-code" })).toBe(false);
  });
  it("redirect fallback only outside in-app browsers", () => {
    expect(shouldFallBackToGoogleRedirect("auth/popup-blocked", false)).toBe(true);
    expect(shouldFallBackToGoogleRedirect("auth/operation-not-supported-in-this-environment", false)).toBe(true);
    expect(shouldFallBackToGoogleRedirect("auth/popup-blocked", true)).toBe(false);
    expect(shouldFallBackToGoogleRedirect("auth/popup-closed-by-user", false)).toBe(false);
  });
  it("detects common in-app browsers", () => {
    expect(isInAppBrowser("Mozilla/5.0 (iPhone) Instagram 300.0")).toBe(true);
    expect(isInAppBrowser("Mozilla/5.0 [FBAN/FBIOS;FBAV/400]")).toBe(true);
    expect(isInAppBrowser("Mozilla/5.0 (Linux; Android 14; wv) Chrome/120")).toBe(true);
    expect(isInAppBrowser("Mozilla/5.0 (iPhone) Version/17.0 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isInAppBrowser(undefined)).toBe(false);
  });
});

describe("email helpers", () => {
  it("normalizes and validates", () => {
    expect(normalizeEmail("  A@B.Co ")).toBe("a@b.co");
    expect(isValidEmail("a@b.co")).toBe(true);
    for (const bad of ["a@b", "a b@c.co", "@c.co", ""]) expect(isValidEmail(bad)).toBe(false);
  });
  it("strips only Firebase link params", () => {
    expect(stripEmailLinkParams("https://mymully.com/login?returnTo=%2Fshop&apiKey=k&oobCode=X&mode=signIn&lang=en&paid=1#top"))
      .toBe("/login?returnTo=%2Fshop&paid=1#top");
    expect(stripEmailLinkParams("https://mymully.com/login?oobCode=X")).toBe("/login");
  });
});
