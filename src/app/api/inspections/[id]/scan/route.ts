import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { parseInspectionForm } from "@/lib/ai/parse-inspection-form";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Simple in-memory rate limiter: inspectionId → timestamps of recent scans */
const scanTimestamps = new Map<string, number[]>();
const MAX_SCANS_PER_HOUR = 5;
const ONE_HOUR_MS = 60 * 60 * 1000;

function checkRateLimit(inspectionId: string): boolean {
  const now = Date.now();
  const timestamps = scanTimestamps.get(inspectionId) ?? [];
  const recent = timestamps.filter((t) => now - t < ONE_HOUR_MS);
  if (recent.length >= MAX_SCANS_PER_HOUR) {
    return false;
  }
  recent.push(now);
  scanTimestamps.set(inspectionId, recent);
  return true;
}

/**
 * POST /api/inspections/[id]/scan
 * Accepts image storage paths, fetches them from Supabase Storage,
 * sends to Claude Vision for field extraction, returns structured results.
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
      { error: "Rate limit exceeded. Maximum 5 scans per hour per inspection." },
      { status: 429 },
    );
  }

  // Parse request body
  let body: { storagePaths: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { storagePaths } = body;

  if (!Array.isArray(storagePaths) || storagePaths.length === 0 || storagePaths.length > 10) {
    return NextResponse.json(
      { error: "storagePaths must be an array of 1-10 storage paths" },
      { status: 400 },
    );
  }

  // Validate that all paths belong to this inspection
  for (const path of storagePaths) {
    if (typeof path !== "string" || !path.startsWith(`${id}/`)) {
      return NextResponse.json(
        { error: `Invalid storage path: must belong to inspection ${id}` },
        { status: 400 },
      );
    }
  }

  try {
    // Fetch images from Supabase Storage using admin client
    const admin = createAdminClient();
    const images: Array<{
      data: Buffer;
      mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
    }> = [];

    for (const storagePath of storagePaths) {
      const { data, error } = await admin.storage.from("inspection-media").download(storagePath);

      if (error || !data) {
        return NextResponse.json(
          { error: `Failed to download image: ${storagePath}` },
          { status: 500 },
        );
      }

      // Determine media type from file extension
      const ext = storagePath.split(".").pop()?.toLowerCase() ?? "jpg";
      const mediaTypeMap: Record<string, "image/jpeg" | "image/png" | "image/webp" | "image/gif"> =
        {
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          webp: "image/webp",
          gif: "image/gif",
        };
      const mediaType = mediaTypeMap[ext] ?? "image/jpeg";

      const arrayBuffer = await data.arrayBuffer();
      images.push({
        data: Buffer.from(arrayBuffer),
        mediaType,
      });
    }

    // Call the AI parser
    const result = await parseInspectionForm(images);

    return NextResponse.json(result);
  } catch (err) {
    console.error("[scan] AI parsing error:", err);
    const message = err instanceof Error ? err.message : "Failed to parse form scan";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
