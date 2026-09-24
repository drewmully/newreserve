import { offerTransport } from "./offer-collection-source.mjs";
export function collectedGrants(revoked = false) {
  return [{ subjectId: "fixture-subject", validFrom: "2026-01-01T10:00:00Z",
    expiresAt: "2026-01-02T09:00:00Z", revokedAt: revoked ? "2026-01-01T12:00:00Z" : null,
    permissionEvidenceRef: "fixture:recorded-permission" }];
}
export function permissionTransport(grants = collectedGrants()) {
  const commerce = offerTransport();
  return async (url, init) => {
    const target = new URL(String(url));
    if (target.pathname !== "/rest/v1/rpc/lean_journey_permissions_read") return commerce(url, init);
    if (target.origin !== `https://${"a".repeat(20)}.supabase.co` || init?.method !== "POST" ||
        init.redirect !== "error" || init.headers.Authorization !== "Bearer synthetic-source")
      throw new Error("synthetic_permission_target_only");
    const c = JSON.parse(init.body);
    if (c.p_project !== "a".repeat(20) || c.p_shop !== "fixture.myshopify.com" ||
        c.p_posthog !== "353503" || c.p_from !== "2025-12-01T00:00:00Z" || c.p_until !== "2026-02-01T00:00:00Z")
      throw new Error("synthetic_permission_scope_only");
    return new Response(JSON.stringify(grants));
  };
}
