import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === "true";

export function middleware(request: NextRequest) {
  // ─── A/B bucket cookie (sticky visitor assignment) ───
  const hasBucket = request.cookies.has("mr_ab");

  if (!MAINTENANCE_MODE) {
    const response = NextResponse.next();
    if (!hasBucket) {
      response.cookies.set("mr_ab", String(Math.floor(Math.random() * 100)), {
        maxAge: 60 * 60 * 24 * 90, // 90 days
        path: "/",
        sameSite: "lax",
      });
    }
    return response;
  }

  const { pathname } = request.nextUrl;

  // Allow the maintenance page itself and static assets
  if (
    pathname === "/maintenance" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  return NextResponse.rewrite(new URL("/maintenance", request.url));
}

export const config = {
  matcher: ["/((?!api/webhooks).*)"],
};
