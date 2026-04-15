import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const { name, email, eventType, guestCount, budget, message } =
    await request.json();

  // Validate required fields
  if (!name || !email || !eventType || !guestCount || !budget) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  // Insert into Supabase
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://xnfjdbpjuaezxjgargto.supabase.co";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseKey) {
    console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { error: dbError } = await supabase
    .from("outing_submissions")
    .insert({
      name,
      email,
      event_type: eventType,
      guest_count: parseInt(guestCount, 10),
      budget,
      message: message || null,
    });

  if (dbError) {
    console.error("Supabase insert error:", dbError);
    return NextResponse.json(
      { error: "Failed to save submission" },
      { status: 500 }
    );
  }

  // Send Slack notification
  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (slackToken) {
    try {
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${slackToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: "C06K9L5M7EY",
          text: `New Outing Inquiry!\n\n*Name:* ${name}\n*Email:* ${email}\n*Event Type:* ${eventType}\n*Guests:* ${guestCount}\n*Budget:* ${budget}${message ? `\n*Message:* ${message}` : ""}`,
        }),
      });
    } catch (slackError) {
      // Log but don't fail the request if Slack notification fails
      console.error("Slack notification error:", slackError);
    }
  }

  return NextResponse.json({ success: true });
}
