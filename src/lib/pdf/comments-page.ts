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
 * - Paginates onto additional pages when content (or a single long comment)
 *   does not fit on one page, so text is never clipped or run off the bottom.
 *
 * Returns a Uint8Array PDF (one or more pages) or null if no overflow exists.
 */

import type { Font, Schema, Template } from "@pdfme/common";
import { generate } from "@pdfme/generator";
import { text } from "@pdfme/schemas";
import { loadPublicFile } from "./load-public-file";

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
} as const;

const CONTENT_WIDTH = LAYOUT.pageWidth - LAYOUT.margin * 2;

// ---------------------------------------------------------------------------
// Font loader (reuses same Liberation Sans fonts as main template)
// ---------------------------------------------------------------------------

let cachedFont: Font | null = null;

async function loadFont(): Promise<Font> {
  if (cachedFont) return cachedFont;

  const [regularData, boldData] = await Promise.all([
    loadPublicFile("/fonts/LiberationSans-Regular.ttf"),
    loadPublicFile("/fonts/LiberationSans-Bold.ttf"),
  ]);

  cachedFont = {
    LiberationSans: { data: regularData, fallback: true },
    LiberationSansBold: { data: boldData },
  };

  return cachedFont;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Body text metrics (10pt Liberation Sans, lineHeight 1.3) used to paginate.
const BODY_FONT_SIZE = 10;
const BODY_LINE_HEIGHT = 1.3;
/** Vertical advance per wrapped line, in mm (10pt × 1.3 ≈ 4.59mm; rounded up). */
const LINE_ADVANCE_MM = 4.7;
/**
 * Conservative chars-per-line over CONTENT_WIDTH at 10pt (the real value is
 * ~105). Under-estimating means the computed line count is an upper bound, so a
 * body box is always tall enough for what pdfme actually renders and never clips.
 */
const CHARS_PER_LINE = 88;
/** Lowest usable Y (mm) before the bottom margin. */
const PAGE_BOTTOM_Y = BLANK_PAGE.height - LAYOUT.margin;

/**
 * Greedy word-wrap honoring explicit newlines. Conservative by design (see
 * CHARS_PER_LINE): the returned line count is an upper bound on what pdfme will
 * render, so allocating `count × LINE_ADVANCE_MM` of height can never clip.
 */
function wrapToLines(text: string, charsPerLine: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (let word of paragraph.split(/\s+/)) {
      // Hard-break a single word longer than a full line.
      while (word.length > charsPerLine) {
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(word.slice(0, charsPerLine));
        word = word.slice(charsPerLine);
      }
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length > charsPerLine && line) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    out.push(line);
  }
  return out;
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
 * Builds the appended "Inspector Comments" page(s) for the ADEQ inspection PDF.
 *
 * Paginates automatically: section blocks flow onto new US-Letter pages when
 * they no longer fit, and a single long comment is split across pages so text is
 * never clipped or run off the bottom edge.
 *
 * @param overflowSections - Sections whose comments are appended (full text)
 * @returns Uint8Array PDF (one or more pages), or null if there is nothing to append
 */
export async function buildCommentsPage(
  overflowSections: OverflowSection[],
): Promise<Uint8Array | null> {
  if (overflowSections.length === 0) return null;

  const pages: Schema[][] = [];
  const input: Record<string, string> = {};
  let pageIndex = -1;
  let y = 0;

  // Page 0 keeps the legacy key "commentsTitle"; continuation pages get unique keys.
  const startPage = (): void => {
    pageIndex += 1;
    pages[pageIndex] = [];
    const titleKey = pageIndex === 0 ? "commentsTitle" : `commentsTitle_cont_${pageIndex}`;
    pages[pageIndex].push({
      name: titleKey,
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
    input[titleKey] =
      pageIndex === 0 ? "Inspector Comments (Continued)" : "Inspector Comments (cont.)";
    y = LAYOUT.contentStartY;
  };

  const pushHeading = (key: string, label: string): void => {
    pages[pageIndex].push({
      name: key,
      type: "text",
      position: { x: LAYOUT.margin, y },
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
    input[key] = label;
    y += LAYOUT.sectionHeadingHeight;
  };

  startPage();

  // Section-indexed keys (commentHeading_<s> / commentBody_<s>) match the schema
  // contract relied on elsewhere; continuation chunks get a _<chunk> suffix.
  for (let s = 0; s < overflowSections.length; s++) {
    const section = overflowSections[s];
    const lines = wrapToLines(section.text, CHARS_PER_LINE);
    const heading = `${section.section} Comments`;

    // Break to a new page if the heading plus two body lines won't fit.
    if (y + LAYOUT.sectionHeadingHeight + LINE_ADVANCE_MM * 2 > PAGE_BOTTOM_Y) {
      startPage();
    }
    pushHeading(`commentHeading_${s}`, heading);

    let remaining = lines;
    let chunkIndex = 0;
    while (remaining.length > 0) {
      if (chunkIndex > 0) {
        // Body spilled past the page bottom — continue on a fresh page.
        startPage();
        pushHeading(`commentHeading_${s}_cont_${chunkIndex}`, `${heading} (cont.)`);
      }

      const linesThatFit = Math.max(1, Math.floor((PAGE_BOTTOM_Y - y) / LINE_ADVANCE_MM));
      const take = Math.min(remaining.length, linesThatFit);
      const chunk = remaining.slice(0, take);
      remaining = remaining.slice(take);

      const bodyKey = chunkIndex === 0 ? `commentBody_${s}` : `commentBody_${s}_${chunkIndex}`;
      const bodyHeight = take * LINE_ADVANCE_MM;
      pages[pageIndex].push({
        name: bodyKey,
        type: "text",
        position: { x: LAYOUT.margin, y },
        width: CONTENT_WIDTH,
        height: bodyHeight,
        fontSize: BODY_FONT_SIZE,
        fontName: "LiberationSans",
        alignment: "left",
        verticalAlignment: "top",
        fontColor: "#333333",
        backgroundColor: "",
        lineHeight: BODY_LINE_HEIGHT,
        characterSpacing: 0,
      } as Schema);
      // When the whole comment fits a single chunk, store the original text and
      // let pdfme wrap it (no content alteration). Only genuinely split bodies
      // carry the explicit line breaks computed by wrapToLines.
      input[bodyKey] =
        chunkIndex === 0 && remaining.length === 0 ? section.text : chunk.join("\n");
      y += bodyHeight;
      chunkIndex++;
    }

    y += LAYOUT.sectionGap;
  }

  const font = await loadFont();
  const template: Template = {
    basePdf: BLANK_PAGE,
    schemas: pages,
  };

  const pdf = await generate({
    template,
    inputs: [input],
    plugins: { text },
    options: { font },
  });

  return pdf;
}
