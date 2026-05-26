/**
 * POST /api/admin/founding_100/seed
 *
 * One-shot seeder for the Founding 100 counter document.
 *
 * Auth: requires header `Authorization: Bearer <FOUNDING_100_SEED_TOKEN>`.
 *
 * Body (optional JSON):
 *   {
 *     claimed?: number,   // default 5
 *     cap?: number,       // default 100
 *     active?: boolean,   // default true
 *     reset?: boolean,    // if true, OVERWRITE existing doc
 *   }
 *
 * Behavior:
 *   - If the counter doc does not exist, create it.
 *   - If it does exist, return current state without overwriting unless
 *     `reset: true` is passed.
 *
 * Returns the doc state after the operation.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { FOUNDING_100_DOC_PATH } from "@/lib/foundingHundredConstants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = (process.env.FOUNDING_100_SEED_TOKEN ?? "").trim();
  const header = (req.headers.get("authorization") ?? "").trim();
  const provided = header.replace(/^Bearer\s+/i, "").trim();
  if (!secret) return false;
  if (!provided) return false;
  if (provided.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) {
    diff |= secret.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    claimed?: number;
    cap?: number;
    active?: boolean;
    reset?: boolean;
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const claimed = typeof body.claimed === "number" ? body.claimed : 5;
  const cap = typeof body.cap === "number" ? body.cap : 100;
  const active = body.active === false ? false : true;
  const reset = body.reset === true;

  const ref = adminDb.doc(FOUNDING_100_DOC_PATH);
  const snap = await ref.get();

  if (snap.exists && !reset) {
    return NextResponse.json({
      ok: true,
      action: "noop",
      message: "Counter already exists. Pass {reset:true} to overwrite.",
      doc: snap.data(),
    });
  }

  const payload = {
    claimed,
    cap,
    active,
    last_order_ids: [] as string[],
    created_at: Date.now(),
    seeded_via: "admin_seed_endpoint",
  };

  await ref.set(payload, { merge: false });

  const after = await ref.get();
  return NextResponse.json({
    ok: true,
    action: snap.exists ? "overwrote" : "created",
    path: FOUNDING_100_DOC_PATH,
    doc: after.data(),
  });
}

// Also allow GET for read-only verification
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const snap = await adminDb.doc(FOUNDING_100_DOC_PATH).get();
  return NextResponse.json({
    ok: true,
    exists: snap.exists,
    doc: snap.exists ? snap.data() : null,
  });
}
