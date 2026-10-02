import { NextResponse } from "next/server";
import { nativeEnrollmentEnabled } from "@/app/api/_lib/shopifyCustomerAccount";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({ enabled: nativeEnrollmentEnabled() }, { headers: { "Cache-Control": "no-store" } });
}
