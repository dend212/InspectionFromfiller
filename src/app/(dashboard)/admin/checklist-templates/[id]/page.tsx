import { asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { ChecklistTemplateEditor } from "@/components/jobs/checklist-template-editor";
import { db } from "@/lib/db";
import { checklistTemplateItems, checklistTemplates } from "@/lib/db/schema";
import { getUserRole } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditChecklistTemplatePage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = await getUserRole(supabase);
  if (role !== "admin") redirect("/admin/checklist-templates");

  const [template] = await db
    .select()
    .from(checklistTemplates)
    .where(eq(checklistTemplates.id, id))
    .limit(1);
  if (!template) notFound();

  const items = await db
    .select()
    .from(checklistTemplateItems)
    .where(eq(checklistTemplateItems.templateId, id))
    .orderBy(asc(checklistTemplateItems.sortOrder));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Edit Template</h1>
        <p className="text-muted-foreground text-sm">
          Changes apply to new jobs only — existing jobs keep their snapshot.
        </p>
      </div>
      <ChecklistTemplateEditor
        mode="edit"
        templateId={template.id}
        initialName={template.name}
        initialDescription={template.description ?? ""}
        initialItems={items.map((i) => ({
          id: i.id,
          title: i.title,
          instructions: i.instructions ?? "",
          requiredPhotoCount: i.requiredPhotoCount,
          requiresNote: i.requiresNote,
          isRequired: i.isRequired,
        }))}
      />
    </div>
  );
}
