import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { buildRecommendationContext, draftRecommendations } from "@/lib/ai/draft-recommendations";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { getUserRole } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

// Bounds the platform's own function timeout to match the model call's 20s timeout (see
// draft-recommendations.ts) so a hung Anthropic API can't run indefinitely on Vercel.
export const maxDuration = 60;

/** Simple in-memory rate limiter: inspectionId → timestamps (same shape as rewrite-comments) */
const draftTimestamps = new Map<string, number[]>();
const MAX_DRAFTS_PER_HOUR = 5;
const ONE_HOUR_MS = 60 * 60 * 1000;

function checkRateLimit(inspectionId: string): boolean {
  const now = Date.now();
  const timestamps = draftTimestamps.get(inspectionId) ?? [];
  const recent = timestamps.filter((t) => now - t < ONE_HOUR_MS);
  if (recent.length >= MAX_DRAFTS_PER_HOUR) {
    return false;
  }
  recent.push(now);
  draftTimestamps.set(inspectionId, recent);
  return true;
}

/**
 * POST /api/inspections/[id]/draft-recommendations
 * Drafts customer-facing summary recommendations from the inspection's comments using Claude.
 * Allowed: admin or office_staff only. No request body.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(supabase);
  if (role !== "admin" && role !== "office_staff") {
    return NextResponse.json({ error: "Forbidden: admin or office staff only" }, { status: 403 });
  }

  const [inspection] = await db
    .select({ formData: inspections.formData })
    .from(inspections)
    .where(eq(inspections.id, id))
    .limit(1);

  if (!inspection) {
    return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  }

  if (!checkRateLimit(id)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Maximum 5 drafts per hour per inspection." },
      { status: 429 },
    );
  }

  try {
    const context = buildRecommendationContext(inspection.formData);
    const recommendations = await draftRecommendations(context);
    return NextResponse.json({ recommendations });
  } catch (err) {
    console.error("[draft-recommendations] AI error:", err);
    return NextResponse.json({ error: "Couldn't draft recommendations" }, { status: 502 });
  }
}
