import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checklistTemplateItems } from "@/lib/db/schema";
import { isAdmin } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * PATCH /api/jobs/admin/checklist-templates/[id]/items/[itemId]
 * Update a single template item. Admin only.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await isAdmin(supabase))) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }

  let body: {
    title?: string;
    instructions?: string | null;
    requiredPhotoCount?: number;
    requiresNote?: boolean;
    isRequired?: boolean;
    sortOrder?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const trimmed = body.title.trim();
    if (!trimmed) return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
    updates.title = trimmed;
  }
  if (body.instructions !== undefined) {
    updates.instructions = body.instructions ? body.instructions.trim() : null;
  }
  if (body.requiredPhotoCount !== undefined) {
    updates.requiredPhotoCount = Math.max(0, Math.floor(body.requiredPhotoCount));
  }
  if (body.requiresNote !== undefined) updates.requiresNote = !!body.requiresNote;
  if (body.isRequired !== undefined) updates.isRequired = !!body.isRequired;
  if (body.sortOrder !== undefined) updates.sortOrder = Math.floor(body.sortOrder);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(checklistTemplateItems)
    .set(updates)
    .where(and(eq(checklistTemplateItems.id, itemId), eq(checklistTemplateItems.templateId, id)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  return NextResponse.json({ item: updated });
}

/**
 * DELETE /api/jobs/admin/checklist-templates/[id]/items/[itemId]
 * Remove a template item. Admin only.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await isAdmin(supabase))) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }

  const [deleted] = await db
    .delete(checklistTemplateItems)
    .where(and(eq(checklistTemplateItems.id, itemId), eq(checklistTemplateItems.templateId, id)))
    .returning({ id: checklistTemplateItems.id });

  if (!deleted) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
