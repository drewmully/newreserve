/**
 * Runtime configuration for the static Style Game asset.
 * The /lp/stylegame rewrite deliberately bypasses React so authored inline
 * scripts execute verbatim; this route supplies public telemetry configuration.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const config = {
    posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "PLACEHOLDER_WILL_BE_INJECTED_SERVERSIDE",
    posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "",
    depositUrl: process.env.NEXT_PUBLIC_STYLEGAME_DEPOSIT_URL ?? "/api/stylegame/checkout",
    xHandle: process.env.NEXT_PUBLIC_STYLEGAME_X_HANDLE ?? "@mymully",
    igHandle: process.env.NEXT_PUBLIC_STYLEGAME_IG_HANDLE ?? "@mullyreserve",
  };

  return new Response(
    `window.MULLY_STYLEGAME_CONFIG = Object.assign(window.MULLY_STYLEGAME_CONFIG || {}, ${JSON.stringify(config)});`,
    {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
