import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the admin client before importing the module
const mockUpload = vi.fn();
const mockCreateSignedUrl = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: mockUpload,
        createSignedUrl: mockCreateSignedUrl,
      })),
    },
  })),
}));

import { uploadReport, getReportDownloadUrl, buildDownloadFilename } from "../pdf-storage";

describe("uploadReport", () => {
  beforeEach(() => {
    mockUpload.mockReset();
    mockCreateSignedUrl.mockReset();
  });

  it("uploads PDF and returns storage path", async () => {
    mockUpload.mockResolvedValue({ error: null });

    const pdfData = new Uint8Array([1, 2, 3, 4]);
    const result = await uploadReport("insp-123", pdfData, "report.pdf");

    expect(result).toBe("reports/insp-123/report.pdf");
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload).toHaveBeenCalledWith(
      "reports/insp-123/report.pdf",
      pdfData,
      { contentType: "application/pdf", upsert: true },
    );
  });

  it("throws on upload error", async () => {
    mockUpload.mockResolvedValue({
      error: { message: "Bucket not found" },
    });

    await expect(
      uploadReport("insp-1", new Uint8Array([]), "test.pdf"),
    ).rejects.toThrow("PDF upload failed: Bucket not found");
  });

  it("constructs correct path for different inspection IDs", async () => {
    mockUpload.mockResolvedValue({ error: null });

    const result = await uploadReport(
      "abc-def-123",
      new Uint8Array([5]),
      "final.pdf",
    );
    expect(result).toBe("reports/abc-def-123/final.pdf");
  });
});

describe("getReportDownloadUrl", () => {
  beforeEach(() => {
    mockCreateSignedUrl.mockReset();
  });

  it("returns signed URL", async () => {
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.supabase.co/signed/report.pdf" },
      error: null,
    });

    const url = await getReportDownloadUrl(
      "reports/insp-1/report.pdf",
      "download.pdf",
    );
    expect(url).toBe("https://storage.supabase.co/signed/report.pdf");
    expect(mockCreateSignedUrl).toHaveBeenCalledWith(
      "reports/insp-1/report.pdf",
      3600,
      { download: "download.pdf" },
    );
  });

  it("throws on signed URL error", async () => {
    mockCreateSignedUrl.mockResolvedValue({
      data: null,
      error: { message: "Object not found" },
    });

    await expect(
      getReportDownloadUrl("reports/insp-1/report.pdf", "file.pdf"),
    ).rejects.toThrow("Signed URL creation failed: Object not found");
  });
});

describe("buildDownloadFilename", () => {
  it("builds filename from address and date", () => {
    const date = new Date(2026, 2, 3); // March 3, 2026
    const result = buildDownloadFilename("123 Main St", date);
    expect(result).toBe("123-Main-St_ADEQ_2026-03-03.pdf");
  });

  it("replaces spaces with hyphens", () => {
    const date = new Date(2026, 0, 15);
    const result = buildDownloadFilename("456 Oak Avenue Apt 2", date);
    expect(result).toBe("456-Oak-Avenue-Apt-2_ADEQ_2026-01-15.pdf");
  });

  it("removes special characters", () => {
    const date = new Date(2026, 5, 10);
    const result = buildDownloadFilename("123 Main St. #4B", date);
    expect(result).toBe("123-Main-St-4B_ADEQ_2026-06-10.pdf");
  });

  it("uses 'inspection-report' when address is null", () => {
    const date = new Date(2026, 11, 25);
    const result = buildDownloadFilename(null, date);
    expect(result).toBe("inspection-report_ADEQ_2026-12-25.pdf");
  });

  it("uses 'inspection-report' when address is empty string", () => {
    const date = new Date(2026, 0, 1);
    const result = buildDownloadFilename("", date);
    expect(result).toBe("inspection-report_ADEQ_2026-01-01.pdf");
  });

  it("produces empty prefix when address is just whitespace (truthy but sanitizes to empty)", () => {
    const date = new Date(2026, 0, 1);
    const result = buildDownloadFilename("   ", date);
    // "   " is truthy, so it enters the sanitize path: trim->"", replace spaces->"", remove special chars->""
    // The code doesn't re-check after sanitizing, so we get an empty prefix
    expect(result).toBe("_ADEQ_2026-01-01.pdf");
  });

  it("uses today's date when completedAt is null", () => {
    const result = buildDownloadFilename("Test St", null);
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    expect(result).toBe(`Test-St_ADEQ_${year}-${month}-${day}.pdf`);
  });

  it("pads single-digit months and days", () => {
    const date = new Date(2026, 0, 5); // Jan 5
    const result = buildDownloadFilename("Test", date);
    expect(result).toBe("Test_ADEQ_2026-01-05.pdf");
  });

  it("handles address with only special characters", () => {
    const date = new Date(2026, 0, 1);
    const result = buildDownloadFilename("!@#$%", date);
    // After removing special chars, empty string -> "inspection-report" fallback?
    // Actually: "!@#$%".trim() = "!@#$%", replace spaces=>"!@#$%", remove non-alnum => ""
    // But the ternary checks facilityAddress truthiness, and "!@#$%" is truthy
    // so it goes through the sanitize path, resulting in empty string
    // The code doesn't re-check emptiness after sanitizing, so we get an empty prefix
    expect(result).toBe("_ADEQ_2026-01-01.pdf");
  });

  it("handles address with multiple consecutive spaces", () => {
    const date = new Date(2026, 6, 4);
    const result = buildDownloadFilename("123   Main   St", date);
    expect(result).toBe("123-Main-St_ADEQ_2026-07-04.pdf");
  });

  it("preserves alphanumeric and hyphens in address", () => {
    const date = new Date(2026, 0, 1);
    const result = buildDownloadFilename("123-B Main St", date);
    expect(result).toBe("123-B-Main-St_ADEQ_2026-01-01.pdf");
  });

  it("handles very long addresses", () => {
    const date = new Date(2026, 0, 1);
    const longAddr = "A".repeat(200);
    const result = buildDownloadFilename(longAddr, date);
    expect(result).toBe(`${"A".repeat(200)}_ADEQ_2026-01-01.pdf`);
  });
});
