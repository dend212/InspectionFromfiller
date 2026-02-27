import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { InspectionWizard } from "@/components/inspection/inspection-wizard";
import type { AppRole } from "@/types/roles";
import type { InspectionFormData } from "@/types/inspection";

export const metadata = {
  title: "Edit Inspection",
};

async function getUserRole(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<AppRole | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(session.access_token.split(".")[1], "base64").toString()
    );
    return payload.user_role ?? null;
  } catch {
    return null;
  }
}

export default async function EditInspectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Load inspection from database
  const [inspection] = await db
    .select()
    .from(inspections)
    .where(eq(inspections.id, id))
    .limit(1);

  if (!inspection) {
    redirect("/inspections");
  }

  // Verify ownership: field_tech can only edit their own inspections
  if (inspection.inspectorId !== user.id) {
    const role = await getUserRole(supabase);
    const isPrivileged = role === "admin" || role === "office_staff";
    if (!isPrivileged) {
      redirect("/inspections");
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <InspectionWizard
        inspection={{
          id: inspection.id,
          formData: inspection.formData as InspectionFormData | null,
          status: inspection.status,
          reviewNotes: inspection.reviewNotes,
        }}
      />
    </div>
  );
}
