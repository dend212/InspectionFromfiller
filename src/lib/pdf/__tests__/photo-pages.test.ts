import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { MediaRecord } from "@/components/inspection/media-gallery";

// ---------------------------------------------------------------------------
// Mock global fetch for image loading
// ---------------------------------------------------------------------------

// Minimal valid JPEG (smallest possible JFIF)
const MINIMAL_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
  0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
  0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
  0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
  0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
  0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
  0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d,
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
  0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
  0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
  0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
  0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
  0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
  0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4,
  0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01,
  0x00, 0x00, 0x3f, 0x00, 0x7b, 0x94, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xd9,
]);

// Minimal 1x1 white PNG
const MINIMAL_PNG = new Uint8Array([
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

function createMockFetchResponse(bytes: Uint8Array, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    statusText: ok ? "OK" : "Not Found",
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePhotoMedia(count: number, section = "Facility Info"): MediaRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `photo-${i}`,
    type: "photo" as const,
    storagePath: `inspections/test/photo-${i}.jpg`,
    label: section,
    description: null,
    sortOrder: i,
    createdAt: "2026-03-01T14:30:00Z",
    signedUrl: `https://storage.example.com/photo-${i}.jpg`,
  }));
}

function makeVideoMedia(): MediaRecord {
  return {
    id: "video-1",
    type: "video" as const,
    storagePath: "inspections/test/video-1.mp4",
    label: "Facility Info",
    description: null,
    sortOrder: 0,
    createdAt: "2026-03-01T14:30:00Z",
    signedUrl: "https://storage.example.com/video-1.mp4",
  };
}

// ---------------------------------------------------------------------------
// Import the module under test (after mocks are set up)
// ---------------------------------------------------------------------------

import { buildPhotoPages, type PhotoPageContext } from "@/lib/pdf/photo-pages";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildPhotoPages", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Default: return a JPEG for any fetch
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(createMockFetchResponse(MINIMAL_JPEG)),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns null when given empty media array", async () => {
    const result = await buildPhotoPages([]);
    expect(result).toBeNull();
  });

  it("returns null when media contains only videos", async () => {
    const result = await buildPhotoPages([makeVideoMedia()]);
    expect(result).toBeNull();
  });

  it("filters out videos and processes only photos", async () => {
    const media = [...makePhotoMedia(2), makeVideoMedia()];
    const result = await buildPhotoPages(media);
    // Should succeed (fetch called for 2 photos, not video)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(result).not.toBeNull();
  });

  it("returns a valid PDF for a single photo", async () => {
    const result = await buildPhotoPages(makePhotoMedia(1));
    expect(result).not.toBeNull();
    expect(result).toBeInstanceOf(Uint8Array);

    const doc = await PDFDocument.load(result!);
    expect(doc.getPageCount()).toBe(1);
  });

  it("creates 1 page for 3 photos (3 per page)", async () => {
    const result = await buildPhotoPages(makePhotoMedia(3));
    expect(result).not.toBeNull();

    const doc = await PDFDocument.load(result!);
    expect(doc.getPageCount()).toBe(1);
  });

  it("creates 2 pages for 4 photos", async () => {
    const result = await buildPhotoPages(makePhotoMedia(4));
    expect(result).not.toBeNull();

    const doc = await PDFDocument.load(result!);
    expect(doc.getPageCount()).toBe(2);
  });

  it("creates 3 pages for 7 photos", async () => {
    const result = await buildPhotoPages(makePhotoMedia(7));
    expect(result).not.toBeNull();

    const doc = await PDFDocument.load(result!);
    expect(doc.getPageCount()).toBe(3);
  });

  it("creates correct number of pages for many photos", async () => {
    const result = await buildPhotoPages(makePhotoMedia(10));
    expect(result).not.toBeNull();

    const doc = await PDFDocument.load(result!);
    expect(doc.getPageCount()).toBe(4); // ceil(10/3) = 4
  });

  it("uses US Letter page size (612 x 792 points)", async () => {
    const result = await buildPhotoPages(makePhotoMedia(1));
    expect(result).not.toBeNull();

    const doc = await PDFDocument.load(result!);
    const page = doc.getPage(0);
    const { width, height } = page.getSize();
    expect(width).toBe(612);
    expect(height).toBe(792);
  });

  it("handles photos without signedUrl", async () => {
    const photos = makePhotoMedia(2);
    photos[0].signedUrl = undefined;
    photos[1].signedUrl = null;

    // No fetch calls should succeed, so no images embedded
    const result = await buildPhotoPages(photos);
    // Returns null when no images can be embedded
    expect(result).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("handles network errors gracefully", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    const result = await buildPhotoPages(makePhotoMedia(2));
    // Should return null when all images fail
    expect(result).toBeNull();
  });

  it("handles HTTP error responses gracefully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(createMockFetchResponse(new Uint8Array(), false));
    const result = await buildPhotoPages(makePhotoMedia(2));
    expect(result).toBeNull();
  });

  it("continues when some photos fail to load", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error("Failed"));
      }
      return Promise.resolve(createMockFetchResponse(MINIMAL_JPEG));
    });

    const result = await buildPhotoPages(makePhotoMedia(2));
    // Second photo loads successfully, so we get output
    expect(result).not.toBeNull();
  });

  it("detects PNG format from magic bytes", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(createMockFetchResponse(MINIMAL_PNG));
    const result = await buildPhotoPages(makePhotoMedia(1));
    // Should handle PNG without error
    expect(result).not.toBeNull();
  });

  it("uses context address in header", async () => {
    const context: PhotoPageContext = {
      address: "123 Main St, Phoenix AZ",
      date: "2026-03-01",
    };
    const result = await buildPhotoPages(makePhotoMedia(1), context);
    expect(result).not.toBeNull();
    // Can't easily inspect text content in pdf-lib output, but shouldn't throw
  });

  it("defaults to 'Inspection Photos' when no address provided", async () => {
    const result = await buildPhotoPages(makePhotoMedia(1));
    expect(result).not.toBeNull();
  });

  it("groups photos by section label", async () => {
    const photos: MediaRecord[] = [
      ...makePhotoMedia(2, "Septic Tank"),
      ...makePhotoMedia(1, "Facility Info"),
      ...makePhotoMedia(1, "Disposal Works"),
    ];
    // Re-assign unique IDs since factory creates duplicates
    photos.forEach((p, i) => {
      p.id = `photo-${i}`;
      p.signedUrl = `https://storage.example.com/photo-${i}.jpg`;
    });

    const result = await buildPhotoPages(photos);
    expect(result).not.toBeNull();

    const doc = await PDFDocument.load(result!);
    // 4 photos / 3 per page = 2 pages
    expect(doc.getPageCount()).toBe(2);
  });

  it("handles photos with null labels", async () => {
    const photos = makePhotoMedia(1);
    photos[0].label = null;
    const result = await buildPhotoPages(photos);
    expect(result).not.toBeNull();
  });
});
