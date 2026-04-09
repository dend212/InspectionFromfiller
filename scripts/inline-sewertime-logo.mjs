#!/usr/bin/env node
// Regenerates src/lib/pdf/sewertime-logo.ts from public/sewertime-logo.png.
//
// The PDF generators (inspection cover page + job report cover page) read
// the logo through this module instead of the filesystem so PDFs stay
// branded in Vercel serverless functions, which don't bundle public/
// files into the Lambda runtime by default.
//
// Usage: node scripts/inline-sewertime-logo.mjs

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logoPath = path.join(repoRoot, "public", "sewertime-logo.png");
const outPath = path.join(repoRoot, "src", "lib", "pdf", "sewertime-logo.ts");

const bytes = readFileSync(logoPath);
const b64 = bytes.toString("base64");
const lines = [];
for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
const body = lines.map((l) => `  "${l}",`).join("\n");

const out = `/**
 * SewerTime Septic logo, inlined as base64 so PDF generation works
 * identically in all runtimes (local dev, Vercel serverless, Edge). The
 * previous filesystem-based loader (loadPublicFile) depended on
 * process.cwd()/public, which Next.js does NOT bundle into serverless
 * functions by default — the logo loaded fine locally but silently
 * failed in production, so generated reports shipped unbranded.
 *
 * Source file: public/sewertime-logo.png (${bytes.length} bytes)
 * To refresh: run \`node scripts/inline-sewertime-logo.mjs\`.
 */

const SEWERTIME_LOGO_BASE64 = [
${body}
].join("");

let cachedBytes: Uint8Array | null = null;

/** Returns the logo as a Uint8Array suitable for pdf-lib's embedPng. */
export function getSewertimeLogoBytes(): Uint8Array {
  if (cachedBytes) return cachedBytes;
  cachedBytes = new Uint8Array(Buffer.from(SEWERTIME_LOGO_BASE64, "base64"));
  return cachedBytes;
}
`;

writeFileSync(outPath, out);
console.log(
  `Wrote ${path.relative(repoRoot, outPath)} (${out.length} chars) from ${bytes.length}-byte PNG.`,
);
