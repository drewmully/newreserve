import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

// Lazy-init: instantiating Resend at module load fails the build on Preview
// (and any environment) where RESEND_API_KEY isn't set, because Next.js'
// "Collecting page data" phase evaluates every route module. Defer until
// the handler actually runs.
let resendClient: Resend | null = null;
function getResend(): Resend {
  resendClient ??= new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

export async function POST(request: NextRequest) {
  try {
    const { orderName, customerEmail, message } = await request.json() as {
      orderName: string;
      customerEmail: string;
      message: string;
    };

    if (!orderName || !customerEmail || !message?.trim()) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await getResend().emails.send({
      from: "Mully Returns <info@mymully.com>",
      to: "info@mymully.com",
      replyTo: customerEmail,
      subject: `Exchange Request — ${orderName}`,
      text: `${message.trim()}\n\nCustomer email: ${customerEmail}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[returns/exchange-request] failed:", err);
    return NextResponse.json({ error: "Failed to send request" }, { status: 500 });
  }
}
