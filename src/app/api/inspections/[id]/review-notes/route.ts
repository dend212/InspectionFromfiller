import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

const MAX_APPEND_LENGTH = 2000;

/**
 * PATCH /api/inspections/[id]/review-notes
 * Appends one line to review_notes (used by "Finalize with issues").
 * Body: { append: string }
 * Allowed: admin only, and only while the inspection is in_review.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Admin-only check
  let userRole: string | null = null;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) {
      const payload = JSON.parse(
        Buffer.from(session.access_token.split(".")[1], "base64").toString(),
      );
      userRole = payload.user_role ?? null;
    }
  } catch {
    // Role decode failed
  }

  if (userRole !== "admin") {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const append = typeof body?.append === "string" ? body.append.trim() : "";
  if (!append || append.length > MAX_APPEND_LENGTH) {
    return NextResponse.json(
      { error: `append must be a non-empty string of at most ${MAX_APPEND_LENGTH} characters` },
      { status: 400 },
    );
  }

  // concat_ws skips a NULL review_notes, so the first append has no leading newline
  const result = await db
    .update(inspections)
    .set({
      reviewNotes: sql`concat_ws(chr(10), ${inspections.reviewNotes}, ${append})`,
      updatedAt: new Date(),
    })
    .where(and(eq(inspections.id, id), eq(inspections.status, "in_review")))
    .returning({ id: inspections.id });

  if (result.length === 0) {
    return NextResponse.json(
      { error: "Cannot update review notes: inspection is not in review" },
      { status: 409 },
    );
  }

  return NextResponse.json({ appended: true });
}
