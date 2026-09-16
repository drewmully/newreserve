import { NextRequest, NextResponse } from "next/server";

/**
 * Back-in-stock waitlist capture stub. Records the request via console for now
 * — a follow-up PR wires Klaviyo profile subscribe with a
 * `back_in_stock_<productSlug>` list. Never throws; the client treats any
 * non-200 as a soft success so shoppers don't see a broken form.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      email?: string;
      productSlug?: string;
      productName?: string;
      variantId?: string;
      size?: string;
    };

    if (!body.email || !body.productSlug) {
      return NextResponse.json(
        { ok: false, error: "missing_fields" },
        { status: 400 }
      );
    }

    console.log("[back-in-stock]", {
      email: body.email,
      productSlug: body.productSlug,
      variantId: body.variantId,
      size: body.size,
      at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[back-in-stock] error", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
