/**
 * Guards the send gate: `sendPlainText()` in src/lib/email/resend.ts is the
 * only place allowed to hand a message to Resend. Anything else bypasses
 * suppression, consent, the frequency cap and the send_log audit trail.
 *
 * If this fails, route your send through `sendPlainText` instead of adding an
 * exemption.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../src");
const ALLOWED = path.join(SRC, "lib", "email", "resend.ts");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("outbound email chokepoint", () => {
  it("only calls Resend's send API from sendPlainText", () => {
    const offenders = walk(SRC).filter(
      (file) => file !== ALLOWED && /\.emails\.send\b/.test(readFileSync(file, "utf8"))
    );

    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("only constructs a Resend client outside resend.ts for inbound and webhook handling", () => {
    // Inbound parsing and webhook signature verification legitimately need a
    // client, but they must never send.
    const INBOUND_ONLY = [
      path.join(SRC, "app", "api", "email", "inbound", "route.ts"),
      path.join(SRC, "app", "api", "email", "events", "route.ts"),
    ];

    const offenders = walk(SRC).filter(
      (file) =>
        file !== ALLOWED &&
        !INBOUND_ONLY.includes(file) &&
        /new Resend\s*\(/.test(readFileSync(file, "utf8"))
    );

    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
