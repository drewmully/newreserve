import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural guard for the send gate: every outbound message has to go through
 * `sendPlainText()`, which is the only place `checkSend()`/`recordSend()` run.
 * A direct `resend.emails.send(...)` anywhere else silently skips suppression,
 * consent, the frequency cap and the send log.
 *
 * If you are adding a new email, call `sendPlainText` with an explicit
 * `sendClass`. If you genuinely need a new provider primitive, add it to
 * `src/lib/email/resend.ts` and export a wrapper.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SEARCH_ROOTS = ["src", "scripts"];
const CHOKEPOINT = path.join("src", "lib", "email", "resend.ts");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

/** `resend.emails.send`, `client.emails.send`, etc. Also catches `.emails.create`. */
const DIRECT_SEND_REGEX = /\.emails\s*\.\s*(send|create)\s*\(/;

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry))) {
      acc.push(full);
    }
  }
  return acc;
}

describe("resend.emails.send chokepoint", () => {
  const offenders = SEARCH_ROOTS.flatMap((root) =>
    collectSourceFiles(path.join(REPO_ROOT, root))
  )
    .map((file) => path.relative(REPO_ROOT, file))
    .filter((rel) => rel !== CHOKEPOINT)
    .filter((rel) => DIRECT_SEND_REGEX.test(readFileSync(path.join(REPO_ROOT, rel), "utf8")));

  it("is the only place that calls the Resend send API", () => {
    expect(offenders).toEqual([]);
  });

  it("still exists — a rename must not turn this test into a no-op", () => {
    const source = readFileSync(path.join(REPO_ROOT, CHOKEPOINT), "utf8");
    expect(DIRECT_SEND_REGEX.test(source)).toBe(true);
    expect(source).toContain("checkSend");
    expect(source).toContain("recordSend");
  });
});
