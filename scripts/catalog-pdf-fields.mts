/**
 * Catalogs all form fields in the new PDF template.
 * Outputs each field's page number, type, name, position, and size.
 * Used to build the rename map for semantic field names.
 */
import { PDFDocument, PDFName, PDFArray, PDFRef, PDFDict } from "pdf-lib";
import fs from "fs";

const pdfBytes = fs.readFileSync("septic_system_insp_26.pdf");
const doc = await PDFDocument.load(pdfBytes);
const form = doc.getForm();
const fields = form.getFields();
const pages = doc.getPages();

// Build a map of page refs to page numbers
const pageRefToNum = new Map<string, number>();
for (let i = 0; i < pages.length; i++) {
  pageRefToNum.set(pages[i].ref.toString(), i + 1);
}

interface FieldInfo {
  name: string;
  type: string;
  page: number | number[] | "unknown";
  x: number;
  y: number;
  width: number;
  height: number;
  options?: string[];
}

const results: FieldInfo[] = [];

for (const field of fields) {
  const name = field.getName();
  const type = field.constructor.name;
  const widgets = field.acroField.getWidgets();

  // Determine page(s) for this field
  const fieldPages: number[] = [];
  let x = 0, y = 0, width = 0, height = 0;

  for (const widget of widgets) {
    // Get page reference from widget's /P entry
    const pageRef = widget.P();
    if (pageRef) {
      const refStr = pageRef.toString();
      const pageNum = pageRefToNum.get(refStr);
      if (pageNum && !fieldPages.includes(pageNum)) {
        fieldPages.push(pageNum);
      }
    }

    // Get position from first widget
    if (fieldPages.length <= 1) {
      const rect = widget.getRectangle();
      x = Math.round(rect.x);
      y = Math.round(rect.y);
      width = Math.round(rect.width);
      height = Math.round(rect.height);
    }
  }

  // For radio groups, get the option values
  let options: string[] | undefined;
  if (type === "PDFRadioGroup") {
    try {
      const radioGroup = form.getRadioGroup(name);
      options = radioGroup.getOptions();
    } catch {
      options = ["(error reading options)"];
    }
  }

  const page = fieldPages.length === 0
    ? "unknown"
    : fieldPages.length === 1
    ? fieldPages[0]
    : fieldPages;

  results.push({ name, type, page, x, y, width, height, ...(options ? { options } : {}) });
}

// Sort by page, then by y descending (top of page first in PDF coords), then x
results.sort((a, b) => {
  const pageA = Array.isArray(a.page) ? a.page[0] : (a.page === "unknown" ? 999 : a.page);
  const pageB = Array.isArray(b.page) ? b.page[0] : (b.page === "unknown" ? 999 : b.page);
  if (pageA !== pageB) return pageA - pageB;
  if (b.y !== a.y) return b.y - a.y; // Higher y = higher on page
  return a.x - b.x;
});

// Output as JSON
const output = JSON.stringify(results, null, 2);
fs.writeFileSync("scripts/field-catalog.json", output);
console.log(`Cataloged ${results.length} fields. Saved to scripts/field-catalog.json`);

// Also output a readable summary grouped by page
let summary = "";
let currentPage: number | string = -1;
for (const f of results) {
  const pg = Array.isArray(f.page) ? `Pages ${f.page.join(",")}` : `Page ${f.page}`;
  const pgKey = JSON.stringify(f.page);
  if (pgKey !== JSON.stringify(currentPage)) {
    currentPage = f.page as number;
    summary += `\n=== ${pg} ===\n`;
  }
  const typeShort = f.type.replace("PDF", "");
  const optStr = f.options ? ` [${f.options.join(", ")}]` : "";
  summary += `  ${typeShort.padEnd(12)} ${f.name.padEnd(55)} (${f.x}, ${f.y}) ${f.width}x${f.height}${optStr}\n`;
}

fs.writeFileSync("scripts/field-catalog.txt", summary);
console.log("Readable summary saved to scripts/field-catalog.txt");
