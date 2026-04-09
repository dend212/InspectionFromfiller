/**
 * Custom Service Visit Report PDF Pipeline
 *
 * Generates a fully branded, multi-section PDF for the Jobs module:
 *   1. Cover page
 *   2. Job info block
 *   3. Per-checklist-item sections (title, status, note, inline photos)
 *   4. General notes section
 *   5. Customer summary paragraph (if present)
 *   6. General photos appendix (filtered by audience)
 *
 * This pipeline is independent of the ADEQ inspection pipeline. It does not
 * fill any template — it builds every page from scratch with pdf-lib.
 *
 * Two audience modes:
 *   - "staff": includes every general photo regardless of visibleToCustomer
 *   - "customer": omits any general photo with visibleToCustomer = false
 *
 * Checklist-item photos are ALWAYS included (they are required evidence).
 */

import {
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  rgb,
  StandardFonts,
} from "pdf-lib";
import type {
  jobChecklistItems as jobChecklistItemsTable,
  jobMedia as jobMediaTable,
  jobs as jobsTable,
} from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchImageBytesForPdf } from "./image-embed";

type JobRow = typeof jobsTable.$inferSelect;
type JobItemRow = typeof jobChecklistItemsTable.$inferSelect;
type JobMediaRow = typeof jobMediaTable.$inferSelect;

