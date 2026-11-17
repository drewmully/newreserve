import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateLinkMock, sendPlainTextMock } = vi.hoisted(() => ({
  generateLinkMock: vi.fn(),
  sendPlainTextMock: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: { generateSignInWithEmailLink: generateLinkMock },
  adminDb: {},
}));
// Stub Resend entirely: no real email is ever sent from tests.
vi.mock("@/lib/email/resend", () => ({ sendPlainText: sendPlainTextMock }));

const OOB_LINK =
  "https://mully-reserve.firebaseapp.com/__/auth/action?apiKey=k&mode=signIn&oobCode=CODE123&continueUrl=x&lang=en";

let ipCounter = 0;
function freshIp() {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}`;
}

function makeRequest(
  body: unknown,
  { ip = freshIp(), origin }: { ip?: string; origin?: string } = {}
) {
  return new NextRequest("http://localhost/api/auth/send-login-link", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
      ...(origin ? { origin } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function loadRoute() {
  return import("@/app/api/auth/send-login-link/route");
}

function continueUrlOfLastCall(): URL {
  const [, settings] = generateLinkMock.mock.calls.at(-1)!;
  return new URL(settings.url);
}

describe("POST /api/auth/send-login-link", () => {
  beforeEach(() => {
    globalThis.__mullyRateLimitStore = new Map();
    generateLinkMock.mockReset().mockResolvedValue(OOB_LINK);
    sendPlainTextMock.mockReset().mockResolvedValue("msg_123");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  describe("validation", () => {
    it.each([
      ["missing email", {}],
      ["non-string email", { email: 42 }],
      ["no domain dot", { email: "jane@example" }],
      ["spaces", { email: "jane doe@example.com" }],
      ["too long", { email: `${"a".repeat(250)}@example.com` }],
    ])("rejects %s with 400", async (_label, body) => {
      const { POST } = await loadRoute();
      const res = await POST(makeRequest(body));
      expect(res.status).toBe(400);
      expect(generateLinkMock).not.toHaveBeenCalled();
      expect(sendPlainTextMock).not.toHaveBeenCalled();
    });

    it("rejects malformed JSON with 400", async () => {
      const { POST } = await loadRoute();
      const res = await POST(makeRequest("{not json"));
      expect(res.status).toBe(400);
    });

    it("normalises the address before generating and sending", async () => {
      const { POST } = await loadRoute();
      const res = await POST(makeRequest({ email: "  Jane.Doe@Yahoo.COM " }));
      expect(res.status).toBe(200);
      expect(generateLinkMock).toHaveBeenCalledWith("jane.doe@yahoo.com", expect.anything());
      expect(sendPlainTextMock).toHaveBeenCalledWith(expect.objectContaining({ to: "jane.doe@yahoo.com" }));
    });
  });

  describe("email content", () => {
    it("sends a text-only, untracked transactional email containing the exact link", async () => {
      const { POST } = await loadRoute();
      await POST(makeRequest({ email: "jane@yahoo.com" }));
      expect(sendPlainTextMock).toHaveBeenCalledTimes(1);
      const msg = sendPlainTextMock.mock.calls[0][0];
      expect(msg.subject).toBe("Your Mully sign-in link");
      expect(msg.disableTracking).toBe(true);
      expect(msg.sendClass).toBe("transactional");
      expect(msg.category).toBe("login_link");
      // No HTML part → Resend has no anchors to wrap for click tracking.
      expect(msg.html).toBeUndefined();
      // The oob link is delivered byte-for-byte on its own line.
      expect(msg.text.split("\n")).toContain(OOB_LINK);
      expect(msg.text).toMatch(/expires within an hour/);
      expect(msg.text).toMatch(/Didn't request this\? You can safely ignore this email/);
    });

    it("asks Firebase for an in-app email sign-in link", async () => {
      const { POST } = await loadRoute();
      await POST(makeRequest({ email: "jane@yahoo.com" }));
      expect(generateLinkMock).toHaveBeenCalledWith("jane@yahoo.com", {
        url: "https://www.mymully.com/login",
        handleCodeInApp: true,
      });
    });
  });

  describe("continue URL", () => {
    it("defaults to https://www.mymully.com/login with no Origin header", async () => {
      const { POST } = await loadRoute();
      await POST(makeRequest({ email: "a@b.co" }));
      expect(continueUrlOfLastCall().toString()).toBe("https://www.mymully.com/login");
    });

    it.each(["https://www.mymully.com", "https://mymully.com"])("keeps allowlisted origin %s", async (origin) => {
      const { POST } = await loadRoute();
      await POST(makeRequest({ email: "a@b.co" }, { origin }));
      expect(continueUrlOfLastCall().origin).toBe(origin);
    });

    it.each([
      "https://evil.example",
      "https://www.mymully.com.evil.example",
      "https://evil-preview.vercel.app",
      "javascript:alert(1)",
      "null",
    ])("ignores non-allowlisted origin %s", async (origin) => {
      const { POST } = await loadRoute();
      await POST(makeRequest({ email: "a@b.co" }, { origin }));
      expect(continueUrlOfLastCall().origin).toBe("https://www.mymully.com");
    });

    it("never puts a host from the body into the link", async () => {
      const { POST } = await loadRoute();
      await POST(makeRequest({ email: "a@b.co", continuePath: "https://evil.example/shop" }));
      expect(continueUrlOfLastCall().toString()).toBe("https://www.mymully.com/login");
      await POST(makeRequest({ email: "a@b.co", continuePath: "//evil.example/shop" }));
      expect(continueUrlOfLastCall().toString()).toBe("https://www.mymully.com/login");
    });

    it("allows this deployment's own Vercel preview URL only in preview", async () => {
      process.env.VERCEL_ENV = "preview";
      process.env.VERCEL_URL = "newreserve-abc123.vercel.app";
      const { POST } = await loadRoute();
      await POST(makeRequest({ email: "a@b.co" }, { origin: "https://newreserve-abc123.vercel.app" }));
      expect(continueUrlOfLastCall().origin).toBe("https://newreserve-abc123.vercel.app");
      await POST(makeRequest({ email: "a@b.co" }, { origin: "https://other-xyz.vercel.app" }));
      expect(continueUrlOfLastCall().origin).toBe("https://www.mymully.com");

      process.env.VERCEL_ENV = "production";
      await POST(makeRequest({ email: "a@b.co" }, { origin: "https://newreserve-abc123.vercel.app" }));
      expect(continueUrlOfLastCall().origin).toBe("https://www.mymully.com");
    });

    it("allows localhost outside production only", async () => {
      process.env.VERCEL_ENV = "";
      (process.env as Record<string, string>).NODE_ENV = "development";
      const { POST } = await loadRoute();
      await POST(makeRequest({ email: "a@b.co" }, { origin: "http://localhost:3000" }));
      expect(continueUrlOfLastCall().origin).toBe("http://localhost:3000");

      process.env.VERCEL_ENV = "production";
      await POST(makeRequest({ email: "a@b.co" }, { origin: "http://localhost:3000" }));
      expect(continueUrlOfLastCall().origin).toBe("https://www.mymully.com");
    });

    it("preserves a sanitised shop returnTo", async () => {
      const { POST } = await loadRoute();
      await POST(makeRequest({ email: "a@b.co", continuePath: "/shop/products/vest?color=navy#fit" }));
      const url = continueUrlOfLastCall();
      expect(url.pathname).toBe("/login");
      expect(url.searchParams.get("returnTo")).toBe("/shop/products/vest?color=navy#fit");
      expect(url.searchParams.has("paid")).toBe(false);
    });

    it.each(["/account", "/admin", "/shop%2f..%2fadmin", "/shopping", "javascript:alert(1)"])(
      "drops an unsafe returnTo %s",
      async (continuePath) => {
        const { POST } = await loadRoute();
        await POST(makeRequest({ email: "a@b.co", continuePath }));
        expect(continueUrlOfLastCall().searchParams.has("returnTo")).toBe(false);
      }
    );

    it("preserves paid=1 and (like shopReturnFromLogin) drops returnTo on paid links", async () => {
      const { POST } = await loadRoute();
      await POST(makeRequest({ email: "a@b.co", paid: true, continuePath: "/shop" }));
      expect(continueUrlOfLastCall().toString()).toBe("https://www.mymully.com/login?paid=1");
    });

    it("ignores non-boolean-ish paid values", async () => {
      const { POST } = await loadRoute();
      await POST(makeRequest({ email: "a@b.co", paid: "yes" }));
      expect(continueUrlOfLastCall().searchParams.has("paid")).toBe(false);
    });
  });

  describe("no account enumeration", () => {
    it("returns an identical 200 body whether or not the account exists", async () => {
      const { POST } = await loadRoute();
      // generateSignInWithEmailLink succeeds for unknown addresses too (the
      // account is created on first sign-in); the route never looks users up.
      const existing = await POST(makeRequest({ email: "member@example.com" }));
      const unknown = await POST(makeRequest({ email: "nobody-here@example.com" }));
      expect(existing.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(await existing.json()).toEqual({ ok: true });
      expect(await unknown.json()).toEqual({ ok: true });
      expect(existing.headers.get("cache-control")).toBe("no-store");
    });
  });

  describe("rate limits", () => {
    it("allows 5 links per email per hour, then 429", async () => {
      const { POST } = await loadRoute();
      for (let i = 0; i < 5; i += 1) {
        const res = await POST(makeRequest({ email: "Same@Example.com" }));
        expect(res.status).toBe(200);
      }
      // Case/whitespace variants share the bucket.
      const res = await POST(makeRequest({ email: " same@example.com" }));
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
      const body = await res.json();
      expect(body.code).toBe("auth/too-many-requests");
      expect(body.error).toMatch(/wait a few minutes/);
      expect(sendPlainTextMock).toHaveBeenCalledTimes(5);
    });

    it("allows 10 links per IP per hour across different emails, then 429", async () => {
      const { POST } = await loadRoute();
      const ip = "198.51.100.7";
      for (let i = 0; i < 10; i += 1) {
        const res = await POST(makeRequest({ email: `user${i}@example.com` }, { ip }));
        expect(res.status).toBe(200);
      }
      const res = await POST(makeRequest({ email: "user99@example.com" }, { ip }));
      expect(res.status).toBe(429);
      // A different IP is unaffected.
      const other = await POST(makeRequest({ email: "user99@example.com" }, { ip: "198.51.100.8" }));
      expect(other.status).toBe(200);
    });

    it("does not count invalid requests toward the limit", async () => {
      const { POST } = await loadRoute();
      const ip = "198.51.100.9";
      for (let i = 0; i < 20; i += 1) await POST(makeRequest({ email: "bad" }, { ip }));
      const res = await POST(makeRequest({ email: "ok@example.com" }, { ip }));
      expect(res.status).toBe(200);
    });
  });

  describe("failures", () => {
    it("returns 502 without leaking details when Resend throws", async () => {
      sendPlainTextMock.mockRejectedValue(new Error('Resend error: {"name":"daily_quota_exceeded","secret":"re_abc"}'));
      const { POST } = await loadRoute();
      const res = await POST(makeRequest({ email: "jane@yahoo.com" }));
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(text).not.toMatch(/quota|re_abc|Resend/);
      expect(console.error).toHaveBeenCalled();
    });

    it("returns 503 when the send gate holds the message back", async () => {
      sendPlainTextMock.mockResolvedValue(null);
      const { POST } = await loadRoute();
      const res = await POST(makeRequest({ email: "bounced@example.com" }));
      expect(res.status).toBe(503);
    });

    it("returns 503 without leaking details when link generation fails", async () => {
      generateLinkMock.mockRejectedValue(
        Object.assign(new Error("Domain not allowlisted by project"), { code: "auth/unauthorized-continue-uri" })
      );
      const { POST } = await loadRoute();
      const res = await POST(makeRequest({ email: "jane@yahoo.com" }));
      expect(res.status).toBe(503);
      expect(await res.text()).not.toMatch(/allowlisted|unauthorized/);
      expect(sendPlainTextMock).not.toHaveBeenCalled();
    });
  });
});
