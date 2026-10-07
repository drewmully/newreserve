/** Policy identity only. No defaults for authority, windows, budgets or destination. */
export function googleStandingBinding(env: Record<string, string | undefined>) {
  const policy = env.LEAN_GOOGLE_STANDING_POLICY_ID ?? "", revision = env.LEAN_GOOGLE_STANDING_POLICY_REVISION ?? "";
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(policy) || !/^[1-9]\d{0,18}$/.test(revision) ||
    BigInt(revision) > BigInt("9223372036854775807")) throw new Error("google_standing_binding");
  return { policy, revision };
}
