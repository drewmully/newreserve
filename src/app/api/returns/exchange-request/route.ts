import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { sendPlainText } from "@/lib/email/resend";
import { adminDb } from "@/lib/firebase-admin";

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

    // Save to the admin returns queue (/admin/returns) so requests can't get
    // buried in the shared inbox. The email below still goes out as a backup.
    await adminDb
      .collection("customer_requests")
      .add({
        type: "exchange",
        status: "open",
        orderName,
        customerEmail: customerEmail.trim().toLowerCase(),
        message: message.trim(),
        source: "returns_page",
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch((e) => console.error("[returns/exchange-request] queue write failed:", e));

    await sendPlainText({
      to: "info@mymully.com",
      // Ops replies go straight back to the shopper, not to the shared inbox.
      replyTo: customerEmail,
      subject: `Exchange Request — ${orderName}`,
      text: `${message.trim()}\n\nCustomer email: ${customerEmail}\n\nReview in the returns queue: https://mymully.com/admin/returns`,
      sendClass: "transactional",
      category: "returns_exchange_request",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[returns/exchange-request] failed:", err);
    return NextResponse.json({ error: "Failed to send request" }, { status: 500 });
  }
}
