import { NextRequest, NextResponse } from "next/server";
import { completeCustomerConnection, CUSTOMER_STATE_COOKIE, CustomerAccountError } from "@/app/api/_lib/shopifyCustomerAccount";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const cookie = request.cookies.get(CUSTOMER_STATE_COOKIE)?.value;
  const destination = new URL("https://www.mymully.com/account");
  destination.searchParams.set("manage", "shopify");
  try {
    if (!state || !cookie || cookie !== state || !code || request.nextUrl.searchParams.has("error")) {
      throw new CustomerAccountError(400, "connection_failed", "Connection failed.");
    }
    await completeCustomerConnection(state, code);
    destination.searchParams.set("shopify", "connected");
  } catch (error) {
    const code = error instanceof CustomerAccountError ? error.code : "connection_failed";
    console.warn("[shopify-customer] connection callback failed", { code });
    destination.searchParams.set("shopify", code);
  }
  const response = NextResponse.redirect(destination, 303);
  response.cookies.set(CUSTOMER_STATE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
