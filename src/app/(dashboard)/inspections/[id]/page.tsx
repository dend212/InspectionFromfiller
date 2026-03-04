import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { inspectionMedia, inspections } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import type { InspectionFormData } from "@/types/inspection";
import type { AppRole } from "@/types/roles";
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
  const [inspection] = await db.select().from(inspections).where(eq(inspections.id, id)).limit(1);

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
  let media: {
    id: string;
    type: "photo" | "video";
    storagePath: string;
    label: string | null;
    description: string | null;
    sortOrder: number | null;
    createdAt: string;
  }[] = [];

  try {
    const mediaRows = await db
      .select()
      .from(inspectionMedia)
      .where(eq(inspectionMedia.inspectionId, id));

    media = mediaRows.map((m) => ({
      id: m.id,
      type: m.type as "photo" | "video",
      storagePath: m.storagePath,
      label: m.label,
      description: m.description,
      sortOrder: m.sortOrder,
      createdAt: m.createdAt.toISOString(),
    }));
  } catch (err) {
    console.error("[inspection detail] Failed to load media:", err);
    // Continue rendering without media rather than crashing the page
  }

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
        customerEmail={inspection.customerEmail ?? null}
        createdAt={inspection.createdAt.toISOString()}
        mediaCount={media.length}
        media={media}
      />
    </div>
  );
}
