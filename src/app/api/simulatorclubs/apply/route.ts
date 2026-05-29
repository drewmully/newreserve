import { NextRequest, NextResponse } from "next/server";
import { sendPlainText } from "@/lib/email/resend";

export const runtime = "nodejs";

const TO_ADDRESS = "drew@mymully.com";

interface ApplicationPayload {
  clubName?: string;
  contactName?: string;
  email?: string;
  location?: string;
  bays?: string;
  memberCount?: string;
  retailSetup?: string;
  tierInterest?: string;
  notes?: string;
}

function clean(v: string | undefined, max = 500): string {
  if (!v) return "";
  return String(v).slice(0, max).trim();
}

export async function POST(req: NextRequest) {
  let body: ApplicationPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const clubName = clean(body.clubName, 200);
  const contactName = clean(body.contactName, 200);
  const email = clean(body.email, 200);
  const location = clean(body.location, 200);
  const bays = clean(body.bays, 20);
  const memberCount = clean(body.memberCount, 60);
  const retailSetup = clean(body.retailSetup, 200);
  const tierInterest = clean(body.tierInterest, 100);
  const notes = clean(body.notes, 2000);

  if (!clubName || !contactName || !email || !location) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const subject = `Mully Boutique — Founding partner application: ${clubName}`;
  const text = [
    `New Mully Boutique founding partner application.`,
    ``,
    `Club: ${clubName}`,
    `Contact: ${contactName}`,
    `Email: ${email}`,
    `Location: ${location}`,
    `Sim bays: ${bays || "—"}`,
    `Member count: ${memberCount || "—"}`,
    `Current retail: ${retailSetup || "—"}`,
    `Tier of interest: ${tierInterest || "—"}`,
    ``,
    `Notes:`,
    notes || "(none provided)",
    ``,
    `—`,
    `Submitted via /simulatorclubs LP at ${new Date().toISOString()}.`,
  ].join("\n");

  try {
    await sendPlainText({
      to: TO_ADDRESS,
      subject,
      text,
      utmCampaign: "simulatorclubs_apply",
      tags: [
        { name: "form", value: "simulatorclubs_apply" },
        { name: "tier", value: tierInterest.toLowerCase().includes("atelier") ? "atelier" : tierInterest.toLowerCase().includes("boutique") ? "boutique" : tierInterest.toLowerCase().includes("starter") ? "starter" : "unknown" },
      ],
    });
  } catch (err) {
    // Don't block on email failure — log and 500. The form shows a generic
    // error and we surface a contact email in the UI as a fallback.
    console.error("simulatorclubs/apply: send failed", err);
    return NextResponse.json({ error: "Email send failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
