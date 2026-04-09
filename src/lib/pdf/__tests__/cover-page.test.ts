import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildCoverPage } from "@/lib/pdf/cover-page";
import { getSewertimeLogoBytes } from "@/lib/pdf/sewertime-logo";

// ---------------------------------------------------------------------------
// Tests
//
// The cover page reads the logo from the inlined base64 module
// (sewertime-logo.ts) so no mocking is required — the real logo bytes are
// always available in every runtime.
// ---------------------------------------------------------------------------

describe("buildCoverPage", () => {
  it("returns a Uint8Array", async () => {
    const result = await buildCoverPage();
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("produces a valid PDF document", async () => {
    const result = await buildCoverPage();
    const doc = await PDFDocument.load(result);
    expect(doc).toBeDefined();
  });

  it("creates a single-page PDF", async () => {
    const result = await buildCoverPage();
    const doc = await PDFDocument.load(result);
    expect(doc.getPageCount()).toBe(1);
  });

  it("creates a US Letter-sized page (612 x 792 points)", async () => {
    const result = await buildCoverPage();
    const doc = await PDFDocument.load(result);
    const page = doc.getPage(0);
    const { width, height } = page.getSize();
    expect(width).toBe(612);
    expect(height).toBe(792);
  });

  it("exposes the inlined logo as a non-empty PNG byte array", () => {
    const bytes = getSewertimeLogoBytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    // PNG signature: 89 50 4e 47 0d 0a 1a 0a
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x4e);
    expect(bytes[3]).toBe(0x47);
    // The real logo is 11,477 bytes; allow a wide floor so a future
    // asset swap doesn't fail this test unnecessarily.
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("produces a PDF large enough to contain the embedded logo", async () => {
    const result = await buildCoverPage();
    // A blank PDF is ~500 bytes; with an embedded 11KB PNG plus text,
    // the output should be well above 5KB. This is how we know the logo
    // actually landed in the PDF — pdf-lib would otherwise throw on
    // embedPng failure, but a size assertion catches silent regressions.
    expect(result.length).toBeGreaterThan(5000);
  });
});
