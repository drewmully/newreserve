import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

interface GolfRoundRecord {
  id: string;
  date: string;
  course: string;
  score: number;
  courseRating?: number;
  slopeRating?: number;
}

async function verifyFirebaseBearer(request: NextRequest): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  return decoded.uid;
}

function normalizeRoundDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return trimmed;
}

function parseRoundScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const integer = Math.round(value);
  if (integer < 40 || integer > 200) return null;
  return integer;
}

function parseCourseRating(value: unknown): number | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 10) / 10;
  if (rounded < 55 || rounded > 85) return null;
  return rounded;
}

function parseSlopeRating(value: unknown): number | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const integer = Math.round(value);
  if (integer < 55 || integer > 155) return null;
  return integer;
}

export async function GET(request: NextRequest) {
  let uid: string;
  try {
    uid = await verifyFirebaseBearer(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snapshot = await adminDb
      .collection("users")
      .doc(uid)
      .collection("golfRounds")
      .orderBy("playedAt", "desc")
      .limit(250)
      .get();

    const rounds: GolfRoundRecord[] = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        date: String(data.date ?? ""),
        course: String(data.course ?? ""),
        score: Number(data.score ?? 0),
        courseRating:
          typeof data.courseRating === "number" ? data.courseRating : undefined,
        slopeRating:
          typeof data.slopeRating === "number" ? data.slopeRating : undefined,
      };
    });

    return NextResponse.json({ rounds });
  } catch (err) {
    console.error("[golf/rounds GET]", err);
    return NextResponse.json(
      { error: "Failed to fetch golf rounds" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let uid: string;
  try {
    uid = await verifyFirebaseBearer(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      date?: string;
      course?: string;
      score?: number;
      courseRating?: number;
      slopeRating?: number;
    };

    const date = normalizeRoundDate(body.date);
    const score = parseRoundScore(body.score);
    const courseRating = parseCourseRating(body.courseRating);
    const slopeRating = parseSlopeRating(body.slopeRating);
    const course =
      typeof body.course === "string" ? body.course.trim().slice(0, 120) : "";

    if (
      !date ||
      !course ||
      score === null ||
      courseRating === null ||
      slopeRating === null
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid payload. Expected date (YYYY-MM-DD), course, score (40-200), and optional course/slope ratings within range.",
        },
        { status: 400 }
      );
    }

    const playedAt = Timestamp.fromDate(new Date(`${date}T12:00:00.000Z`));
    const ref = await adminDb
      .collection("users")
      .doc(uid)
      .collection("golfRounds")
      .add({
        date,
        course,
        score,
        ...(courseRating !== undefined ? { courseRating } : {}),
        ...(slopeRating !== undefined ? { slopeRating } : {}),
        playedAt,
        createdAt: FieldValue.serverTimestamp(),
      });

    return NextResponse.json(
      {
        round: {
          id: ref.id,
          date,
          course,
          score,
          ...(courseRating !== undefined ? { courseRating } : {}),
          ...(slopeRating !== undefined ? { slopeRating } : {}),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[golf/rounds POST]", err);
    return NextResponse.json(
      { error: "Failed to save golf round" },
      { status: 500 }
    );
  }
}
