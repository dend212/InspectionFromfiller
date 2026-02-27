/**
 * PDF Generation Orchestrator
 *
 * Loads the ADEQ form template, maps inspection data to pdfme inputs,
 * embeds the inspector signature, detects comment overflow, builds
 * photo appendix pages, and merges everything into the final PDF.
 *
 * Full pipeline:
 * 1. Map form data to pdfme inputs
 * 2. Detect comment overflow and substitute "See Comments" in form fields
 * 3. Generate 6-page ADEQ form PDF with data overlay
 * 4. Generate comments overflow page (if needed)
 * 5. Generate photo appendix pages (if media provided)
 * 6. Merge all PDFs into single output: form -> comments -> photos
 */

import { generate } from "@pdfme/generator";
import { text, image } from "@pdfme/schemas";
import { loadTemplate } from "@/lib/pdf/template";
import {
  mapFormDataToInputs,
  detectCommentOverflow,
} from "@/lib/pdf/field-mapping";
import { buildCommentsPage } from "@/lib/pdf/comments-page";
import { buildPhotoPages } from "@/lib/pdf/photo-pages";
import { mergeGeneratedPdfs } from "@/lib/pdf/merge-pdf";
import type { InspectionFormData } from "@/types/inspection";
import type { MediaRecord } from "@/components/inspection/media-gallery";

/**
 * Generates a complete ADEQ inspection report PDF.
 *
 * Produces the 6-page form with data overlay, plus optional comments
 * overflow page and photo appendix pages merged into a single document.
 *
 * @param formData - The inspection form data (all sections)
 * @param signatureDataUrl - PNG data URL from signature pad, or null if unsigned
 * @param media - Optional array of media records to include as photo pages
 * @returns The final merged PDF as a Uint8Array
 */
export async function generateReport(
  formData: InspectionFormData,
  signatureDataUrl: string | null,
  media?: MediaRecord[],
): Promise<Uint8Array> {
  // Step 1: Load template (basePdf + font data, cached after first call)
  const { template, font } = await loadTemplate();

  // Step 2: Map structured form data to flat pdfme inputs
  // (mapFormDataToInputs already handles "See Comments" substitution internally)
  const inputs = mapFormDataToInputs(formData);

  // Step 3: Detect comment overflow for building the comments overflow page
  const overflow = detectCommentOverflow(formData);

  // Step 4: Embed signature image if provided
  if (signatureDataUrl) {
    inputs.signatureImage = signatureDataUrl;
  } else {
    // Remove empty image field -- pdfme image plugin crashes on empty string
    delete inputs.signatureImage;
  }

  // Auto-fill signature date to today's date (MM/DD/YYYY)
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const year = today.getFullYear();
  inputs.signatureDate = `${month}/${day}/${year}`;

  // Step 5: Generate the 6-page form PDF using pdfme
  console.log("[generateReport] Generating form PDF with", Object.keys(inputs).length, "input fields");
  const formPdf = await generate({
    template,
    inputs: [inputs],
    plugins: { text, image },
    options: { font },
  });
  console.log("[generateReport] Form PDF generated:", formPdf.length, "bytes");

  // Step 6: Generate comments overflow page (if any comments exceeded threshold)
  const commentsPdf = overflow.hasOverflow
    ? await buildCommentsPage(overflow.overflowSections)
    : null;

  // Step 7: Generate photo appendix pages (if media provided with photos)
  const photosPdf =
    media && media.some((m) => m.type === "photo")
      ? await buildPhotoPages(media)
      : null;

  // Step 8: Merge all PDFs: form -> comments -> photos
  const finalPdf = await mergeGeneratedPdfs(formPdf, commentsPdf, photosPdf);

  return finalPdf;
}
