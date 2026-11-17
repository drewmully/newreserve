/**
 * End-to-end check against the Firebase Auth emulator: the link that
 * POST /api/auth/send-login-link generates with the Admin SDK is accepted by
 * the existing client-side confirm path (isSignInWithEmailLink +
 * signInWithEmailLink, i.e. confirmOTPSignIn), and carries the same
 * continue URL the old client-side sendSignInLinkToEmail used.
 *
 * Only Resend is stubbed. Run with: npm run test:auth-emulator
 */
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp as initAdminApp, getApps as getAdminApps } from "firebase-admin/app";
import { initializeApp as initClientApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut,
  type Auth,
} from "firebase/auth";
import { stripEmailLinkParams } from "@/app/login/loginErrors";

const { sendPlainTextMock } = vi.hoisted(() => ({ sendPlainTextMock: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({ sendPlainText: sendPlainTextMock }));

const PROJECT_ID = "demo-mully-reserve";
const EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;

let clientAuth: Auth;

function request(body: Record<string, unknown>, ip: string) {
  return new NextRequest("http://localhost/api/auth/send-login-link", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip, origin: "https://www.mymully.com" },
    body: JSON.stringify(body),
  });
}

function linkFromLastEmail(): string {
  const { text } = sendPlainTextMock.mock.calls.at(-1)![0] as { text: string };
  const line = text.split("\n").find((l) => /^https?:\/\//.test(l));
  if (!line) throw new Error("no link in email");
  return line;
}

/**
 * What the browser ends up on: Firebase's action handler redirects to the
 * continue URL with the one-time-code params appended, and /login hands
 * window.location.href to confirmOTPSignIn.
 */
function landingUrl(emailLink: string): string {
  const link = new URL(emailLink);
  const landing = new URL(link.searchParams.get("continueUrl")!);
  for (const key of ["apiKey", "oobCode", "mode", "lang"]) {
    const value = link.searchParams.get(key);
    if (value) landing.searchParams.set(key, value);
  }
  return landing.toString();
}

describe.skipIf(!EMULATOR_HOST)("send-login-link against the Auth emulator", () => {
  beforeAll(() => {
    // Admin SDK picks up FIREBASE_AUTH_EMULATOR_HOST; demo-* projects can
    // never reach production. firebase-admin.ts reuses getApps()[0].
    if (!getAdminApps().length) initAdminApp({ projectId: PROJECT_ID });
    const clientApp = initClientApp(
      { apiKey: "fake-api-key", projectId: PROJECT_ID, authDomain: `${PROJECT_ID}.firebaseapp.com` },
      "client"
    );
    clientAuth = getAuth(clientApp);
    connectAuthEmulator(clientAuth, `http://${EMULATOR_HOST}`, { disableWarnings: true });
  });

  beforeEach(async () => {
    globalThis.__mullyRateLimitStore = new Map();
    sendPlainTextMock.mockReset().mockResolvedValue("msg_emulator");
    await signOut(clientAuth);
  });

  it("route link signs a new user in through the existing confirm path, once", async () => {
    const { POST } = await import("@/app/api/auth/send-login-link/route");
    const email = `new-${Date.now()}@yahoo.com`;
    const res = await POST(request({ email, continuePath: "/shop#edit" }, "203.0.113.50"));
    expect(res.status).toBe(200);

    const emailLink = linkFromLastEmail();
    expect(new URL(emailLink).searchParams.get("continueUrl")).toBe(
      "https://www.mymully.com/login?returnTo=%2Fshop%23edit"
    );

    const href = landingUrl(emailLink);
    expect(isSignInWithEmailLink(clientAuth, href)).toBe(true);
    const cred = await signInWithEmailLink(clientAuth, email, href);
    expect(cred.user.email).toBe(email);
    // The returnTo survives the URL cleanup /login does after confirming.
    expect(stripEmailLinkParams(href)).toBe("/login?returnTo=%2Fshop%23edit");

    // Single use: the same link is dead afterwards (expired-link recovery path).
    await signOut(clientAuth);
    await expect(signInWithEmailLink(clientAuth, email, href)).rejects.toMatchObject({
      code: "auth/invalid-action-code",
    });
  });

  it("works for an existing user and keeps paid=1", async () => {
    const { adminAuth } = await import("@/lib/firebase-admin");
    const email = `member-${Date.now()}@example.com`;
    const existing = await adminAuth.createUser({ email });

    const { POST } = await import("@/app/api/auth/send-login-link/route");
    const res = await POST(request({ email, paid: true }, "203.0.113.51"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const href = landingUrl(linkFromLastEmail());
    expect(new URL(href).searchParams.get("paid")).toBe("1");
    const cred = await signInWithEmailLink(clientAuth, email, href);
    expect(cred.user.uid).toBe(existing.uid);
  });

  it("wrong email leaves the code usable (different-device recovery unchanged)", async () => {
    const { POST } = await import("@/app/api/auth/send-login-link/route");
    const email = `device-${Date.now()}@example.com`;
    await POST(request({ email }, "203.0.113.52"));
    const href = landingUrl(linkFromLastEmail());
    await expect(signInWithEmailLink(clientAuth, "someone-else@example.com", href)).rejects.toMatchObject({
      code: "auth/invalid-email",
    });
    const cred = await signInWithEmailLink(clientAuth, email, href);
    expect(cred.user.email).toBe(email);
  });

  it("has the same shape as the Firebase-sent fallback link", async () => {
    const email = `fallback-${Date.now()}@example.com`;
    const continueUrl = "https://www.mymully.com/login?returnTo=%2Fshop";
    await sendSignInLinkToEmail(clientAuth, email, { url: continueUrl, handleCodeInApp: true });
    const oob = (await (
      await fetch(`http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/oobCodes`)
    ).json()) as { oobCodes: { email: string; oobLink: string; requestType: string }[] };
    const firebaseSent = oob.oobCodes.find((c) => c.email === email)!;
    expect(firebaseSent.requestType).toBe("EMAIL_SIGNIN");

    const { POST } = await import("@/app/api/auth/send-login-link/route");
    await POST(request({ email, continuePath: "/shop" }, "203.0.113.53"));
    const routeLink = new URL(linkFromLastEmail());
    const clientLink = new URL(firebaseSent.oobLink);
    expect(routeLink.searchParams.get("mode")).toBe(clientLink.searchParams.get("mode"));
    expect(routeLink.searchParams.get("continueUrl")).toBe(clientLink.searchParams.get("continueUrl"));

    // Both links confirm through the same client call.
    const cred = await signInWithEmailLink(clientAuth, email, landingUrl(routeLink.toString()));
    expect(cred.user.email).toBe(email);
  });
});
