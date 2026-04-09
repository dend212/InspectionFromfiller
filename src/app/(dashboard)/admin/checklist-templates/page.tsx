import { desc, isNull } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { checklistTemplates } from "@/lib/db/schema";
import { getUserRole } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

export default async function ChecklistTemplatesAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(supabase);
  if (role !== "admin") {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold">Forbidden</h1>
        <p className="text-muted-foreground mt-2">
          Only administrators can manage checklist templates.
        </p>
      </div>
    );
  }

  const templates = await db
    .select()
    .from(checklistTemplates)
    .where(isNull(checklistTemplates.archivedAt))
    .orderBy(desc(checklistTemplates.updatedAt));

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Checklist Templates</h1>
          <p className="text-muted-foreground text-sm">
            Reusable lists of items and required photos that can be snapshotted into new jobs.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/checklist-templates/new">New Template</Link>
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No templates yet. Create your first one to make job creation faster.
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.description || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {t.updatedAt.toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/checklist-templates/${t.id}`}>Edit</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
