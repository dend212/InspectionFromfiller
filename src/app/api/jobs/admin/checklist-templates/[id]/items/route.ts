import { eq, max } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checklistTemplateItems, checklistTemplates } from "@/lib/db/schema";
import { isAdmin } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/jobs/admin/checklist-templates/[id]/items
 * Add a new item to an existing template. Admin only.
 * Body: { title, instructions?, requiredPhotoCount?, requiresNote?, isRequired?, sortOrder? }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await isAdmin(supabase))) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }

  const [template] = await db
    .select({ id: checklistTemplates.id })
    .from(checklistTemplates)
    .where(eq(checklistTemplates.id, id))
    .limit(1);
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  let body: {
    title?: string;
    instructions?: string;
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

  const title = body.title?.trim();
  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  // Default sortOrder to max + 1 so new items land at the bottom.
  let sortOrder = body.sortOrder;
  if (sortOrder === undefined) {
    const [{ maxOrder }] = await db
      .select({ maxOrder: max(checklistTemplateItems.sortOrder) })
      .from(checklistTemplateItems)
      .where(eq(checklistTemplateItems.templateId, id));
    sortOrder = (maxOrder ?? -1) + 1;
  }

  const [item] = await db
    .insert(checklistTemplateItems)
    .values({
      templateId: id,
      title,
      instructions: body.instructions?.trim() || null,
      requiredPhotoCount: Math.max(0, Math.floor(body.requiredPhotoCount ?? 0)),
      requiresNote: !!body.requiresNote,
      isRequired: body.isRequired ?? true,
      sortOrder,
    })
    .returning();

  return NextResponse.json({ item });
}
