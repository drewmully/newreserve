/**
 * POST /api/simulatorclubs/upload-logo
 *
 * Accepts a multipart/form-data POST with fields:
 *   - file:  the logo image (png/jpeg/webp/svg, max 5 MB)
 *   - email: the lead email (used to namespace the storage path)
 *
 * Uploads to the `club-logos` Supabase Storage bucket at the path
 *   {sanitized-email}/{timestamp}-{filename}
 *
 * Returns: { url } - the public URL.
 *
 * We proxy the upload server-side (rather than letting the browser hit Supabase
 * directly) so we can keep the service-role key out of client code and apply
 * our own size + MIME checks.
 */
import { NextResponse } from "next/server";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

function sanitizeForPath(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "anonymous"
  );
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const email = String(form.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (!(file instanceof Blob) || (file as File).size === 0) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 5 MB)" }, { status: 413 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type || "(unknown)"}` },
      { status: 415 }
    );
  }

  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const namespace = sanitizeForPath(email);
  const path = `${namespace}/${Date.now()}-logo.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  const sb = getSupabaseService();
  const { error: uploadErr } = await sb.storage
    .from("club-logos")
    .upload(path, buffer, {
      contentType: file.type,
      upsert: false,
      cacheControl: "31536000, immutable",
    });

  if (uploadErr) {
    console.error("[upload-logo] supabase upload failed", uploadErr);
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data: publicUrl } = sb.storage.from("club-logos").getPublicUrl(path);

  return NextResponse.json({ url: publicUrl.publicUrl, path });
}
