import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspections, profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getDefaultFormValues } from "@/lib/validators/inspection";

/**
 * New Inspection Page
 * Creates a new draft inspection with pre-filled inspector info and redirects
 * to the edit wizard. This is a "create and redirect" page, not a form.
 */
export default async function NewInspectionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Look up the user's profile to get their full name
  const [profile] = await db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  const inspectorName =
    profile?.fullName ?? user.user_metadata?.full_name ?? "";
  const defaultFormData = getDefaultFormValues(inspectorName);

  // Create the new inspection
  const [newInspection] = await db
    .insert(inspections)
    .values({
      inspectorId: user.id,
      status: "draft",
      formData: defaultFormData,
    })
    .returning();

  // Redirect to the edit wizard for the new inspection
  redirect(`/inspections/${newInspection.id}/edit`);
}
