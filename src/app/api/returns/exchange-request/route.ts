import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  try {
    const { orderName, customerEmail } = await request.json() as {
      orderName: string;
      customerEmail: string;
    };

    if (!orderName || !customerEmail) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await resend.emails.send({
      from: "Mully Returns <info@mymully.com>",
      to: "info@mymully.com",
      replyTo: customerEmail,
      subject: `Exchange Request — ${orderName}`,
      text: `My order number is ${orderName}, I am looking to exchange.\n\nCustomer email: ${customerEmail}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[returns/exchange-request] failed:", err);
    return NextResponse.json({ error: "Failed to send request" }, { status: 500 });
  }
}
