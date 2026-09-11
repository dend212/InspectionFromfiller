/**
 * Page triage for permit extraction (spec §6). We never send a whole 50-page
 * FINAL DA to Claude: pass 1 is the typed cover pages, pass 2 (only when pass 1
 * found no tank capacity and no disposal type) is the next ≤ 20 pages.
 * pdf-lib copies page ranges into a fresh sub-PDF; no text-layer dependency.
 */
import { PDFDocument } from "pdf-lib";
import type { PermitArchive } from "../types";

export const FIRST_PASS_PAGES_ENV = 4;
export const FIRST_PASS_PAGES_EPLPAV = 6;
export const SECOND_PASS_MAX_PAGES = 20;

export interface TriagePlan {
  /** 1-based page numbers for pass 1 */
  first: number[];
  /** 1-based page numbers for pass 2 (empty when there is nothing left) */
  second: number[];
  pageCount: number;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let p = from; p <= to; p++) out.push(p);
  return out;
}

export function planPasses(pageCount: number, archive: PermitArchive): TriagePlan {
  const firstLen = Math.min(pageCount, archive === "edms_eplpav" ? FIRST_PASS_PAGES_EPLPAV : FIRST_PASS_PAGES_ENV);
  const secondLen = Math.min(SECOND_PASS_MAX_PAGES, Math.max(0, pageCount - firstLen));
  return {
    first: range(1, firstLen),
    second: range(firstLen + 1, firstLen + secondLen),
    pageCount,
  };
}

export async function loadPdfDocument(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch (err) {
    throw new Error(`Could not open PDF: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Copies the given 1-based pages of `src` into a new PDF, in the order given. */
export async function buildSubPdf(src: PDFDocument, pageNumbers: number[]): Promise<Uint8Array> {
  const total = src.getPageCount();
  const indices = pageNumbers.map((p) => p - 1).filter((i) => i >= 0 && i < total);
  if (indices.length === 0) throw new Error("buildSubPdf: no valid pages requested");
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  for (const page of pages) out.addPage(page);
  return new Uint8Array(await out.save());
}
