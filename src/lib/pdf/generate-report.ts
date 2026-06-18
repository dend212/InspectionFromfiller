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
 * 6. Build branded cover page
 * 7. Generate comments overflow page (if needed)
 * 8. Generate photo appendix pages (if media provided)
 * 9. Merge all PDFs into single output: cover -> form -> comments -> photos
 */

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { MediaRecord } from "@/components/inspection/media-gallery";
import { buildCommentsPage } from "@/lib/pdf/comments-page";
import { buildCoverPage } from "@/lib/pdf/cover-page";
import { mapFormDataToFields } from "@/lib/pdf/field-mapping";
import { loadPublicFile } from "@/lib/pdf/load-public-file";
import { mergeGeneratedPdfs } from "@/lib/pdf/merge-pdf";
import { PDF_TEMPLATE_PATH } from "@/lib/pdf/pdf-field-names";
import { buildPhotoPages } from "@/lib/pdf/photo-pages";
import type { InspectionFormData } from "@/types/inspection";

/**
 * Generates a complete ADEQ inspection report PDF.
 *
 * Produces a 6-page form (pages 7-9 removed: Alternative System + Sketch)
 * with filled fields, plus optional comments overflow and photo appendix pages.
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
  const { textFields, checkboxFields, radioFields, overflow } = mapFormDataToFields(formData);

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
    await embedSignature(doc, form, signatureDataUrl, !!formData.includeAlternativePages);
  }

  // Step 7: Auto-fill signature dates with current date.
  // Pages 2 and 6 always get a date; pages 7-8 only when the alt-system pages are included.
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const year = today.getFullYear();
  const dateStr = `${month}/${day}/${year}`;
  const dateFieldNames = ["conventionalSignatureDate", "cesspoolSignatureDate"];
  if (formData.includeAlternativePages) {
    dateFieldNames.push("conventionalSignatureDate2", "altSystemInspectorDate");
  }
  for (const dateFieldName of dateFieldNames) {
    try {
      form.getTextField(dateFieldName).setText(dateStr);
    } catch {
      // Skip if field doesn't exist
    }
  }

  // Step 8: Flatten form to make it read-only
  form.flatten();

  // Step 9: Remove optional/unused pages — always remove page 9 (Sketch).
  // Keep pages 7-8 (Alternative System) only when includeAlternativePages is true.
  // Remove in reverse order to avoid index shifting.
  doc.removePage(8); // Page 9: Required Sketch (always removed)
  if (!formData.includeAlternativePages) {
    doc.removePage(7); // Page 8: Alt System Disposal Works + second signature
    doc.removePage(6); // Page 7: Alternative System
  }

  // Step 9.5: Cesspool/cesspit void overlay. When the system is a cesspool, the
  // conventional inspection does not apply — cross out every remaining page with
  // a red X on the GENERATED report only (the app's form is untouched). Pages 0-1
  // (instructions + the cesspool determination/signature on Page 2) stay clean.
  // Photos and the comments page are appended separately and are unaffected.
  if (formData.facilityInfo?.isCesspool === "yes") {
    await drawCesspoolVoidOverlay(doc);
  }

  // Step 10: Save the filled form (now 6 pages)
  const formPdf = await doc.save();

  // Step 11: Build branded cover page
  const coverPdf = await buildCoverPage();

  // Step 12: Generate comments overflow page (if needed)
  const commentsPdf = overflow.hasOverflow
    ? await buildCommentsPage(overflow.overflowSections)
    : null;

  // Step 13: Generate photo appendix pages (if media provided)
  const photosPdf =
    media && media.some((m) => m.type === "photo")
      ? await buildPhotoPages(media, {
          address: formData.facilityInfo?.facilityAddress,
          date: formData.facilityInfo?.dateOfInspection,
        })
      : null;

  // Step 14: Merge all PDFs: cover -> form -> comments -> photos
  const finalPdf = await mergeGeneratedPdfs(coverPdf, new Uint8Array(formPdf), commentsPdf, photosPdf);

  return finalPdf;
}

// ---------------------------------------------------------------------------
// Signature embedding
// ---------------------------------------------------------------------------

/**
 * Embeds a signature image at every active signature field.
 * Always: cesspoolSignature (page 2) + conventionalSignature (page 6).
 * When alt pages are included: also conventionalSignature2 + altSystemInspectorSignature (page 8).
 */
