import { NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";

export interface VerifiedAdminRequest {
  uid: string;
  email: string;
}

export async function verifyAdminRequest(
  req: NextRequest
): Promise<VerifiedAdminRequest | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  try {
    const decoded = await adminAuth.verifyIdToken(token, true);
    const email =
      decoded.email?.toLowerCase() ??
      (await adminAuth.getUser(decoded.uid)).email?.toLowerCase() ??
      null;

    if (
      !email ||
      !isAllowedAdminEmail(email, process.env.ADMIN_EMAIL_ALLOWLIST)
    ) {
      return null;
    }

    return {
      uid: decoded.uid,
      email,
    };
  } catch {
    return null;
  }
}
