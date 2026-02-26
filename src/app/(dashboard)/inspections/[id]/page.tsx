import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspections, inspectionMedia } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { AppRole } from "@/types/roles";
import type { InspectionFormData } from "@/types/inspection";
import { InspectionPdfView } from "./inspection-pdf-view";

export const metadata = {
  title: "Inspection Details",
};

async function getUserRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<AppRole | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(session.access_token.split(".")[1], "base64").toString(),
    );
    return payload.user_role ?? null;
  } catch {
    return null;
  }
}

export default async function InspectionDetailPage({
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

  // Verify ownership: field_tech can only view their own inspections
  if (inspection.inspectorId !== user.id) {
    const role = await getUserRole(supabase);
    const isPrivileged = role === "admin" || role === "office_staff";
    if (!isPrivileged) {
      redirect("/inspections");
    }
  }

  // Load media records for this inspection
  const media = await db
    .select()
    .from(inspectionMedia)
    .where(eq(inspectionMedia.inspectionId, id));

  return (
    <div className="mx-auto max-w-4xl">
      <InspectionPdfView
        inspectionId={inspection.id}
        formData={inspection.formData as InspectionFormData | null}
        status={inspection.status}
        facilityName={inspection.facilityName}
        facilityAddress={inspection.facilityAddress}
        facilityCity={inspection.facilityCity}
        facilityCounty={inspection.facilityCounty}
        createdAt={inspection.createdAt.toISOString()}
        mediaCount={media.length}
      />
    </div>
  );
}
