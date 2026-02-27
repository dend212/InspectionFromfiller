import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspections, inspectionMedia } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { AppRole } from "@/types/roles";
import type { InspectionFormData } from "@/types/inspection";
import { ReviewEditor } from "@/components/review/review-editor";

export const metadata = {
  title: "Review Inspection",
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

export default async function ReviewDetailPage({
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

  const role = await getUserRole(supabase);
  const isPrivileged = role === "admin" || role === "office_staff";

  if (!isPrivileged) {
    redirect("/");
  }

  // Load inspection
  const [inspection] = await db
    .select()
    .from(inspections)
    .where(eq(inspections.id, id))
    .limit(1);

  if (!inspection) {
    redirect("/review");
  }

  // Load media records
  const media = await db
    .select()
    .from(inspectionMedia)
    .where(eq(inspectionMedia.inspectionId, id));

  return (
    <div className="mx-auto max-w-7xl">
      <ReviewEditor
        inspection={{
          id: inspection.id,
          status: inspection.status,
          formData: inspection.formData as InspectionFormData | null,
          facilityName: inspection.facilityName,
          facilityAddress: inspection.facilityAddress,
          facilityCity: inspection.facilityCity,
          facilityCounty: inspection.facilityCounty,
          createdAt: inspection.createdAt.toISOString(),
          reviewNotes: inspection.reviewNotes,
          customerEmail: inspection.customerEmail ?? null,
        }}
        media={media.map((m) => ({
          id: m.id,
          type: m.type as "photo" | "video",
          storagePath: m.storagePath,
          label: m.label,
          sortOrder: m.sortOrder,
          createdAt: m.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
