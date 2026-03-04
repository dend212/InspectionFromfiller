import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { rewriteInspectionComment } from "@/lib/ai/rewrite-comments";
import type { CommentSection } from "@/lib/ai/rewrite-comments";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

/** Simple in-memory rate limiter: inspectionId → timestamps */
const rewriteTimestamps = new Map<string, number[]>();
const MAX_REWRITES_PER_HOUR = 5;
const ONE_HOUR_MS = 60 * 60 * 1000;

function checkRateLimit(inspectionId: string): boolean {
  const now = Date.now();
  const timestamps = rewriteTimestamps.get(inspectionId) ?? [];
  const recent = timestamps.filter((t) => now - t < ONE_HOUR_MS);
  if (recent.length >= MAX_REWRITES_PER_HOUR) {
    return false;
  }
  recent.push(now);
  rewriteTimestamps.set(inspectionId, recent);
  return true;
}

const VALID_SECTIONS: CommentSection[] = ["septicTank", "disposalWorks"];

/**
 * POST /api/inspections/[id]/rewrite-comments
 * Rewrites or generates inspector comments using Claude.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify the inspection exists and user has access
  const [inspection] = await db
    .select({ inspectorId: inspections.inspectorId, status: inspections.status })
    .from(inspections)
    .where(eq(inspections.id, id))
    .limit(1);

  if (!inspection) {
    return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  }

  // Check ownership or privileged role
  if (inspection.inspectorId !== user.id) {
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

    const isPrivileged = userRole === "admin" || userRole === "office_staff";
    if (!isPrivileged) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Rate limit
  if (!checkRateLimit(id)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Maximum 5 rewrites per hour per inspection." },
      { status: 429 },
    );
  }

  // Parse request body
  let body: { section: string; currentComment: string; formContext: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { section, currentComment, formContext } = body;

  if (!VALID_SECTIONS.includes(section as CommentSection)) {
    return NextResponse.json(
      { error: "Invalid section. Must be 'septicTank' or 'disposalWorks'." },
      { status: 400 },
    );
  }

  if (typeof currentComment !== "string") {
    return NextResponse.json({ error: "currentComment must be a string" }, { status: 400 });
  }

  if (!formContext || typeof formContext !== "object") {
    return NextResponse.json({ error: "formContext must be an object" }, { status: 400 });
  }

  try {
    const rewrittenComment = await rewriteInspectionComment({
      section: section as CommentSection,
      currentComment,
      // biome-ignore lint/suspicious/noExplicitAny: formContext shape validated by AI module
      formContext: formContext as any,
    });

    return NextResponse.json({ rewrittenComment });
  } catch (err) {
    console.error("[rewrite-comments] AI error:", err);
    const message = err instanceof Error ? err.message : "Failed to generate comment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
