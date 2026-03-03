/**
 * PDF Merge Utility
 *
 * Merges separately-generated PDFs (cover, form, comments, photos) into a single
 * output document using pdf-lib.
 *
 * Page order: cover page -> form pages (6) -> comments page(s) -> photo pages
 *
 * Uses standalone pdf-lib since @pdfme/pdf-lib is not exported as a public API.
 */

import { PDFDocument } from "pdf-lib";

/**
 * Merges cover, form, and optional comments/photo PDFs into a single document.
 *
 * @param coverPdf - The branded cover page PDF (1 page)
 * @param formPdf - The main ADEQ form PDF (6 pages)
 * @param commentsPdf - The comments overflow page PDF, or null if no overflow
 * @param photosPdf - The photo appendix pages PDF, or null if no photos
 * @returns The merged PDF as a Uint8Array
 */
export async function mergeGeneratedPdfs(
  coverPdf: Uint8Array,
  formPdf: Uint8Array,
  commentsPdf: Uint8Array | null,
  photosPdf: Uint8Array | null,
): Promise<Uint8Array> {
  const merged = await PDFDocument.create();

  // 1. Copy cover page
  const coverDoc = await PDFDocument.load(coverPdf);
  const coverPages = await merged.copyPages(coverDoc, coverDoc.getPageIndices());
  for (const page of coverPages) {
    merged.addPage(page);
  }

  // 2. Copy all form pages
  const formDoc = await PDFDocument.load(formPdf);
  const formPages = await merged.copyPages(formDoc, formDoc.getPageIndices());
  for (const page of formPages) {
    merged.addPage(page);
  }

  // 3. Copy comments pages (if any)
  if (commentsPdf) {
    const commentsDoc = await PDFDocument.load(commentsPdf);
    const commentsPages = await merged.copyPages(commentsDoc, commentsDoc.getPageIndices());
    for (const page of commentsPages) {
      merged.addPage(page);
    }
  }

  // 4. Copy photo pages (if any)
  if (photosPdf) {
    const photosDoc = await PDFDocument.load(photosPdf);
    const photosPages = await merged.copyPages(photosDoc, photosDoc.getPageIndices());
    for (const page of photosPages) {
      merged.addPage(page);
    }
  }

  const result = await merged.save();
  return new Uint8Array(result);
}
