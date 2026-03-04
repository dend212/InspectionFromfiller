import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { UseFormScanReturn } from "@/hooks/use-form-scan";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/components/inspection/scan-upload-zone", () => ({
  ScanUploadZone: () => <div data-testid="scan-upload-zone">Upload Zone</div>,
}));

vi.mock("@/lib/constants/inspection", () => ({
  STEP_LABELS: [
    "Facility Info",
    "General Treatment",
    "Design Flow",
    "Septic Tank",
    "Disposal Works",
  ],
}));

import { ScanReviewModal } from "@/components/inspection/scan-review-modal";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeScan(overrides: Partial<UseFormScanReturn> = {}): UseFormScanReturn {
  return {
    state: "idle",
    setState: vi.fn(),
    uploadedImages: [],
    scanResult: null,
    selectedFields: new Set(),
    error: null,
    addUploadedImage: vi.fn(),
    removeUploadedImage: vi.fn(),
    startScan: vi.fn(),
    toggleField: vi.fn(),
    selectAllHighConfidence: vi.fn(),
    clearAllSelections: vi.fn(),
    applyFields: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

function makeMockForm() {
  return {
    setValue: vi.fn(),
    getValues: vi.fn(),
    control: {},
  } as any;
}

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  inspectionId: "insp-1",
  form: makeMockForm(),
};

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("ScanReviewModal", () => {
  describe("upload state", () => {
    it("renders upload zone in idle state", () => {
      render(<ScanReviewModal {...defaultProps} scan={makeScan({ state: "uploading" })} />);

      expect(screen.getByTestId("scan-upload-zone")).toBeInTheDocument();
    });

    it("renders scan description for upload state", () => {
      render(<ScanReviewModal {...defaultProps} scan={makeScan({ state: "uploading" })} />);

      expect(
        screen.getByText(/upload photos of your completed paper form/i),
      ).toBeInTheDocument();
    });

    it("renders Start Scan button", () => {
      render(
        <ScanReviewModal
          {...defaultProps}
          scan={makeScan({
            state: "uploading",
            uploadedImages: [{ storagePath: "p", previewUrl: "p", fileName: "p" }],
          })}
        />,
      );

      expect(screen.getByText(/start scan/i)).toBeInTheDocument();
    });

    it("disables Start Scan when no images uploaded", () => {
      render(
        <ScanReviewModal
          {...defaultProps}
          scan={makeScan({ state: "uploading", uploadedImages: [] })}
        />,
      );

      const startButton = screen.getByRole("button", { name: /start scan/i });
      expect(startButton).toBeDisabled();
    });

    it("shows error message when present", () => {
      render(
        <ScanReviewModal
          {...defaultProps}
          scan={makeScan({ state: "uploading", error: "Upload at least one image" })}
        />,
      );

      expect(screen.getByText("Upload at least one image")).toBeInTheDocument();
    });

    it("renders Cancel button", () => {
      render(<ScanReviewModal {...defaultProps} scan={makeScan({ state: "uploading" })} />);

      expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    });
  });

  describe("scanning state", () => {
    it("shows loading spinner and analyzing text", () => {
      render(
        <ScanReviewModal
          {...defaultProps}
          scan={makeScan({
            state: "scanning",
            uploadedImages: [{ storagePath: "p", previewUrl: "p", fileName: "p" }],
          })}
        />,
      );

      // The "Analyzing" text may appear both in the description and body
      const analyzingElements = screen.getAllByText(/analyzing/i);
      expect(analyzingElements.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/10-30 seconds/i)).toBeInTheDocument();
    });
  });

  describe("reviewing state", () => {
    const scanResult = {
      fields: [
        {
          fieldPath: "facilityInfo.facilityName",
          value: "Test Property",
          confidence: 0.95,
          source: "Page 1",
        },
        {
          fieldPath: "facilityInfo.facilityAddress",
          value: "123 Main St",
          confidence: 0.4,
          source: "Page 1",
        },
      ],
      metadata: {
        pagesProcessed: 1,
        totalFieldsExtracted: 2,
        processingTimeMs: 1500,
      },
    };

    it("shows field count description", () => {
      render(
        <ScanReviewModal
          {...defaultProps}
          scan={makeScan({
            state: "reviewing",
            scanResult,
            selectedFields: new Set(["facilityInfo.facilityName"]),
          })}
        />,
      );

      expect(screen.getByText(/2 fields extracted/i)).toBeInTheDocument();
    });

    it("shows selection summary", () => {
      render(
        <ScanReviewModal
          {...defaultProps}
          scan={makeScan({
            state: "reviewing",
            scanResult,
            selectedFields: new Set(["facilityInfo.facilityName"]),
          })}
        />,
      );

      expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();
    });

    it("renders field values", () => {
      render(
        <ScanReviewModal
          {...defaultProps}
          scan={makeScan({
            state: "reviewing",
            scanResult,
            selectedFields: new Set(["facilityInfo.facilityName"]),
          })}
        />,
      );

      expect(screen.getByText("Test Property")).toBeInTheDocument();
      expect(screen.getByText("123 Main St")).toBeInTheDocument();
    });

    it("renders Select High Confidence and Clear All buttons", () => {
      render(
        <ScanReviewModal
          {...defaultProps}
          scan={makeScan({
            state: "reviewing",
            scanResult,
            selectedFields: new Set(),
          })}
        />,
      );

      expect(
        screen.getByRole("button", { name: /select high confidence/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /clear all/i }),
      ).toBeInTheDocument();
    });

    it("renders Apply button with count", () => {
      render(
        <ScanReviewModal
          {...defaultProps}
          scan={makeScan({
            state: "reviewing",
            scanResult,
            selectedFields: new Set(["facilityInfo.facilityName"]),
          })}
        />,
      );

      expect(
        screen.getByRole("button", { name: /apply 1 field/i }),
      ).toBeInTheDocument();
    });

    it("disables Apply button when no fields selected", () => {
      render(
        <ScanReviewModal
          {...defaultProps}
          scan={makeScan({
            state: "reviewing",
            scanResult,
            selectedFields: new Set(),
          })}
        />,
      );

      expect(
        screen.getByRole("button", { name: /apply 0 fields/i }),
      ).toBeDisabled();
    });

    it("shows processing info", () => {
      render(
        <ScanReviewModal
          {...defaultProps}
          scan={makeScan({
            state: "reviewing",
            scanResult,
            selectedFields: new Set(),
          })}
        />,
      );

      expect(screen.getByText(/processed 1 page/i)).toBeInTheDocument();
      expect(screen.getByText(/1\.5s/)).toBeInTheDocument();
    });

    it("calls selectAllHighConfidence when button clicked", async () => {
      const selectAll = vi.fn();
      const user = userEvent.setup();

      render(
        <ScanReviewModal
          {...defaultProps}
          scan={makeScan({
            state: "reviewing",
            scanResult,
            selectedFields: new Set(),
            selectAllHighConfidence: selectAll,
          })}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /select high confidence/i }),
      );

      expect(selectAll).toHaveBeenCalled();
    });

    it("calls clearAllSelections when Clear All clicked", async () => {
      const clearAll = vi.fn();
      const user = userEvent.setup();

      render(
        <ScanReviewModal
          {...defaultProps}
          scan={makeScan({
            state: "reviewing",
            scanResult,
            selectedFields: new Set(["facilityInfo.facilityName"]),
            clearAllSelections: clearAll,
          })}
        />,
      );

      await user.click(screen.getByRole("button", { name: /clear all/i }));

      expect(clearAll).toHaveBeenCalled();
    });

    it("calls applyFields and closes when Apply is clicked", async () => {
      const applyFields = vi.fn();
      const onOpenChange = vi.fn();
      const user = userEvent.setup();

      render(
        <ScanReviewModal
          {...defaultProps}
          onOpenChange={onOpenChange}
          scan={makeScan({
            state: "reviewing",
            scanResult,
            selectedFields: new Set(["facilityInfo.facilityName"]),
            applyFields,
          })}
        />,
      );

      await user.click(screen.getByRole("button", { name: /apply 1 field/i }));

      expect(applyFields).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe("closed state", () => {
    it("does not render content when closed", () => {
      render(
        <ScanReviewModal {...defaultProps} open={false} scan={makeScan()} />,
      );

      expect(screen.queryByText("Scan Paper Form")).not.toBeInTheDocument();
    });
  });
});
