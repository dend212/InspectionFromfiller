/**
 * Comments Overflow Page Builder for ADEQ Inspection PDF
 *
 * When inspector comments exceed the small text fields on the form,
 * the field displays "See Comments" and a dedicated overflow page is appended.
 *
 * Layout:
 * - Title: "Inspector Comments (Continued)" centered, bold, 14pt
 * - For each overflowing section:
 *   - Section heading (bold, 12pt): e.g., "Design Flow Comments"
 *   - Comment body (10pt, left-aligned, multi-line)
 * - Sections stacked vertically with spacing
 *
 * Returns a Uint8Array PDF or null if no overflow exists.
 */

import type { Template, Schema, Font } from "@pdfme/common";
import { generate } from "@pdfme/generator";
import { text } from "@pdfme/schemas";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Blank US Letter page in mm for pdfme basePdf */
const BLANK_PAGE = {
  width: 215.9,
  height: 279.4,
  padding: [10, 10, 10, 10] as [number, number, number, number],
};

/** Layout constants (in mm) */
const LAYOUT = {
  pageWidth: 215.9,
  margin: 15,
  titleY: 15,
  titleHeight: 10,
  contentStartY: 30,
  sectionHeadingHeight: 7,
  sectionGap: 4,
  /** Base height per comment section; expands with text length */
  commentBaseHeight: 40,
  /** Extra height per 100 chars over base threshold */
  heightPer100Chars: 8,
  /** Maximum height for a single comment block before it needs page splitting */
  maxCommentHeight: 180,
} as const;

const CONTENT_WIDTH = LAYOUT.pageWidth - LAYOUT.margin * 2;

// ---------------------------------------------------------------------------
// Font loader (reuses same Liberation Sans fonts as main template)
// ---------------------------------------------------------------------------

let cachedFont: Font | null = null;

async function loadFont(): Promise<Font> {
  if (cachedFont) return cachedFont;

  const [regularRes, boldRes] = await Promise.all([
    fetch("/fonts/LiberationSans-Regular.ttf"),
    fetch("/fonts/LiberationSans-Bold.ttf"),
  ]);

  if (!regularRes.ok || !boldRes.ok) {
    throw new Error("Failed to load fonts for comments page");
  }

  cachedFont = {
    LiberationSans: { data: await regularRes.arrayBuffer(), fallback: true },
    LiberationSansBold: { data: await boldRes.arrayBuffer() },
  };

  return cachedFont;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculates an appropriate height for a comment text block
 * based on character count. Uses a heuristic of ~100 chars per
 * additional height increment.
 */
function calculateCommentHeight(text: string): number {
  const baseHeight = LAYOUT.commentBaseHeight;
  const extraChars = Math.max(0, text.length - 200);
  const extraHeight = Math.ceil(extraChars / 100) * LAYOUT.heightPer100Chars;
  return Math.min(baseHeight + extraHeight, LAYOUT.maxCommentHeight);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface OverflowSection {
  section: string;
  fieldName: string;
  text: string;
}

/**
 * Builds a comments overflow page for the ADEQ inspection PDF.
 *
 * @param overflowSections - Sections with comments that exceeded form field space
 * @returns Uint8Array PDF of comments page, or null if no overflow
 */
export async function buildCommentsPage(
  overflowSections: OverflowSection[],
): Promise<Uint8Array | null> {
  if (overflowSections.length === 0) return null;

  const schemas: Schema[] = [];
  const input: Record<string, string> = {};

  // Title: "Inspector Comments (Continued)"
  schemas.push({
    name: "commentsTitle",
    type: "text",
    position: { x: LAYOUT.margin, y: LAYOUT.titleY },
    width: CONTENT_WIDTH,
    height: LAYOUT.titleHeight,
    fontSize: 14,
    fontName: "LiberationSansBold",
    alignment: "center",
    verticalAlignment: "middle",
    fontColor: "#000000",
    backgroundColor: "",
    lineHeight: 1,
    characterSpacing: 0,
  } as Schema);
  input.commentsTitle = "Inspector Comments (Continued)";

  // Build section blocks
  let currentY = LAYOUT.contentStartY;

  for (let i = 0; i < overflowSections.length; i++) {
    const section = overflowSections[i];
    const headingKey = `commentHeading_${i}`;
    const bodyKey = `commentBody_${i}`;
    const commentHeight = calculateCommentHeight(section.text);

    // Section heading
    schemas.push({
      name: headingKey,
      type: "text",
      position: { x: LAYOUT.margin, y: currentY },
      width: CONTENT_WIDTH,
      height: LAYOUT.sectionHeadingHeight,
      fontSize: 12,
      fontName: "LiberationSansBold",
      alignment: "left",
      verticalAlignment: "middle",
      fontColor: "#000000",
      backgroundColor: "",
      lineHeight: 1,
      characterSpacing: 0,
    } as Schema);
    input[headingKey] = `${section.section} Comments`;

    currentY += LAYOUT.sectionHeadingHeight;

    // Comment body
    schemas.push({
      name: bodyKey,
      type: "text",
      position: { x: LAYOUT.margin, y: currentY },
      width: CONTENT_WIDTH,
      height: commentHeight,
      fontSize: 10,
      dynamicFontSize: { min: 7, max: 10, fit: "horizontal" },
      fontName: "LiberationSans",
      alignment: "left",
      verticalAlignment: "top",
      fontColor: "#333333",
      backgroundColor: "",
      lineHeight: 1.3,
      characterSpacing: 0,
    } as Schema);
    input[bodyKey] = section.text;

    currentY += commentHeight + LAYOUT.sectionGap;
  }

  // Generate single-page PDF
  const font = await loadFont();
  const template: Template = {
    basePdf: BLANK_PAGE,
    schemas: [schemas],
  };

  const pdf = await generate({
    template,
    inputs: [input],
    plugins: { text },
    options: { font },
  });

  return pdf;
}
