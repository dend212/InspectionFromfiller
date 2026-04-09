/**
 * Cover Page Builder for ADEQ Inspection PDF
 *
 * Generates a branded cover page with the SewerTime logo,
 * company contact info, and a liability disclaimer.
 *
 * Uses pdf-lib with standard Helvetica fonts.
 */

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { getSewertimeLogoBytes } from "./sewertime-logo";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** US Letter in points */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

const COMPANY_PHONE = "(602) 777-7867";
const COMPANY_ADDRESS = "33645 N Cave Creek Rd, Cave Creek, AZ 85331";

const DISCLAIMER = `This Onsite Wastewater Treatment System Inspection Report is based solely on the conditions observed at the time of inspection and our professional experience with wastewater systems. SewerTime Septic has not been hired to guarantee, warrant, or certify the future performance of the system.

Wastewater treatment system performance can be affected by many variables, including usage patterns, soil conditions, and past system failures. Therefore, this report should not be interpreted as a warranty that the system will continue to function properly for any future owner or occupant.

SewerTime Septic expressly disclaims any and all warranties — whether expressed or implied — related to the condition, operation, or environmental impact of the system, including those that may arise from this inspection or the contents of this report.`;

// ---------------------------------------------------------------------------
// Text wrapping helper
// ---------------------------------------------------------------------------

function wrapText(
  text: string,
  font: ReturnType<typeof Object>,
  fontSize: number,
  maxWidth: number,
): string[] {
  const paragraphs = text.split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }

    const words = paragraph.split(" ");
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const testWidth = (font as any).widthOfTextAtSize(testLine, fontSize);
      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Builds a branded cover page PDF for the inspection report.
 *
 * @returns Uint8Array of the single-page cover PDF
 */
export async function buildCoverPage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  // Embed fonts
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // --- Logo ---
  // Bytes come from a base64-inlined module so this works reliably in
  // Vercel serverless functions, where public/ isn't bundled into the
  // Lambda runtime. See src/lib/pdf/sewertime-logo.ts.
  const logoImage = await doc.embedPng(getSewertimeLogoBytes());

  // Scale logo to fit within ~400px wide, centered
  const maxLogoWidth = 400;
  const maxLogoHeight = 200;
  const logoScale = Math.min(maxLogoWidth / logoImage.width, maxLogoHeight / logoImage.height);
  const logoDrawWidth = logoImage.width * logoScale;
  const logoDrawHeight = logoImage.height * logoScale;
  const logoX = (PAGE_WIDTH - logoDrawWidth) / 2;
  const logoY = PAGE_HEIGHT - 220 - logoDrawHeight / 2; // upper third

  page.drawImage(logoImage, {
    x: logoX,
    y: logoY,
    width: logoDrawWidth,
    height: logoDrawHeight,
  });

  // --- Company Contact Info (below logo) ---
  const contactY = logoY - 50;
  const phoneWidth = helvetica.widthOfTextAtSize(COMPANY_PHONE, 16);
  page.drawText(COMPANY_PHONE, {
    x: (PAGE_WIDTH - phoneWidth) / 2,
    y: contactY,
    size: 16,
    font: helvetica,
    color: rgb(0.2, 0.2, 0.2),
  });

  const addressWidth = helvetica.widthOfTextAtSize(COMPANY_ADDRESS, 14);
  page.drawText(COMPANY_ADDRESS, {
    x: (PAGE_WIDTH - addressWidth) / 2,
    y: contactY - 24,
    size: 14,
    font: helvetica,
    color: rgb(0.3, 0.3, 0.3),
  });

  // --- Disclaimer (bottom of page) ---
  const disclaimerFontSize = 8;
  const disclaimerMargin = 50;
  const disclaimerMaxWidth = PAGE_WIDTH - disclaimerMargin * 2;
  const disclaimerLineHeight = disclaimerFontSize * 1.5;

  // Title
  const disclaimerTitleSize = 9;
  const disclaimerTitle = "Disclaimer";
  const titleWidth = helveticaBold.widthOfTextAtSize(disclaimerTitle, disclaimerTitleSize);

  const wrappedLines = wrapText(DISCLAIMER, helvetica, disclaimerFontSize, disclaimerMaxWidth);
  const totalDisclaimerHeight =
    wrappedLines.length * disclaimerLineHeight + disclaimerTitleSize + 10;
  const disclaimerStartY = 40 + totalDisclaimerHeight;

  page.drawText(disclaimerTitle, {
    x: (PAGE_WIDTH - titleWidth) / 2,
    y: disclaimerStartY,
    size: disclaimerTitleSize,
    font: helveticaBold,
    color: rgb(0.3, 0.3, 0.3),
  });

  let lineY = disclaimerStartY - disclaimerTitleSize - 8;
  for (const line of wrappedLines) {
    if (line === "") {
      lineY -= disclaimerLineHeight * 0.5;
      continue;
    }
    page.drawText(line, {
      x: disclaimerMargin,
      y: lineY,
      size: disclaimerFontSize,
      font: helvetica,
      color: rgb(0.35, 0.35, 0.35),
    });
    lineY -= disclaimerLineHeight;
  }

  const result = await doc.save();
  return new Uint8Array(result);
}
