import { asc, desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checklistTemplateItems, checklistTemplates } from "@/lib/db/schema";
import { getUserRole, isAdmin } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/jobs/admin/checklist-templates
 * List all non-archived templates. Available to any authenticated user so the
 * "create job" form can offer the selector. Admin-only for mutations.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(supabase);
  if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await db
    .select()
    .from(checklistTemplates)
    .where(isNull(checklistTemplates.archivedAt))
    .orderBy(desc(checklistTemplates.updatedAt));

  return NextResponse.json({ templates: rows });
}

/**
 * POST /api/jobs/admin/checklist-templates
 * Create a new template with optional seed items. Admin only.
 * Body: { name, description?, items?: Array<{title, instructions?, requiredPhotoCount?, requiresNote?, isRequired?}> }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await isAdmin(supabase))) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }

  let body: {
    name?: string;
    description?: string;
    items?: Array<{
      title: string;
      instructions?: string;
      requiredPhotoCount?: number;
      requiresNote?: boolean;
      isRequired?: boolean;
    }>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Template name is required" }, { status: 400 });
  }

  const [template] = await db
    .insert(checklistTemplates)
    .values({
      name,
      description: body.description?.trim() || null,
      createdBy: user.id,
    })
    .returning();

  if (body.items && body.items.length > 0) {
    await db.insert(checklistTemplateItems).values(
      body.items.map((item, index) => ({
        templateId: template.id,
        title: item.title.trim(),
        instructions: item.instructions?.trim() || null,
        requiredPhotoCount: Math.max(0, Math.floor(item.requiredPhotoCount ?? 0)),
        requiresNote: !!item.requiresNote,
        isRequired: item.isRequired ?? true,
        sortOrder: index,
      })),
    );
  }

  const items = await db
    .select()
    .from(checklistTemplateItems)
    .where(eq(checklistTemplateItems.templateId, template.id))
    .orderBy(asc(checklistTemplateItems.sortOrder));

  return NextResponse.json({ template, items });
}
