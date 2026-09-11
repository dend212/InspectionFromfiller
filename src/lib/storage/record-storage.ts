/**
 * Storage helpers for permit documents pulled from Maricopa EDMS.
 *
 * Same private bucket as photos/reports, separate `records/` prefix so the
 * documents never leak into the report's photo pages. Signed URLs are short
 * (10 minutes) because they are handed out per click by the auth-gated
 * /api/inspections/[id]/records/[recordId] route.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export const RECORD_BUCKET = "inspection-media";
export const RECORD_SIGNED_URL_TTL_SECONDS = 600;

export function recordStoragePath(inspectionId: string, recordId: string): string {
  return `records/${inspectionId}/${recordId}.pdf`;
}

export async function uploadRecordPdf(storagePath: string, bytes: Uint8Array): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.storage.from(RECORD_BUCKET).upload(storagePath, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) {
    throw new Error(`Record upload failed: ${error.message}`);
  }
}

export async function getRecordSignedUrl(
  storagePath: string,
  expiresInSeconds: number = RECORD_SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(RECORD_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) {
    throw new Error(`Signed URL creation failed: ${error?.message ?? "no data"}`);
  }
  return data.signedUrl;
}
