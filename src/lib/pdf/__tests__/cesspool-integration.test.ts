/**
 * Integration test for the cesspool red-X feature.
 *
 * Runs the REAL generateReport pipeline against the real ADEQ template, real
 * cover page, and real comments-overflow page (no mocks of those). Only
 * photo-pages is stubbed (it fetches signed URLs + uses sharp, which needs the
 * network). Verifies the void overlay does not change the page count and that
 * the Cesspool comments + photo pages merge in as expected.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { MediaRecord } from "@/components/inspection/media-gallery";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

// jsdom defines `window`, so the real loadPublicFile takes its fetch() branch and
// fails on relative paths. Read the real assets (template + fonts + logo) from
// the public/ dir instead, so the rest of the pipeline runs for real.
vi.mock("@/lib/pdf/load-public-file", () => ({
  loadPublicFile: vi.fn(async (relativePath: string) => {
    const buf = readFileSync(join(process.cwd(), "public", relativePath.replace(/^\//, "")));
    // Fresh, exact-length copy as a standalone Uint8Array (accepted by both
    // pdf-lib and @pdfme); avoids jsdom Buffer/ArrayBuffer pooling quirks.
    return new Uint8Array(buf);
  }),
}));

// Stub photo-pages with a real 1-page PDF so we can confirm photos still merge
// in, without touching the network / sharp.
vi.mock("@/lib/pdf/photo-pages", () => ({
  buildPhotoPages: vi.fn().mockImplementation(async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText("PHOTO APPENDIX (stub)", { x: 60, y: 700, size: 18, color: rgb(0, 0, 0) });
    return new Uint8Array(await doc.save());
  }),
}));

import { generateReport } from "@/lib/pdf/generate-report";

function makeCesspoolData(): InspectionFormData {
  const data = getDefaultFormValues("Daniel Endres") as InspectionFormData;
  data.facilityInfo.facilityName = "123 Cesspool Lane";
  data.facilityInfo.facilityAddress = "123 Cesspool Lane, Cave Creek, AZ";
  data.facilityInfo.dateOfInspection = "06/18/2026";
  data.facilityInfo.isCesspool = "yes";
  data.facilityInfo.cesspoolComments =
    "Property is served by an illegal cesspool with no septic tank or leach field present. " +
    "Effluent discharges directly to a buried pit. System must be abandoned and replaced with " +
    "a conforming on-site wastewater treatment facility prior to property transfer.";
  return data;
}

describe("cesspool report integration (real pipeline)", () => {
  it("produces cover + voided form + Cesspool comments + photos (9 pages)", async () => {
    const media: MediaRecord[] = [
      {
        id: "photo-1",
        type: "photo",
        storagePath: "inspections/test/photo-1.jpg",
        label: "Facility Info",
        description: "Open cesspool pit",
        sortOrder: 0,
        createdAt: "2026-06-18T14:30:00Z",
        signedUrl: "https://example.com/photo-1.jpg",
      },
    ];

    const bytes = await generateReport(makeCesspoolData(), null, media);

    const doc = await PDFDocument.load(bytes);
    // cover(1) + form(6) + comments(1) + photos(1) = 9
    expect(doc.getPageCount()).toBe(9);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("non-cesspool baseline is 7 pages with no comments/photos overlay", async () => {
    const data = getDefaultFormValues("Daniel Endres") as InspectionFormData;
    data.facilityInfo.facilityName = "456 Normal St";
    data.facilityInfo.isCesspool = "no";
    const bytes = await generateReport(data, null);
    const doc = await PDFDocument.load(bytes);
    // cover(1) + form(6) = 7, no comments, no photos
    expect(doc.getPageCount()).toBe(7);
  });
});
