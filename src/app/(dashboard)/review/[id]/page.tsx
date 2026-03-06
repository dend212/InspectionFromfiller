import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { ReviewEditor } from "@/components/review/review-editor";
import { db } from "@/lib/db";
import { inspectionMedia, inspections } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { InspectionFormData } from "@/types/inspection";
import type { AppRole } from "@/types/roles";

export const metadata = {
  title: "Review Inspection",
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

export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
  const [inspection] = await db.select().from(inspections).where(eq(inspections.id, id)).limit(1);

  if (!inspection) {
    redirect("/review");
  }

  // Load media records and generate signed URLs for photos
  let mediaWithUrls: {
    id: string;
    type: "photo" | "video";
    storagePath: string;
    label: string | null;
    description: string | null;
    sortOrder: number | null;
    createdAt: string;
    signedUrl: string | null;
  }[] = [];

  try {
    const mediaRows = await db
      .select()
      .from(inspectionMedia)
      .where(eq(inspectionMedia.inspectionId, id));

    const admin = createAdminClient();
    mediaWithUrls = await Promise.all(
      mediaRows.map(async (m) => {
        let signedUrl: string | null = null;
        if (m.type === "photo") {
          try {
            const { data, error } = await admin.storage
              .from("inspection-media")
              .createSignedUrl(m.storagePath, 3600);
            if (!error) {
              signedUrl = data?.signedUrl ?? null;
            } else {
              console.error("[review] Signed URL error:", error.message, "path:", m.storagePath);
            }
          } catch (urlErr) {
            console.error("[review] Signed URL exception:", urlErr, "path:", m.storagePath);
          }
        }
        return {
          id: m.id,
          type: m.type as "photo" | "video",
          storagePath: m.storagePath,
          label: m.label,
          description: m.description,
          sortOrder: m.sortOrder,
          createdAt: m.createdAt.toISOString(),
          signedUrl,
        };
      }),
    );
  } catch (err) {
    console.error("[review] Failed to load media:", err);
    // Continue rendering without media rather than crashing the page
  }

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
          isFromWorkiz: !!inspection.workizJobId,
        }}
        media={mediaWithUrls}
      />
    </div>
  );
}