export interface JobReportInput {
  job: JobRow;
  items: JobItemRow[];
  media: JobMediaRow[];
  assigneeName: string | null;
  audience: "staff" | "customer";
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const MARGIN = 48;
const CONTENT_W = PAGE_W - 2 * MARGIN;

const C = {
  brand: rgb(0.06, 0.34, 0.56),
  dark: rgb(0.13, 0.16, 0.22),
  body: rgb(0.22, 0.25, 0.32),
  muted: rgb(0.46, 0.5, 0.57),
  line: rgb(0.83, 0.87, 0.91),
  cardFill: rgb(0.97, 0.98, 0.99),
  cardBorder: rgb(0.88, 0.9, 0.93),
  statusPending: rgb(0.84, 0.77, 0.42),
  statusDone: rgb(0.22, 0.63, 0.37),
  statusSkipped: rgb(0.68, 0.45, 0.2),
  white: rgb(1, 1, 1),
};

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

// ---------------------------------------------------------------------------
// Utility drawing helpers
// ---------------------------------------------------------------------------

interface Cursor {
  page: PDFPage;
  y: number;
}

function newPage(doc: PDFDocument): Cursor {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  return { page, y: PAGE_H - MARGIN };
}

function ensureSpace(doc: PDFDocument, cursor: Cursor, needed: number): Cursor {
  if (cursor.y - needed < MARGIN + 20) {
    return newPage(doc);
  }
  return cursor;
}

/** Naive word-wrap by measured width. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawParagraph(
  doc: PDFDocument,
  cursor: Cursor,
  fonts: Fonts,
  text: string,
  opts: {
    size?: number;
    font?: PDFFont;
    color?: ReturnType<typeof rgb>;
    lineGap?: number;
    x?: number;
    maxWidth?: number;
  } = {},
): Cursor {
  const size = opts.size ?? 10.5;
  const font = opts.font ?? fonts.regular;
  const color = opts.color ?? C.body;
  const lineGap = opts.lineGap ?? 2;
  const x = opts.x ?? MARGIN;
  const maxWidth = opts.maxWidth ?? CONTENT_W;
  const lineH = size + lineGap;
  const lines = wrapText(text, font, size, maxWidth);
  let c = cursor;
  for (const line of lines) {
    c = ensureSpace(doc, c, lineH);
    c.page.drawText(line, { x, y: c.y - size, size, font, color });
    c.y -= lineH;
  }
  return c;
}

function drawDivider(cursor: Cursor): Cursor {
  cursor.page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: PAGE_W - MARGIN, y: cursor.y },
    thickness: 0.75,
    color: C.line,
  });
  cursor.y -= 12;
  return cursor;
}

function drawSectionHeading(doc: PDFDocument, cursor: Cursor, fonts: Fonts, text: string): Cursor {
  const c = ensureSpace(doc, cursor, 30);
  c.y -= 4;
  c.page.drawText(text, { x: MARGIN, y: c.y - 14, size: 14, font: fonts.bold, color: C.brand });
  c.y -= 18;
  c.page.drawLine({
    start: { x: MARGIN, y: c.y },
    end: { x: PAGE_W - MARGIN, y: c.y },
    thickness: 1,
    color: C.brand,
  });
  c.y -= 10;
  return c;
}

function drawLabeledField(
  doc: PDFDocument,
  cursor: Cursor,
  fonts: Fonts,
  label: string,
  value: string | null | undefined,
): Cursor {
  if (!value) return cursor;
  const c = ensureSpace(doc, cursor, 16);
  c.page.drawText(`${label}:`, {
    x: MARGIN,
    y: c.y - 10,
    size: 9.5,
    font: fonts.bold,
    color: C.muted,
  });
  c.page.drawText(value, {
    x: MARGIN + 108,
    y: c.y - 10,
    size: 10.5,
    font: fonts.regular,
    color: C.dark,
  });
  c.y -= 16;
  return c;
}

function drawStatusChip(page: PDFPage, fonts: Fonts, x: number, y: number, status: string) {
  const label = status === "done" ? "DONE" : status === "skipped" ? "SKIPPED" : "PENDING";
  const color =
    status === "done" ? C.statusDone : status === "skipped" ? C.statusSkipped : C.statusPending;
  const textW = fonts.bold.widthOfTextAtSize(label, 8);
  const padX = 6;
  const padY = 3;
  const w = textW + padX * 2;
  const h = 8 + padY * 2;
  page.drawRectangle({ x, y, width: w, height: h, color });
  page.drawText(label, { x: x + padX, y: y + padY, size: 8, font: fonts.bold, color: C.white });
}

// ---------------------------------------------------------------------------
// Cover page
// ---------------------------------------------------------------------------

function buildCoverPage(doc: PDFDocument, fonts: Fonts, input: JobReportInput): void {
  const page = doc.addPage([PAGE_W, PAGE_H]);

  // Brand accent stripe
  page.drawRectangle({
    x: 0,
    y: PAGE_H - 6,
    width: PAGE_W,
    height: 6,
    color: C.brand,
  });

  // Header label
  page.drawText("SERVICE VISIT REPORT", {
    x: MARGIN,
    y: PAGE_H - 110,
    size: 12,
    font: fonts.bold,
    color: C.muted,
  });

  // Title
  const titleLines = wrapText(input.job.title, fonts.bold, 28, CONTENT_W);
  let y = PAGE_H - 148;
  for (const line of titleLines.slice(0, 2)) {
    page.drawText(line, { x: MARGIN, y, size: 28, font: fonts.bold, color: C.dark });
    y -= 34;
  }

  // Customer + address block
  y -= 10;
  if (input.job.customerName) {
    page.drawText(input.job.customerName, {
      x: MARGIN,
      y,
      size: 16,
      font: fonts.regular,
      color: C.body,
    });
    y -= 22;
  }

  const addressLines: string[] = [];
  if (input.job.serviceAddress) addressLines.push(input.job.serviceAddress);
  const cityLine = [input.job.city, input.job.state, input.job.zip].filter(Boolean).join(" ");
  if (cityLine) addressLines.push(cityLine);
  for (const line of addressLines) {
    page.drawText(line, { x: MARGIN, y, size: 12, font: fonts.regular, color: C.muted });
    y -= 16;
  }

  // Bottom metadata
  const metaY = 150;
  page.drawLine({
    start: { x: MARGIN, y: metaY + 70 },
    end: { x: PAGE_W - MARGIN, y: metaY + 70 },
    thickness: 0.75,
    color: C.line,
  });
  const label = (t: string, v: string, yy: number) => {
    page.drawText(t.toUpperCase(), {
      x: MARGIN,
      y: yy,
      size: 8,
      font: fonts.bold,
      color: C.muted,
    });
    page.drawText(v, {
      x: MARGIN + 100,
      y: yy,
      size: 11,
      font: fonts.regular,
      color: C.dark,
    });
  };

  const dateStr = (input.job.completedAt ?? input.job.updatedAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  label("Technician", input.assigneeName ?? "—", metaY + 50);
  label("Service date", dateStr, metaY + 30);
  label("Status", (input.job.status ?? "open").replace("_", " ").toUpperCase(), metaY + 10);
}

// ---------------------------------------------------------------------------
// Job info block (second page if needed)
// ---------------------------------------------------------------------------

function buildJobInfoSection(
  doc: PDFDocument,
  cursor: Cursor,
  fonts: Fonts,
  input: JobReportInput,
): Cursor {
  let c = drawSectionHeading(doc, cursor, fonts, "Job Information");
  c = drawLabeledField(doc, c, fonts, "Customer", input.job.customerName);
  c = drawLabeledField(doc, c, fonts, "Email", input.job.customerEmail);
  c = drawLabeledField(doc, c, fonts, "Phone", input.job.customerPhone);
  c = drawLabeledField(doc, c, fonts, "Address", input.job.serviceAddress);
  c = drawLabeledField(
    doc,
    c,
    fonts,
    "City / State / Zip",
    [input.job.city, input.job.state, input.job.zip].filter(Boolean).join(", ") || null,
  );
  c = drawLabeledField(doc, c, fonts, "Technician", input.assigneeName);
  c = drawLabeledField(
    doc,
    c,
    fonts,
    "Scheduled",
    input.job.scheduledFor ? input.job.scheduledFor.toLocaleString() : null,
  );
  c = drawLabeledField(
    doc,
    c,
    fonts,
    "Completed",
    input.job.completedAt ? input.job.completedAt.toLocaleString() : null,
  );
  c.y -= 10;
  return c;
}

// ---------------------------------------------------------------------------
// Checklist sections with inline photos
// ---------------------------------------------------------------------------

interface EmbeddedImage {
  mediaId: string;
  image: PDFImage;
  width: number;
  height: number;
  description: string | null;
}

async function embedAllImages(
  doc: PDFDocument,
  mediaRows: JobMediaRow[],
): Promise<Map<string, EmbeddedImage>> {
  const admin = createAdminClient();
  const results = new Map<string, EmbeddedImage>();

  await Promise.all(
    mediaRows.map(async (row) => {
      if (row.type !== "photo") return;
      try {
        const { data } = await admin.storage
          .from("inspection-media")
          .createSignedUrl(row.storagePath, 3600);
        if (!data?.signedUrl) return;
        const fetched = await fetchImageBytesForPdf(data.signedUrl);
        if (!fetched) return;
        const embedded = fetched.isPng
          ? await doc.embedPng(fetched.bytes)
          : await doc.embedJpg(fetched.bytes);
        results.set(row.id, {
          mediaId: row.id,
          image: embedded,
          width: embedded.width,
          height: embedded.height,
          description: row.description,
        });
      } catch (err) {
        console.error(`Failed to embed job media ${row.id}:`, err);
      }
    }),
  );

  return results;
}

function drawImageGrid(
  doc: PDFDocument,
  cursor: Cursor,
  fonts: Fonts,
  images: EmbeddedImage[],
  opts: { cols?: number; rowHeight?: number; gap?: number } = {},
): Cursor {
  if (images.length === 0) return cursor;
  const cols = opts.cols ?? 2;
  const gap = opts.gap ?? 10;
  const rowHeight = opts.rowHeight ?? 150;
  const cellW = (CONTENT_W - gap * (cols - 1)) / cols;
  let c = cursor;

  for (let i = 0; i < images.length; i += cols) {
    c = ensureSpace(doc, c, rowHeight + 18);
    const rowTopY = c.y;
    for (let j = 0; j < cols; j++) {
      const img = images[i + j];
      if (!img) break;
      const cellX = MARGIN + j * (cellW + gap);
      const cellY = rowTopY - rowHeight;

      // Background card
      c.page.drawRectangle({
        x: cellX,
        y: cellY,
        width: cellW,
        height: rowHeight,
        color: C.cardFill,
        borderColor: C.cardBorder,
        borderWidth: 0.5,
      });

      // Fit image preserving aspect ratio with inset
      const inset = 6;
      const areaW = cellW - inset * 2;
      const areaH = rowHeight - inset * 2 - 14; // leave 14pt for caption
      const imgAspect = img.width / img.height;
      const areaAspect = areaW / areaH;
      let drawW: number;
      let drawH: number;
      if (imgAspect > areaAspect) {
        drawW = areaW;
        drawH = areaW / imgAspect;
      } else {
        drawH = areaH;
        drawW = areaH * imgAspect;
      }
      c.page.drawImage(img.image, {
        x: cellX + inset + (areaW - drawW) / 2,
        y: cellY + inset + 14 + (areaH - drawH) / 2,
        width: drawW,
        height: drawH,
      });

      // Caption line
      if (img.description) {
        const truncated = wrapText(img.description, fonts.regular, 8, cellW - inset * 2)[0] ?? "";
        c.page.drawText(truncated, {
          x: cellX + inset,
          y: cellY + inset,
          size: 8,
          font: fonts.regular,
          color: C.muted,
        });
      }
    }
    c.y = rowTopY - rowHeight - gap;
  }
  return c;
}

function buildChecklistSection(
  doc: PDFDocument,
  cursor: Cursor,
  fonts: Fonts,
  items: JobItemRow[],
  imageMap: Map<string, EmbeddedImage>,
  mediaByItem: Map<string, JobMediaRow[]>,
): Cursor {
  let c = drawSectionHeading(doc, cursor, fonts, "Checklist");
  if (items.length === 0) {
    c = drawParagraph(doc, c, fonts, "No checklist items were defined for this job.", {
      font: fonts.italic,
      color: C.muted,
    });
    return c;
  }

  for (const item of items) {
    c = ensureSpace(doc, c, 60);

    // Item title + status chip
    const titleSize = 12;
    c.page.drawText(item.title, {
      x: MARGIN,
      y: c.y - titleSize,
      size: titleSize,
      font: fonts.bold,
      color: C.dark,
    });
    const titleW = fonts.bold.widthOfTextAtSize(item.title, titleSize);
    drawStatusChip(c.page, fonts, MARGIN + titleW + 10, c.y - titleSize + 2, item.status);
    c.y -= titleSize + 4;

    if (item.instructions) {
      c = drawParagraph(doc, c, fonts, item.instructions, {
        size: 9.5,
        font: fonts.italic,
        color: C.muted,
      });
    }

    if (item.note) {
      c = drawParagraph(doc, c, fonts, item.note, { size: 10.5 });
    } else if (item.isRequired) {
      c = drawParagraph(doc, c, fonts, "(No technician note)", {
        size: 9.5,
        font: fonts.italic,
        color: C.muted,
      });
    }

    // Inline photos for this item
    const itemMedia = (mediaByItem.get(item.id) ?? [])
      .map((m) => imageMap.get(m.id))
      .filter((x): x is EmbeddedImage => !!x);
    if (itemMedia.length > 0) {
      c.y -= 4;
      c = drawImageGrid(doc, c, fonts, itemMedia, { cols: 2, rowHeight: 130 });
    }

    c.y -= 10;
    c = drawDivider(c);
  }
  return c;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function buildJobReportPdf(input: JobReportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };

  // Partition media by bucket; filter general by audience visibility.
  const checklistMedia = input.media.filter((m) => m.bucket === "checklist_item");
  const generalMediaAll = input.media.filter((m) => m.bucket === "general");
  const generalMedia =
    input.audience === "customer"
      ? generalMediaAll.filter((m) => m.visibleToCustomer)
      : generalMediaAll;

  // Embed every image we need up front
  const imageMap = await embedAllImages(doc, [...checklistMedia, ...generalMedia]);

  // Map checklist media by item
  const mediaByItem = new Map<string, JobMediaRow[]>();
  for (const m of checklistMedia) {
    if (!m.checklistItemId) continue;
    const arr = mediaByItem.get(m.checklistItemId) ?? [];
    arr.push(m);
    mediaByItem.set(m.checklistItemId, arr);
  }

  // Page 1 = cover
  buildCoverPage(doc, fonts, input);

  // Page 2+ = content
  let cursor = newPage(doc);
  cursor = buildJobInfoSection(doc, cursor, fonts, input);

  cursor = buildChecklistSection(doc, cursor, fonts, input.items, imageMap, mediaByItem);

  if (input.job.generalNotes?.trim()) {
    cursor = drawSectionHeading(doc, cursor, fonts, "General Notes");
    cursor = drawParagraph(doc, cursor, fonts, input.job.generalNotes);
    cursor.y -= 6;
  }

  if (input.job.customerSummary?.trim()) {
    cursor = drawSectionHeading(doc, cursor, fonts, "Customer Summary");
    cursor = drawParagraph(doc, cursor, fonts, input.job.customerSummary);
    cursor.y -= 6;
  }

  // General photos appendix
  const generalImages = generalMedia
    .map((m) => imageMap.get(m.id))
    .filter((x): x is EmbeddedImage => !!x);
  if (generalImages.length > 0) {
    cursor = drawSectionHeading(doc, cursor, fonts, "Additional Photos");
    cursor = drawImageGrid(doc, cursor, fonts, generalImages, { cols: 2, rowHeight: 170 });
  }

  const bytes = await doc.save();
  return new Uint8Array(bytes);
}
