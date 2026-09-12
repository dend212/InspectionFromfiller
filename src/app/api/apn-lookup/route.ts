import { NextResponse } from "next/server";
import {
  AssessorUnavailableError,
  mapParcelToAssessor,
  queryParcelByApn,
} from "@/lib/prefill/assessor";
import { isValidApn } from "@/lib/prefill/input";
import { createClient } from "@/lib/supabase/server";

/** In-memory rate limiter: userId → timestamps of recent lookups */
const lookupTimestamps = new Map<string, number[]>();
const MAX_LOOKUPS_PER_HOUR = 30;
const ONE_HOUR_MS = 60 * 60 * 1000;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = lookupTimestamps.get(userId) ?? [];
  const recent = timestamps.filter((t) => now - t < ONE_HOUR_MS);
  if (recent.length >= MAX_LOOKUPS_PER_HOUR) return false;
  recent.push(now);
  lookupTimestamps.set(userId, recent);
  return true;
}

/**
 * GET /api/apn-lookup?apn=123-45-678
 * Looks up property data from Maricopa County Assessor by APN.
 * The ArcGIS query itself lives in src/lib/prefill/assessor.ts so the
 * prefill assessor stage shares it.
 */
export async function GET(request: Request) {
  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkRateLimit(user.id)) {
    return NextResponse.json({ error: "Too many lookups — try again later" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const apn = searchParams.get("apn")?.trim();

  if (!apn) {
    return NextResponse.json({ error: "APN parameter is required" }, { status: 400 });
  }

  if (!isValidApn(apn)) {
    return NextResponse.json({ error: "Invalid APN format" }, { status: 400 });
  }

  try {
    const feature = await queryParcelByApn(apn);

    if (!feature) {
      return NextResponse.json(
        { error: "No property found for this APN" },
        { status: 404 },
      );
    }

    return NextResponse.json({ assessor: mapParcelToAssessor(feature) });
  } catch (err) {
    if (err instanceof AssessorUnavailableError) {
      return NextResponse.json(
        { error: "Assessor service unavailable" },
        { status: 502 },
      );
    }
    console.error("APN lookup failed:", err);
    return NextResponse.json(
      { error: "APN lookup failed" },
      { status: 500 },
    );
  }
}
