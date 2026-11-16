import type { User } from "firebase/auth";
import { isAllowedAdminEmail } from "./adminEmailAllowlist";
import { adminSessionRejection } from "./adminTokenPolicy";

export type ClientAdminStatus = "authorized" | "unauthorized" | "reauth";

/**
 * Client-side mirror of the server admin check (src/lib/adminTokenPolicy.ts)
 * so the admin UI is hidden from sessions the admin APIs would reject.
 * This is cosmetic only — the APIs enforce the real check.
 *
 *  - not allowlisted                         → "unauthorized"
 *  - allowlisted but weak session (custom
 *    token / email_only / unverified email)   → "reauth" (sign in again)
 *  - allowlisted + strong session             → "authorized"
 *
 * If the token claims can't be read (transient network error), fall back to
 * the previous email-only decision rather than locking an admin out of the UI.
 */
export async function clientAdminStatus(user: User): Promise<ClientAdminStatus> {
  if (!isAllowedAdminEmail(user.email)) return "unauthorized";
  try {
    const result = await user.getIdTokenResult();
    return adminSessionRejection(result.claims) ? "reauth" : "authorized";
  } catch {
    return "authorized";
  }
}
