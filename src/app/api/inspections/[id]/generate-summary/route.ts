import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inspections, inspectionSummaries } from "@/lib/db/schema";
import { getUserRole } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/inspections/[id]/generate-summary
 * Returns the most recent summary's recommendations text.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [latest] = await db
    .select({ recommendations: inspectionSummaries.recommendations })
    .from(inspectionSummaries)
    .where(eq(inspectionSummaries.inspectionId, id))
    .orderBy(desc(inspectionSummaries.createdAt))
    .limit(1);

  return NextResponse.json({ recommendations: latest?.recommendations ?? "" });
}

/**
 * POST /api/inspections/[id]/generate-summary
 * Creates a tokenized inspection summary page.
 * Allowed: admin or office_staff only.
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

  const role = await getUserRole(supabase);
  if (role !== "admin" && role !== "office_staff") {
    return NextResponse.json({ error: "Forbidden: admin or office staff only" }, { status: 403 });
  }

  let body: { recommendations?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { recommendations } = body;
  if (!recommendations || !recommendations.trim()) {
    return NextResponse.json({ error: "Recommendations text is required" }, { status: 400 });
  }

  // Load inspection
  const [inspection] = await db.select().from(inspections).where(eq(inspections.id, id)).limit(1);

  if (!inspection) {
    return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  }

  if (!inspection.finalizedPdfPath) {
    return NextResponse.json(
      { error: "No finalized PDF. Please finalize the inspection first." },
      { status: 400 },
    );
  }

  // Generate token and set 90-day expiration
  const token = nanoid(21);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const [summary] = await db
    .insert(inspectionSummaries)
    .values({
      inspectionId: id,
      token,
      recommendations: recommendations.trim(),
      createdBy: user.id,
      expiresAt,
    })
    .returning();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.headers.get("origin") || "";
  const summaryUrl = `${baseUrl}/summary/${token}`;

  return NextResponse.json({
    summaryId: summary.id,
    token,
    summaryUrl,
  });
}
