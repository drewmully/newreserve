import { createHash } from "node:crypto";

export const nativeEntryFilterSha256 = "61504f7e32de2ff2d4197a26e25ba57f412891b9c03e6d27b3ef7568e3829819";
const hostRegex = "^(localhost|127\\.0\\.0\\.1)($|:)";

/** Private saved project rules only. No configurable digest or alternate rule set.
 * Values never enter a browser response, exception or diagnostic. */
export function nativeFilterRules(env: NodeJS.ProcessEnv): { hostRegex: string; negativeEmailValues: string[] } | null {
  if (typeof window !== "undefined") return null;
  const raw = env.LEAN_POSTHOG_TEST_ACCOUNT_FILTERS;
  if (!raw || Buffer.byteLength(raw,"utf8") > 4096) return null;
  try {
    const rules: unknown = JSON.parse(raw);
    if (!Array.isArray(rules) || rules.length !== 6) return null;
    for (let i=0; i<rules.length; i++) {
      const rule=rules[i];
      if (!rule || typeof rule !== "object" || Array.isArray(rule) ||
        Object.keys(rule).join(",") !== "key,type,value,operator" || typeof rule.value !== "string" ||
        rule.key !== (i===0 ? "$host" : "email") || rule.type !== (i===0 ? "event" : "person") ||
        rule.operator !== (i===0 ? "not_regex" : "not_icontains") ||
        (i===0 ? rule.value !== hostRegex : !/^[A-Za-z0-9@+._-]{1,200}$/.test(rule.value))) return null;
    }
    // JSON whitespace may vary, but rule/key order and every value are pinned.
    if (createHash("sha256").update(JSON.stringify(rules)).digest("hex") !== nativeEntryFilterSha256) return null;
    return { hostRegex:rules[0].value, negativeEmailValues:rules.slice(1).map(rule=>rule.value) };
  } catch { return null; }
}
