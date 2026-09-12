import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildSubPdf, loadPdfDocument, planPasses } from "@/lib/prefill/permits/triage";

/** A PDF whose page N is (100+N) points wide so we can tell pages apart after copying */
async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pages; i++) doc.addPage([100 + i, 200]);
  return new Uint8Array(await doc.save());
}

describe("planPasses", () => {
  it("uses pages 1–4 then the rest for legacy env documents", () => {
    expect(planPasses(7, "edms_env")).toEqual({ first: [1, 2, 3, 4], second: [5, 6, 7], pageCount: 7 });
  });

  it("uses pages 1–6 for ePLPAV documents and caps the second pass at 20 pages", () => {
    const plan = planPasses(54, "edms_eplpav");
    expect(plan.first).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plan.second[0]).toBe(7);
    expect(plan.second).toHaveLength(20);
    expect(plan.second[19]).toBe(26);
  });

  it("has an empty second pass for short documents", () => {
    expect(planPasses(3, "edms_env")).toEqual({ first: [1, 2, 3], second: [], pageCount: 3 });
    expect(planPasses(4, "edms_env").second).toEqual([]);
  });
});

describe("buildSubPdf", () => {
  it("copies exactly the requested 1-based pages in order", async () => {
    const doc = await loadPdfDocument(await makePdf(7));
    expect(doc.getPageCount()).toBe(7);
    const sub = await PDFDocument.load(await buildSubPdf(doc, [5, 6, 7]));
    expect(sub.getPageCount()).toBe(3);
    expect(sub.getPage(0).getWidth()).toBe(105);
    expect(sub.getPage(2).getWidth()).toBe(107);
  });

  it("ignores out-of-range pages and throws when nothing is left", async () => {
    const doc = await loadPdfDocument(await makePdf(2));
    const sub = await PDFDocument.load(await buildSubPdf(doc, [1, 9]));
    expect(sub.getPageCount()).toBe(1);
    await expect(buildSubPdf(doc, [9])).rejects.toThrow(/no valid pages/);
  });

  it("rejects bytes that are not a PDF with a readable message", async () => {
    await expect(loadPdfDocument(new Uint8Array([1, 2, 3]))).rejects.toThrow(/Could not open PDF/);
  });
});
