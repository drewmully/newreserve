import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { Resend } from "resend";
import { adminDb, adminAuth } from "@/lib/firebase-admin";
import { createReviewToken } from "@/lib/registry-tokens";

const resend = new Resend(process.env.RESEND_API_KEY);
const ADMIN_EMAIL = "santy@mullybox.com";

async function verifyAuth(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(header.slice(7));
    return decoded.uid;
  } catch {
    return null;
  }
}

function buildReviewEmailHtml(
  approveUrl: string,
  rejectUrl: string,
  metadata: Record<string, unknown>,
  userEmail: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Club Registry Request</title>
</head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#1a2e1a;padding:32px 40px;border-radius:12px 12px 0 0;text-align:center;">
              <p style="margin:0;color:#c8d5c8;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-weight:600;">Mullybox</p>
              <h1 style="margin:8px 0 0;color:#f5f0eb;font-size:22px;font-weight:400;font-family:Georgia,serif;">New Club Registry Request</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:40px;">

              <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;line-height:1.6;">
                A member has requested to join the private Club Registry. Review the details and approve or reject the application.
              </p>

              <!-- Club details card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f7f4;border:1px solid #e8e0d5;border-radius:10px;margin-bottom:32px;">
                <tr>
                  <td style="padding:24px 28px;">
                    <p style="margin:0 0 16px;color:#8a7e72;font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:600;">Club Details</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #ede8e0;">
                          <span style="color:#8a7e72;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Club</span>
                        </td>
                        <td style="padding:8px 0;border-bottom:1px solid #ede8e0;text-align:right;">
                          <span style="color:#1a2e1a;font-size:14px;font-weight:600;">${metadata.club_name ?? "—"}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #ede8e0;">
                          <span style="color:#8a7e72;font-size:12px;text-transform:uppercase;letter-spacing:1px;">City</span>
                        </td>
                        <td style="padding:8px 0;border-bottom:1px solid #ede8e0;text-align:right;">
                          <span style="color:#333;font-size:14px;">${metadata.city ?? "—"}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #ede8e0;">
                          <span style="color:#8a7e72;font-size:12px;text-transform:uppercase;letter-spacing:1px;">State</span>
                        </td>
                        <td style="padding:8px 0;border-bottom:1px solid #ede8e0;text-align:right;">
                          <span style="color:#333;font-size:14px;">${metadata.state ?? "—"}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #ede8e0;">
                          <span style="color:#8a7e72;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Holes</span>
                        </td>
                        <td style="padding:8px 0;border-bottom:1px solid #ede8e0;text-align:right;">
                          <span style="color:#333;font-size:14px;">${metadata.holes ?? "—"}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;">
                          <span style="color:#8a7e72;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Guest Policy</span>
                        </td>
                        <td style="padding:8px 0;text-align:right;">
                          <span style="color:#333;font-size:14px;">${metadata.guest_policy ?? "—"}</span>
                        </td>
                      </tr>
                    </table>

                    <hr style="border:none;border-top:1px solid #ede8e0;margin:20px 0 16px;" />

                    <p style="margin:0;color:#8a7e72;font-size:12px;">
                      Submitted by: <span style="color:#1a2e1a;font-weight:600;">${userEmail}</span>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Action buttons -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="48%" style="padding-right:8px;">
                    <a href="${approveUrl}"
                       style="display:block;background:#1a2e1a;color:#f5f0eb;text-decoration:none;text-align:center;padding:16px 24px;border-radius:10px;font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">
                      ✓ &nbsp;Approve
                    </a>
                  </td>
                  <td width="48%" style="padding-left:8px;">
                    <a href="${rejectUrl}"
                       style="display:block;background:#ffffff;color:#c0392b;text-decoration:none;text-align:center;padding:16px 24px;border-radius:10px;font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;border:1.5px solid #c0392b;">
                      ✕ &nbsp;Reject
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;color:#aaa;font-size:11px;text-align:center;line-height:1.6;">
                This link is valid for 7 days. If you have already made a decision, you can ignore this email.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f5f0eb;padding:20px 40px;border-radius:0 0 12px 12px;text-align:center;">
              <p style="margin:0;color:#b0a898;font-size:11px;">Mullybox · Club Registry Admin</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
  const uid = await verifyAuth(req);
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { metadata: Record<string, unknown> };
  try {
    body = (await req.json()) as { metadata: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { metadata } = body;
  if (!metadata || typeof metadata !== "object") {
    return NextResponse.json({ error: "metadata is required" }, { status: 400 });
  }

  // Save to Firestore via Admin SDK (bypasses security rules, sets status=pending)
  const ref = adminDb.collection("registry_applications").doc(uid);
  const snap = await ref.get();

  if (!snap.exists) {
    await ref.set({
      user_id: uid,
      status: "pending",
      metadata,
      created_at: FieldValue.serverTimestamp(),
    });
  } else {
    await ref.update({ status: "pending", metadata });
  }

  // Build magic link URLs
  const baseUrl =
    process.env.APP_URL ??
    req.nextUrl.origin;

  const approveToken = createReviewToken(uid, "approve");
  const rejectToken = createReviewToken(uid, "reject");

  const approveUrl = `${baseUrl}/api/admin/registry/review?token=${encodeURIComponent(approveToken)}`;
  const rejectUrl = `${baseUrl}/api/admin/registry/review?token=${encodeURIComponent(rejectToken)}`;

  const userEmail = String(metadata.submitted_by_email ?? "");

  // Send email to admin
  const { error: emailError } = await resend.emails.send({
    from: "Mullybox Club Registry <noreply@mymully.com>",
    to: ADMIN_EMAIL,
    subject: `New Club Registry Request — ${String(metadata.club_name ?? "Unknown")}`,
    html: buildReviewEmailHtml(approveUrl, rejectUrl, metadata, userEmail),
  });

  if (emailError) {
    console.error("[registry/apply] Resend error:", emailError);
    // Application was saved — don't fail the request, just log
  }

  return NextResponse.json({ ok: true });
}
