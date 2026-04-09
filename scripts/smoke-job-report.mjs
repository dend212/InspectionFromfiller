#!/usr/bin/env node
// Smoke-test: verify the inlined logo in src/lib/pdf/sewertime-logo.ts
// round-trips through pdf-lib's embedPng and lands on a cover page. Writes
// /tmp/smoke-job-report.pdf for visual inspection.
//
// This catches the exact regression that shipped unbranded PDFs to prod:
// if the inlined base64 is malformed or embedPng fails, this script errors
// out loudly instead of silently producing an unbranded PDF.
//
// Usage: node scripts/smoke-job-report.mjs

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logoModulePath = path.join(repoRoot, "src/lib/pdf/sewertime-logo.ts");

// Parse the base64 out of the TS module without actually importing it. This
// keeps the script pure ESM with zero tsx / ts-node overhead.
const moduleSrc = readFileSync(logoModulePath, "utf8");
const arrayMatch = moduleSrc.match(/const SEWERTIME_LOGO_BASE64 = \[([\s\S]*?)\]\.join\(""\);/);
if (!arrayMatch) {
  console.error("Could not find SEWERTIME_LOGO_BASE64 in", logoModulePath);
  process.exit(1);
}
const b64 = arrayMatch[1]
  .split("\n")
  .map((l) => l.trim().replace(/^"/, "").replace(/",?$/, ""))
  .filter(Boolean)
  .join("");
const logoBytes = Buffer.from(b64, "base64");
console.log(`Decoded logo: ${logoBytes.length} bytes`);

const doc = await PDFDocument.create();
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const regular = await doc.embedFont(StandardFonts.Helvetica);

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const page = doc.addPage([PAGE_W, PAGE_H]);

// Brand accent stripe
page.drawRectangle({
  x: 0,
  y: PAGE_H - 6,
  width: PAGE_W,
  height: 6,
  color: rgb(0.06, 0.34, 0.56),
});

// Embed + draw logo
const logo = await doc.embedPng(new Uint8Array(logoBytes));
const maxW = 260;
const maxH = 90;
const scale = Math.min(maxW / logo.width, maxH / logo.height);
const drawW = logo.width * scale;
const drawH = logo.height * scale;
const logoX = (PAGE_W - drawW) / 2;
const logoY = PAGE_H - 50 - drawH;
page.drawImage(logo, { x: logoX, y: logoY, width: drawW, height: drawH });

// Header label
const headerLabel = "SERVICE VISIT REPORT";
const headerSize = 12;
const headerW = bold.widthOfTextAtSize(headerLabel, headerSize);
page.drawText(headerLabel, {
  x: (PAGE_W - headerW) / 2,
  y: logoY - 30,
  size: headerSize,
  font: bold,
  color: rgb(0.46, 0.5, 0.57),
});

// Thin divider
page.drawLine({
  start: { x: MARGIN, y: logoY - 42 },
  end: { x: PAGE_W - MARGIN, y: logoY - 42 },
  thickness: 0.75,
  color: rgb(0.83, 0.87, 0.91),
});

// Title
page.drawText("Smoke Test Job", {
  x: MARGIN,
  y: logoY - 76,
  size: 28,
  font: bold,
  color: rgb(0.13, 0.16, 0.22),
});

// Bottom company footer — same as job-report/index.ts
const footerY = 70;
page.drawLine({
  start: { x: MARGIN, y: footerY + 38 },
  end: { x: PAGE_W - MARGIN, y: footerY + 38 },
  thickness: 0.5,
  color: rgb(0.83, 0.87, 0.91),
});
const nameW = bold.widthOfTextAtSize("SewerTime Septic", 11);
page.drawText("SewerTime Septic", {
  x: (PAGE_W - nameW) / 2,
  y: footerY + 22,
  size: 11,
  font: bold,
  color: rgb(0.13, 0.16, 0.22),
});
const contactLine = "(602) 777-7867  ·  33645 N Cave Creek Rd, Cave Creek, AZ 85331";
const contactW = regular.widthOfTextAtSize(contactLine, 9);
page.drawText(contactLine, {
  x: (PAGE_W - contactW) / 2,
  y: footerY + 8,
  size: 9,
  font: regular,
  color: rgb(0.46, 0.5, 0.57),
});

const bytes = await doc.save();
writeFileSync("/tmp/smoke-job-report.pdf", bytes);

console.log(`\n✓ PDF written: /tmp/smoke-job-report.pdf (${bytes.length} bytes)`);
console.log(`  Logo dims:   ${logo.width}x${logo.height} -> ${drawW.toFixed(1)}x${drawH.toFixed(1)} pt`);
console.log(`  Logo Y:      ${logoY.toFixed(1)} (page height ${PAGE_H})`);
console.log(`  Footer Y:    ${footerY}`);
console.log(`\nOpen with: open /tmp/smoke-job-report.pdf`);
