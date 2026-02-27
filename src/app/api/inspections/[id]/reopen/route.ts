import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * POST /api/inspections/[id]/reopen
 * Transition: completed -> in_review
 * Allowed: admin only
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
        Buffer.from(session.access_token.split(".")[1], "base64").toString()
      );
      userRole = payload.user_role ?? null;
    }
  } catch {
    // Role decode failed
  }

  if (userRole !== "admin") {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }

  // Atomic status transition: only update if current status is "completed"
  const result = await db
    .update(inspections)
    .set({
      status: "in_review",
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(inspections.id, id), eq(inspections.status, "completed")))
    .returning({ id: inspections.id });

  if (result.length === 0) {
    return NextResponse.json(
      { error: "Cannot reopen: inspection is not completed" },
      { status: 409 }
    );
  }

  return NextResponse.json({ status: "in_review" });
}
