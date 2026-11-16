import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendPlainText: vi.fn(), checkRateLimit: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({ sendPlainText: mocks.sendPlainText }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: mocks.checkRateLimit }));

async function load() {
  vi.resetModules();
  const { POST } = await import("@/app/api/returns/exchange-request/route");
  const { signReturnToken } = await import("@/lib/returns/token");
  return { POST, signReturnToken };
}
const req = (body: unknown) =>
  new NextRequest("http://localhost/api/returns/exchange-request", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify(body),
  });

describe("POST /api/returns/exchange-request", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret-at-least-16";
    mocks.sendPlainText.mockReset().mockResolvedValue("id");
    mocks.checkRateLimit.mockReset().mockReturnValue({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  const token = (s: Awaited<ReturnType<typeof load>>["signReturnToken"]) =>
    s({ orderId: "11", orderName: "#1234", email: "member@example.com", orderType: "subscription" })!;

  it("requires a return token (no more open relay)", async () => {
    const { POST } = await load();
    const res = await POST(req({ orderName: "#1", customerEmail: "victim@example.com", message: "hi" }));
    expect(res.status).toBe(401);
    expect(mocks.sendPlainText).not.toHaveBeenCalled();
  });

  it("uses the order email from the token as replyTo, ignoring client input", async () => {
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: token(signReturnToken), orderName: "#9999", customerEmail: "attacker@evil.test", message: "  Size L please  " }));
    expect(res.status).toBe(200);
    const mail = mocks.sendPlainText.mock.calls[0][0];
    expect(mail).toMatchObject({ to: "info@mymully.com", replyTo: "member@example.com", subject: "Exchange Request: #1234", sendClass: "transactional" });
    expect(mail.text).toContain("Size L please");
    expect(mail.text).not.toContain("attacker@evil.test");
  });

  it("caps message length", async () => {
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: token(signReturnToken), message: "x".repeat(2001) }));
    expect(res.status).toBe(400);
    expect(mocks.sendPlainText).not.toHaveBeenCalled();
  });

  it("rate limits", async () => {
    mocks.checkRateLimit.mockReturnValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: token(signReturnToken), message: "hello" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(mocks.sendPlainText).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("returns_exchange_ip", "203.0.113.9", expect.any(Object));
  });

  it("rejects empty messages", async () => {
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: token(signReturnToken), message: "   " }));
    expect(res.status).toBe(400);
  });
});
