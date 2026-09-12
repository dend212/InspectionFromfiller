import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpload = vi.fn();
const mockCreateSignedUrl = vi.fn();
const mockFrom = vi.fn(() => ({ upload: mockUpload, createSignedUrl: mockCreateSignedUrl }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ storage: { from: mockFrom } })),
}));

import {
  RECORD_SIGNED_URL_TTL_SECONDS,
  getRecordSignedUrl,
  recordStoragePath,
  uploadRecordPdf,
} from "../record-storage";

beforeEach(() => {
  mockUpload.mockReset();
  mockCreateSignedUrl.mockReset();
  mockFrom.mockClear();
});

describe("recordStoragePath", () => {
  it("nests under records/{inspectionId}/{recordId}.pdf (bucket not included)", () => {
    expect(recordStoragePath("insp-1", "rec-9")).toBe("records/insp-1/rec-9.pdf");
  });
});

describe("uploadRecordPdf", () => {
  it("uploads to the private inspection-media bucket as application/pdf with upsert", async () => {
    mockUpload.mockResolvedValue({ error: null });
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    await uploadRecordPdf("records/insp-1/rec-9.pdf", bytes);
    expect(mockFrom).toHaveBeenCalledWith("inspection-media");
    expect(mockUpload).toHaveBeenCalledWith("records/insp-1/rec-9.pdf", bytes, {
      contentType: "application/pdf",
      upsert: true,
    });
  });

  it("throws with the storage error message", async () => {
    mockUpload.mockResolvedValue({ error: { message: "Bucket not found" } });
    await expect(uploadRecordPdf("records/x/y.pdf", new Uint8Array())).rejects.toThrow(
      "Record upload failed: Bucket not found",
    );
  });
});

describe("getRecordSignedUrl", () => {
  it("defaults to a 600-second inline signed URL", async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed/x.pdf" }, error: null });
    await expect(getRecordSignedUrl("records/insp-1/rec-9.pdf")).resolves.toBe("https://signed/x.pdf");
    expect(RECORD_SIGNED_URL_TTL_SECONDS).toBe(600);
    expect(mockCreateSignedUrl).toHaveBeenCalledWith("records/insp-1/rec-9.pdf", 600);
  });

  it("throws with the storage error message", async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: null, error: { message: "Object not found" } });
    await expect(getRecordSignedUrl("records/x/y.pdf")).rejects.toThrow(
      "Signed URL creation failed: Object not found",
    );
  });
});
