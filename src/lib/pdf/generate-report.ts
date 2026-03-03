/**
 * PDF Generation Orchestrator
 *
 * Loads the ADEQ form template, fills native AcroForm fields with pdf-lib,
 * embeds the inspector signature, detects comment overflow, builds
 * photo appendix pages, and merges everything into the final PDF.
 *
 * Full pipeline:
 * 1. Map form data to typed field maps (text, checkbox, radio)
 * 2. Load the renamed PDF template with native form fields
 * 3. Fill text fields, check checkboxes, select radio options
 * 4. Embed signature image at the signature field positions
 * 5. Flatten the form (makes fields read-only)
 * 6. Generate comments overflow page (if needed)
 * 7. Generate photo appendix pages (if media provided)
 * 8. Merge all PDFs into single output: form -> comments -> photos
 */

import { PDFDocument } from "pdf-lib";
import { loadPublicFile } from "@/lib/pdf/load-public-file";
import { mapFormDataToFields } from "@/lib/pdf/field-mapping";
import { PDF_TEMPLATE_PATH } from "@/lib/pdf/pdf-field-names";
import { buildCommentsPage } from "@/lib/pdf/comments-page";
import { buildPhotoPages } from "@/lib/pdf/photo-pages";
import { mergeGeneratedPdfs } from "@/lib/pdf/merge-pdf";
import type { InspectionFormData } from "@/types/inspection";
import type { MediaRecord } from "@/components/inspection/media-gallery";

/**
 * Generates a complete ADEQ inspection report PDF.
 *
 * Produces the 9-page form with filled fields, plus optional comments
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
  // Step 1: Map form data to typed field maps
  const { textFields, checkboxFields, radioFields, overflow } =
    mapFormDataToFields(formData);

  // Step 2: Load the PDF template with native AcroForm fields
  const templateBytes = await loadPublicFile(PDF_TEMPLATE_PATH);
  const doc = await PDFDocument.load(templateBytes);
  const form = doc.getForm();

  // Step 3: Fill text fields
  for (const [name, value] of Object.entries(textFields)) {
    if (!value) continue;
    try {
      const field = form.getTextField(name);
      field.setText(value);
    } catch {
      // Field may not exist if template changed — skip silently
    }
  }

  // Step 4: Check checkboxes
  for (const [name, checked] of Object.entries(checkboxFields)) {
    if (!checked) continue;
    try {
      const field = form.getCheckBox(name);
      field.check();
    } catch {
      // Skip missing fields
    }
  }

  // Step 5: Select radio options
  for (const [name, value] of Object.entries(radioFields)) {
    if (!value) continue;
    try {
      const field = form.getRadioGroup(name);
      field.select(value);
    } catch {
      // Skip missing fields
    }
  }

  // Step 6: Embed signature image
  if (signatureDataUrl) {
    await embedSignature(doc, form, signatureDataUrl);
  }

  // Step 7: Auto-fill signature date if not provided
  const sigDateField = textFields.conventionalSignatureDate;
  if (!sigDateField) {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const year = today.getFullYear();
    const dateStr = `${month}/${day}/${year}`;
    try {
      form.getTextField("conventionalSignatureDate").setText(dateStr);
      form.getTextField("conventionalSignatureDate2").setText(dateStr);
    } catch {
      // Skip if fields don't exist
    }
  }

  // Step 8: Flatten form to make it read-only
  form.flatten();

  // Step 9: Save the filled form
  const formPdf = await doc.save();

  // Step 10: Generate comments overflow page (if needed)
  const commentsPdf = overflow.hasOverflow
    ? await buildCommentsPage(overflow.overflowSections)
    : null;

  // Step 11: Generate photo appendix pages (if media provided)
  const photosPdf =
    media && media.some((m) => m.type === "photo")
      ? await buildPhotoPages(media)
      : null;

  // Step 12: Merge all PDFs: form -> comments -> photos
  const finalPdf = await mergeGeneratedPdfs(
    new Uint8Array(formPdf),
    commentsPdf,
    photosPdf,
  );

  return finalPdf;
}

// ---------------------------------------------------------------------------
// Signature embedding
// ---------------------------------------------------------------------------

/**
 * Embeds a signature image at the conventional signature field positions.
 * Draws the image on pages 6 and 8 where the signature fields are located.
 */
async function embedSignature(
  doc: PDFDocument,
  form: ReturnType<PDFDocument["getForm"]>,
  signatureDataUrl: string,
): Promise<void> {
  // Convert data URL to bytes
  const base64 = signatureDataUrl.split(",")[1];
  if (!base64) return;

  const sigBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  // Embed as PNG image
  const sigImage = await doc.embedPng(sigBytes);

  // Build page ref map for finding which page a widget is on
  const pages = doc.getPages();
  const pageRefToIndex = new Map<string, number>();
  for (let i = 0; i < pages.length; i++) {
    pageRefToIndex.set(pages[i].ref.toString(), i);
  }

  // Draw signature at each signature field location
  const signatureFieldNames = [
    "conventionalSignature",
    "conventionalSignature2",
  ];

  for (const fieldName of signatureFieldNames) {
    try {
      const field = form.getField(fieldName);
      const widgets = field.acroField.getWidgets();
      if (widgets.length === 0) continue;

      const widget = widgets[0];
      const rect = widget.getRectangle();
      const pageRef = widget.P();
      if (!pageRef) continue;

      const pageIndex = pageRefToIndex.get(pageRef.toString());
      if (pageIndex === undefined) continue;

      const page = pages[pageIndex];

      // Scale signature to fit within the field rectangle while preserving aspect ratio
      const imgAspect = sigImage.width / sigImage.height;
      const fieldAspect = rect.width / rect.height;

      let drawWidth = rect.width;
      let drawHeight = rect.height;

      if (imgAspect > fieldAspect) {
        // Image is wider — fit to width
        drawHeight = rect.width / imgAspect;
      } else {
        // Image is taller — fit to height
        drawWidth = rect.height * imgAspect;
      }

      // Center the image within the field
      const xOffset = (rect.width - drawWidth) / 2;
      const yOffset = (rect.height - drawHeight) / 2;

      page.drawImage(sigImage, {
        x: rect.x + xOffset,
        y: rect.y + yOffset,
        width: drawWidth,
        height: drawHeight,
      });
    } catch {
      // Skip if field not found
    }
  }

  // Remove the signature fields since we drew images directly
  for (const fieldName of signatureFieldNames) {
    try {
      form.removeField(form.getField(fieldName));
    } catch {
      // Already removed or doesn't exist
    }
  }
}
