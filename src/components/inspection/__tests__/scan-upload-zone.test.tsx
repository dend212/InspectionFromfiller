import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { toast } from "sonner";
import { ScanUploadZone } from "@/components/inspection/scan-upload-zone";

// ── Helpers ────────────────────────────────────────────────────────────────────

const defaultProps = {
  inspectionId: "insp-1",
  uploadedImages: [] as any[],
  onUploadComplete: vi.fn(),
  onRemoveImage: vi.fn(),
};

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("ScanUploadZone", () => {
  describe("rendering", () => {
    it("renders without crashing", () => {
      render(<ScanUploadZone {...defaultProps} />);
      expect(
        screen.getByText(/upload photos of your paper inspection form/i),
      ).toBeInTheDocument();
    });

    it("renders Take Photo and Browse buttons", () => {
      render(<ScanUploadZone {...defaultProps} />);
      expect(screen.getByText("Take Photo")).toBeInTheDocument();
      expect(screen.getByText("Browse")).toBeInTheDocument();
    });

    it("renders instruction text", () => {
      render(<ScanUploadZone {...defaultProps} />);
      expect(screen.getByText(/upload 1-10 photos/i)).toBeInTheDocument();
    });

    it("has drop zone with accessible label", () => {
      render(<ScanUploadZone {...defaultProps} />);
      expect(
        screen.getByLabelText(/drop zone for form scan images/i),
      ).toBeInTheDocument();
    });
  });

  describe("with uploaded images", () => {
    const images = [
      {
        storagePath: "images/scan-1.jpg",
        previewUrl: "blob:1",
        fileName: "scan-1.jpg",
      },
      {
        storagePath: "images/scan-2.jpg",
        previewUrl: "blob:2",
        fileName: "scan-2.jpg",
      },
    ];

    it("renders image thumbnails", () => {
      render(<ScanUploadZone {...defaultProps} uploadedImages={images} />);

      expect(screen.getByAltText("Scan page 1")).toBeInTheDocument();
      expect(screen.getByAltText("Scan page 2")).toBeInTheDocument();
    });

    it("renders page numbers", () => {
      render(<ScanUploadZone {...defaultProps} uploadedImages={images} />);

      expect(screen.getByText("Page 1")).toBeInTheDocument();
      expect(screen.getByText("Page 2")).toBeInTheDocument();
    });

    it("changes text to 'Add more pages' when images exist", () => {
      render(<ScanUploadZone {...defaultProps} uploadedImages={images} />);

      expect(screen.getByText("Add more pages")).toBeInTheDocument();
    });
  });

  describe("disabled state", () => {
    it("applies disabled styling when disabled", () => {
      render(<ScanUploadZone {...defaultProps} disabled={true} />);

      const dropZone = screen.getByLabelText(/drop zone/i);
      expect(dropZone.className).toContain("pointer-events-none");
    });
  });

  describe("file validation", () => {
    it("rejects non-image files via the upload callback", async () => {
      vi.stubGlobal("fetch", vi.fn());

      render(<ScanUploadZone {...defaultProps} />);

      // Create a non-image file
      const file = new File(["content"], "doc.txt", { type: "text/plain" });

      // Get the file input (hidden) - the browse input is the one with multiple attribute
      const browseInput = document.querySelector(
        'input[type="file"][multiple]',
      ) as HTMLInputElement;

      // Simulate file change event directly since userEvent.upload may not work with hidden inputs
      Object.defineProperty(browseInput, "files", {
        value: [file],
        writable: false,
      });
      browseInput.dispatchEvent(new Event("change", { bubbles: true }));

      // Give the async handler time to run
      await new Promise((r) => setTimeout(r, 50));

      expect(toast.error).toHaveBeenCalledWith("Only image files are accepted");
    });
  });
});
