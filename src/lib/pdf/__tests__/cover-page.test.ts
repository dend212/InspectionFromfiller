import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

// ---------------------------------------------------------------------------
// Mock loadPublicFile before importing the module under test.
// vi.mock is hoisted, so we cannot reference top-level variables in the factory.
// Instead we build the PNG inline inside the factory.
// ---------------------------------------------------------------------------

vi.mock("@/lib/pdf/load-public-file", () => {
  // Minimal 1x1 white PNG (inline to avoid hoisting issues)
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return {
    loadPublicFile: vi.fn().mockResolvedValue(
      png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
    ),
  };
});

import { buildCoverPage } from "@/lib/pdf/cover-page";
import { loadPublicFile } from "@/lib/pdf/load-public-file";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildCoverPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set the default mock since clearAllMocks wipes implementations
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
      0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
      0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    vi.mocked(loadPublicFile).mockResolvedValue(
      png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
    );
  });

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

  it("calls loadPublicFile with the logo path", async () => {
    await buildCoverPage();
    expect(loadPublicFile).toHaveBeenCalledWith("/sewertime-logo.png");
  });

  it("throws when logo file loading fails", async () => {
    vi.mocked(loadPublicFile).mockRejectedValueOnce(new Error("File not found"));
    await expect(buildCoverPage()).rejects.toThrow("File not found");
  });

  it("produces a PDF with non-trivial size (has content)", async () => {
    const result = await buildCoverPage();
    // A blank page PDF is ~500 bytes; a cover page with logo, text, etc. should be larger
    expect(result.length).toBeGreaterThan(500);
  });
});
