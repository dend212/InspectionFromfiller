/**
 * PDF Storage Helpers
 *
 * Upload finalized inspection PDFs to Supabase Storage and generate
 * signed download URLs. Uses the admin client for server-side access
 * to the private `inspection-media` bucket.
 */

import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "inspection-media";

/**
 * Upload a finalized PDF report to Supabase Storage.
 *
 * Uses `upsert: true` so re-finalizing an inspection replaces
 * the previous PDF without needing a delete step.
 *
 * @param inspectionId - The inspection UUID
 * @param pdfData - The PDF file as a Uint8Array
 * @param filename - The filename to store (e.g., "report.pdf")
 * @returns The storage path string (e.g., "reports/{id}/report.pdf")
 */
export async function uploadReport(
  inspectionId: string,
  pdfData: Uint8Array,
  filename: string,
): Promise<string> {
  const supabase = createAdminClient();
  const storagePath = `reports/${inspectionId}/${filename}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, pdfData, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) {
    throw new Error(`PDF upload failed: ${error.message}`);
  }

  return storagePath;
}

/**
 * Generate a signed download URL for a stored PDF report.
 *
 * The signed URL expires after 1 hour and includes a `download` option
 * that triggers a browser download with the specified filename.
 *
 * @param storagePath - The storage path from `uploadReport`
 * @param downloadFilename - The filename for the browser download dialog
 * @returns A signed URL string
 */
export async function getReportDownloadUrl(
  storagePath: string,
  downloadFilename: string,
): Promise<string> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600, {
      download: downloadFilename,
    });

  if (error) {
    throw new Error(`Signed URL creation failed: ${error.message}`);
  }

  return data.signedUrl;
}

/**
 * Build a download filename from the facility address and completion date.
 *
 * Format: "123-Main-St_2026-02-26.pdf"
 * - Spaces replaced with hyphens
 * - Special characters removed (only alphanumeric, hyphens, underscores)
 * - Falls back to "inspection-report" if no address
 *
 * @param facilityAddress - The facility street address, or null
 * @param completedAt - The completion date, or null (falls back to today)
 * @returns A sanitized filename string ending in .pdf
 */
export function buildDownloadFilename(
  facilityAddress: string | null,
  completedAt: Date | null,
): string {
  // Sanitize address
  const addressPart = facilityAddress
    ? facilityAddress
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9-]/g, "")
    : "inspection-report";

  // Format date as YYYY-MM-DD
  const date = completedAt ?? new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const datePart = `${year}-${month}-${day}`;

  return `${addressPart}_${datePart}.pdf`;
}
