import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockSetState = vi.fn();
const mockReset = vi.fn();

vi.mock("@/hooks/use-form-scan", () => ({
  useFormScan: () => ({
    state: "idle",
    setState: mockSetState,
    reset: mockReset,
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
  }),
}));

// Mock the ScanReviewModal to avoid complex rendering
vi.mock("@/components/inspection/scan-review-modal", () => ({
  ScanReviewModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="scan-review-modal">Modal Open</div> : null,
}));

import { ScanFormButton } from "@/components/inspection/scan-form-button";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMockForm() {
  return {
    setValue: vi.fn(),
    getValues: vi.fn(),
    control: {},
  } as any;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  mockSetState.mockClear();
  mockReset.mockClear();
});

describe("ScanFormButton", () => {
  describe("rendering", () => {
    it("renders without crashing", () => {
      render(<ScanFormButton inspectionId="insp-1" form={makeMockForm()} />);
      expect(
        screen.getByRole("button", { name: /scan paper form/i }),
      ).toBeInTheDocument();
    });

    it("renders button with correct text", () => {
      render(<ScanFormButton inspectionId="insp-1" form={makeMockForm()} />);
      expect(screen.getByText("Scan Paper Form")).toBeInTheDocument();
    });
  });

  describe("opening the modal", () => {
    it("opens scan review modal on click", async () => {
      const user = userEvent.setup();
      render(<ScanFormButton inspectionId="insp-1" form={makeMockForm()} />);

      await user.click(screen.getByRole("button", { name: /scan paper form/i }));

      expect(screen.getByTestId("scan-review-modal")).toBeInTheDocument();
    });

    it("sets state to uploading when opening", async () => {
      const user = userEvent.setup();
      render(<ScanFormButton inspectionId="insp-1" form={makeMockForm()} />);

      await user.click(screen.getByRole("button", { name: /scan paper form/i }));

      expect(mockSetState).toHaveBeenCalledWith("uploading");
    });
  });

  describe("button attributes", () => {
    it("has type=button to prevent form submission", () => {
      render(<ScanFormButton inspectionId="insp-1" form={makeMockForm()} />);

      expect(screen.getByRole("button", { name: /scan paper form/i })).toHaveAttribute(
        "type",
        "button",
      );
    });
  });
});