async function embedSignature(
  doc: PDFDocument,
  form: ReturnType<PDFDocument["getForm"]>,
  signatureDataUrl: string,
  includeAlternativePages: boolean,
): Promise<void> {
  // Convert data URL to bytes
  const base64 = signatureDataUrl.split(",")[1];
  if (!base64) return;

  const sigBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  // Embed as PNG image
  const sigImage = await doc.embedPng(sigBytes);

  const pages = doc.getPages();

  // Build page ref map for finding which page a widget is on.
  // Primary: widget.P() → page ref. Fallback: scan each page's Annots array.
  const pageRefToIndex = new Map<string, number>();
  for (let i = 0; i < pages.length; i++) {
    pageRefToIndex.set(pages[i].ref.toString(), i);
  }

  // Known page indices for signature fields in the ADEQ template (0-indexed)
  const SIGNATURE_PAGE_FALLBACK: Record<string, number> = {
    conventionalSignature: 5, // Page 6 of the 9-page template
    cesspoolSignature: 1,     // Page 2 of the 9-page template
    conventionalSignature2: 7, // Page 8 — alt-system inspector block (repeat conventional sig)
    altSystemInspectorSignature: 7, // Page 8 — alt-system inspector signature
  };

  // Always sign pages 2 and 6. Add page-8 sigs when alt-system pages are included.
  const signatureFieldNames = ["conventionalSignature", "cesspoolSignature"];
  if (includeAlternativePages) {
    signatureFieldNames.push("conventionalSignature2", "altSystemInspectorSignature");
  }

  for (const fieldName of signatureFieldNames) {
    try {
      const field = form.getField(fieldName);
      const widgets = field.acroField.getWidgets();
      if (widgets.length === 0) continue;

      const widget = widgets[0];
      const rect = widget.getRectangle();

      // Determine which page the widget is on.
      // widget.P() can return null in some PDFs, so fall back to known page index.
      let pageIndex: number | undefined;
      const pageRef = widget.P();
      if (pageRef) {
        pageIndex = pageRefToIndex.get(pageRef.toString());
      }
      if (pageIndex === undefined) {
        pageIndex = SIGNATURE_PAGE_FALLBACK[fieldName];
      }
      if (pageIndex === undefined || pageIndex >= pages.length) continue;

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

// ---------------------------------------------------------------------------
// Cesspool/cesspit void overlay
// ---------------------------------------------------------------------------

/**
 * First (0-indexed) form page to void when a cesspool is found.
 * In the saved form PDF: index 0 = ADEQ instructions, index 1 = Page 2 (property
 * /inspector + cesspool determination + cesspool signature — must stay valid).
 * Everything from index 2 onward (Sections 1–4.1 conventional inspection, plus
 * any retained alternative-system pages) is the "remainder" that gets crossed out.
 */
const CESSPOOL_VOID_START_PAGE_INDEX = 2;

/**
 * Draws a red X (plus a centered "CESSPOOL / CESSPIT — SEE INSPECTOR COMMENTS"
 * caption) across every page from {@link CESSPOOL_VOID_START_PAGE_INDEX} to the
 * end of the document. Drawn after flatten + page removal so the marks are part
 * of the page content and survive the final merge (copyPages). Render-only — the
 * app's editable form never shows the X.
 */
async function drawCesspoolVoidOverlay(doc: PDFDocument): Promise<void> {
  const pages = doc.getPages();
  if (pages.length <= CESSPOOL_VOID_START_PAGE_INDEX) return;

  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const red = rgb(0.78, 0.12, 0.12);
  const margin = 36;
  const thickness = 6;
  const label = "CESSPOOL / CESSPIT — SEE INSPECTOR COMMENTS";
  const fontSize = 13;

  for (let i = CESSPOOL_VOID_START_PAGE_INDEX; i < pages.length; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();

    // Diagonal red X, corner to corner (inset by a margin).
    page.drawLine({
      start: { x: margin, y: margin },
      end: { x: width - margin, y: height - margin },
      thickness,
      color: red,
      opacity: 0.85,
    });
    page.drawLine({
      start: { x: margin, y: height - margin },
      end: { x: width - margin, y: margin },
      thickness,
      color: red,
      opacity: 0.85,
    });

    // Centered caption on a white pill so it stays legible over the X.
    const textWidth = font.widthOfTextAtSize(label, fontSize);
    const padX = 14;
    const padY = 9;
    const boxWidth = textWidth + padX * 2;
    const boxHeight = fontSize + padY * 2;
    const boxX = (width - boxWidth) / 2;
    const boxY = (height - boxHeight) / 2;

    page.drawRectangle({
      x: boxX,
      y: boxY,
      width: boxWidth,
      height: boxHeight,
      color: rgb(1, 1, 1),
      borderColor: red,
      borderWidth: 2,
      opacity: 0.92,
    });
    page.drawText(label, {
      x: boxX + padX,
      y: boxY + padY,
      size: fontSize,
      font,
      color: red,
    });
  }
}
