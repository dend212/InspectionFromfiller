import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checklistTemplateItems, checklistTemplates } from "@/lib/db/schema";
import { isAdmin } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/jobs/admin/checklist-templates/[id]
 * Return template with items. Any authenticated user may read.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [template] = await db
    .select()
    .from(checklistTemplates)
    .where(eq(checklistTemplates.id, id))
    .limit(1);

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const items = await db
    .select()
    .from(checklistTemplateItems)
    .where(eq(checklistTemplateItems.templateId, id))
    .orderBy(asc(checklistTemplateItems.sortOrder));

  return NextResponse.json({ template, items });
}

/**
 * PATCH /api/jobs/admin/checklist-templates/[id]
 * Update template metadata or archive/unarchive. Admin only.
 * Body: { name?, description?, archived?: boolean }
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await isAdmin(supabase))) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }

  let body: { name?: string; description?: string | null; archived?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    }
    updates.name = trimmed;
  }
  if (body.description !== undefined) {
    updates.description = body.description ? body.description.trim() : null;
  }
  if (body.archived !== undefined) {
    updates.archivedAt = body.archived ? new Date() : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(checklistTemplates)
    .set(updates)
    .where(eq(checklistTemplates.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({ template: updated });
}

/**
 * DELETE /api/jobs/admin/checklist-templates/[id]
 * Hard delete. Admin only. Cascades to items. Existing jobs created from this
 * template are unaffected (they hold their own snapshot of items).
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await isAdmin(supabase))) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }

  const [deleted] = await db
    .delete(checklistTemplates)
    .where(eq(checklistTemplates.id, id))
    .returning({ id: checklistTemplates.id });

  if (!deleted) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
