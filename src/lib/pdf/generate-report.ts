/**
 * PDF Generation Orchestrator
 *
 * Loads the ADEQ form template, maps inspection data to pdfme inputs,
 * embeds the inspector signature, and generates the final PDF.
 *
 * This initial version generates ONLY the form pages (6-page ADEQ form
 * with data overlay). Photo pages and comments overflow pages are handled
 * by Plan 03, which will extend or compose with this function.
 */

import { generate } from "@pdfme/generator";
import { text, image } from "@pdfme/schemas";
import { loadTemplate } from "@/lib/pdf/template";
import { mapFormDataToInputs } from "@/lib/pdf/field-mapping";
import type { InspectionFormData } from "@/types/inspection";

/**
 * Generates a filled ADEQ inspection report PDF.
 *
 * @param formData - The inspection form data (all sections)
 * @param signatureDataUrl - PNG data URL from signature pad, or null if unsigned
 * @returns The generated PDF as a Uint8Array
 */
export async function generateReport(
  formData: InspectionFormData,
  signatureDataUrl: string | null,
): Promise<Uint8Array> {
  // Load template (basePdf + font data, cached after first call)
  const { template, font } = await loadTemplate();

  // Map structured form data to flat pdfme inputs
  const inputs = mapFormDataToInputs(formData);

  // Embed signature image if provided
  if (signatureDataUrl) {
    inputs.signatureImage = signatureDataUrl;
  }

  // Auto-fill signature date to today's date (MM/DD/YYYY)
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const year = today.getFullYear();
  inputs.signatureDate = `${month}/${day}/${year}`;

  // Generate the PDF using pdfme
  const pdf = await generate({
    template,
    inputs: [inputs],
    plugins: { text, image },
    options: { font },
  });

  return pdf;
}
