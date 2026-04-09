import { desc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { NewJobForm } from "@/components/jobs/new-job-form";
import { db } from "@/lib/db";
import { checklistTemplates, profiles } from "@/lib/db/schema";
import { getUserRole } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

export default async function NewJobPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(supabase);
  if (!role) redirect("/login");

  const templates = await db
    .select({ id: checklistTemplates.id, name: checklistTemplates.name })
    .from(checklistTemplates)
    .where(isNull(checklistTemplates.archivedAt))
    .orderBy(desc(checklistTemplates.updatedAt));

  // admin / office_staff can assign to any profile; field techs can only self-assign
  const assignees =
    role === "field_tech"
      ? []
      : await db
          .select({ id: profiles.id, fullName: profiles.fullName })
          .from(profiles)
          .orderBy(profiles.fullName);

  const [self] = await db
    .select({ id: profiles.id, fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New Job</h1>
        <p className="text-muted-foreground text-sm">
          Create a new service visit. Optionally start from a checklist template.
        </p>
      </div>
      <NewJobForm
        templates={templates}
        assignees={assignees}
        currentUser={{ id: user.id, fullName: self?.fullName ?? user.email ?? "Me" }}
        role={role}
      />
    </div>
  );
}
