import { redirect } from "next/navigation";
import { ChecklistTemplateEditor } from "@/components/jobs/checklist-template-editor";
import { getUserRole } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

export default async function NewChecklistTemplatePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = await getUserRole(supabase);
  if (role !== "admin") redirect("/admin/checklist-templates");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New Checklist Template</h1>
        <p className="text-muted-foreground text-sm">
          Build a reusable list of items. Each item can require photos and/or a note.
        </p>
      </div>
      <ChecklistTemplateEditor mode="create" />
    </div>
  );
}
