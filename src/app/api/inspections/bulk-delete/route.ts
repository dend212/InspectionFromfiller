import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";

/**
 * POST /api/inspections/bulk-delete
 * Bulk delete draft inspections.
 * Only the owner or an admin can delete. Only draft inspections can be deleted.
 * Accepts { ids: string[] } in the request body.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const ids: unknown = body?.ids;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json(
      { error: "ids must be a non-empty array" },
      { status: 400 }
    );
  }

  // Validate all IDs are strings
  if (!ids.every((id): id is string => typeof id === "string")) {
    return NextResponse.json(
      { error: "All ids must be strings" },
      { status: 400 }
    );
  }

  // Cap the batch size to prevent abuse
  if (ids.length > 100) {
    return NextResponse.json(
      { error: "Cannot delete more than 100 inspections at once" },
      { status: 400 }
    );
  }

  // Decode JWT to get user_role
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

  const isAdmin = userRole === "admin";

  // Fetch all targeted inspections to validate ownership and status
  const targets = await db
    .select({
      id: inspections.id,
      inspectorId: inspections.inspectorId,
      status: inspections.status,
    })
    .from(inspections)
    .where(inArray(inspections.id, ids));

  const errors: string[] = [];
  const deletableIds: string[] = [];

  for (const target of targets) {
    if (target.status !== "draft") {
      errors.push(`${target.id}: only draft inspections can be deleted`);
      continue;
    }

    if (target.inspectorId !== user.id && !isAdmin) {
      errors.push(`${target.id}: forbidden`);
      continue;
    }

    deletableIds.push(target.id);
  }

  let deletedCount = 0;

  if (deletableIds.length > 0) {
    await db
      .delete(inspections)
      .where(
        and(
          inArray(inspections.id, deletableIds),
          eq(inspections.status, "draft")
        )
      );

    deletedCount = deletableIds.length;
  }

  return NextResponse.json({
    deletedCount,
    requestedCount: ids.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
