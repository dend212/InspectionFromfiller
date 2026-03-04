import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { mergeGeneratedPdfs } from "@/lib/pdf/merge-pdf";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([612, 792]);
  }
  const bytes = await doc.save();
  return new Uint8Array(bytes);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mergeGeneratedPdfs", () => {
  it("merges cover and form PDFs when no comments or photos", async () => {
    const cover = await createTestPdf(1);
    const form = await createTestPdf(6);

    const result = await mergeGeneratedPdfs(cover, form, null, null);
    expect(result).toBeInstanceOf(Uint8Array);

    const doc = await PDFDocument.load(result);
    expect(doc.getPageCount()).toBe(7); // 1 cover + 6 form
  });

  it("merges cover + form + comments", async () => {
    const cover = await createTestPdf(1);
    const form = await createTestPdf(6);
    const comments = await createTestPdf(1);

    const result = await mergeGeneratedPdfs(cover, form, comments, null);
    const doc = await PDFDocument.load(result);
    expect(doc.getPageCount()).toBe(8); // 1 + 6 + 1
  });

  it("merges cover + form + photos", async () => {
    const cover = await createTestPdf(1);
    const form = await createTestPdf(6);
    const photos = await createTestPdf(3);

    const result = await mergeGeneratedPdfs(cover, form, null, photos);
    const doc = await PDFDocument.load(result);
    expect(doc.getPageCount()).toBe(10); // 1 + 6 + 3
  });

  it("merges all four PDFs in correct order", async () => {
    const cover = await createTestPdf(1);
    const form = await createTestPdf(6);
    const comments = await createTestPdf(1);
    const photos = await createTestPdf(2);

    const result = await mergeGeneratedPdfs(cover, form, comments, photos);
    const doc = await PDFDocument.load(result);
    expect(doc.getPageCount()).toBe(10); // 1 + 6 + 1 + 2
  });

  it("produces valid PDF output", async () => {
    const cover = await createTestPdf(1);
    const form = await createTestPdf(6);

    const result = await mergeGeneratedPdfs(cover, form, null, null);

    // Should start with %PDF header
    expect(result[0]).toBe(0x25); // %
    expect(result[1]).toBe(0x50); // P
    expect(result[2]).toBe(0x44); // D
    expect(result[3]).toBe(0x46); // F
  });

  it("preserves page dimensions from source PDFs", async () => {
    // Create cover with different dimensions
    const coverDoc = await PDFDocument.create();
    coverDoc.addPage([612, 792]);
    const cover = new Uint8Array(await coverDoc.save());

    // Form with standard letter
    const form = await createTestPdf(1);

    const result = await mergeGeneratedPdfs(cover, form, null, null);
    const doc = await PDFDocument.load(result);

    const coverPage = doc.getPage(0);
    expect(coverPage.getSize().width).toBe(612);
    expect(coverPage.getSize().height).toBe(792);
  });

  it("handles multi-page comments PDF", async () => {
    const cover = await createTestPdf(1);
    const form = await createTestPdf(6);
    const comments = await createTestPdf(3); // Overflow with many sections

    const result = await mergeGeneratedPdfs(cover, form, comments, null);
    const doc = await PDFDocument.load(result);
    expect(doc.getPageCount()).toBe(10); // 1 + 6 + 3
  });

  it("handles large photo PDF", async () => {
    const cover = await createTestPdf(1);
    const form = await createTestPdf(6);
    const photos = await createTestPdf(20); // Many photos

    const result = await mergeGeneratedPdfs(cover, form, null, photos);
    const doc = await PDFDocument.load(result);
    expect(doc.getPageCount()).toBe(27); // 1 + 6 + 20
  });

  it("throws on corrupted cover PDF", async () => {
    const badCover = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const form = await createTestPdf(6);

    await expect(
      mergeGeneratedPdfs(badCover, form, null, null),
    ).rejects.toThrow();
  });

  it("throws on corrupted form PDF", async () => {
    const cover = await createTestPdf(1);
    const badForm = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

    await expect(
      mergeGeneratedPdfs(cover, badForm, null, null),
    ).rejects.toThrow();
  });

  it("throws on corrupted comments PDF", async () => {
    const cover = await createTestPdf(1);
    const form = await createTestPdf(6);
    const badComments = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

    await expect(
      mergeGeneratedPdfs(cover, form, badComments, null),
    ).rejects.toThrow();
  });

  it("throws on corrupted photos PDF", async () => {
    const cover = await createTestPdf(1);
    const form = await createTestPdf(6);
    const badPhotos = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

    await expect(
      mergeGeneratedPdfs(cover, form, null, badPhotos),
    ).rejects.toThrow();
  });

  it("returns Uint8Array type", async () => {
    const cover = await createTestPdf(1);
    const form = await createTestPdf(1);

    const result = await mergeGeneratedPdfs(cover, form, null, null);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("page ordering: cover first, then form, then comments, then photos", async () => {
    // Create PDFs with different page sizes to verify ordering
    const coverDoc = await PDFDocument.create();
    coverDoc.addPage([100, 100]); // Distinctive size
    const cover = new Uint8Array(await coverDoc.save());

    const formDoc = await PDFDocument.create();
    formDoc.addPage([200, 200]);
    const form = new Uint8Array(await formDoc.save());

    const commentsDoc = await PDFDocument.create();
    commentsDoc.addPage([300, 300]);
    const comments = new Uint8Array(await commentsDoc.save());

    const photosDoc = await PDFDocument.create();
    photosDoc.addPage([400, 400]);
    const photos = new Uint8Array(await photosDoc.save());

    const result = await mergeGeneratedPdfs(cover, form, comments, photos);
    const doc = await PDFDocument.load(result);

    expect(doc.getPageCount()).toBe(4);
    expect(doc.getPage(0).getSize().width).toBe(100); // cover
    expect(doc.getPage(1).getSize().width).toBe(200); // form
    expect(doc.getPage(2).getSize().width).toBe(300); // comments
    expect(doc.getPage(3).getSize().width).toBe(400); // photos
  });
});
