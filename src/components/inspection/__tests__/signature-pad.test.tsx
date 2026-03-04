import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockClear = vi.fn();
const mockIsEmpty = vi.fn().mockReturnValue(true);
const mockGetTrimmedCanvas = vi.fn().mockReturnValue({
  toDataURL: () => "data:image/png;base64,abc123",
});

vi.mock("react-signature-canvas", () => ({
  default: vi.fn().mockImplementation(({ onEnd, ref: _ref, ...props }: any) => {
    // We return a div that simulates the canvas
    return <div data-testid="signature-canvas" {...props.canvasProps} />;
  }),
}));

import { SignaturePad } from "@/components/inspection/signature-pad";

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  mockClear.mockClear();
  mockIsEmpty.mockReturnValue(true);
});

describe("SignaturePad", () => {
  describe("rendering", () => {
    it("renders without crashing", () => {
      render(<SignaturePad onSignatureCapture={vi.fn()} />);
      expect(screen.getByText("Inspector Signature")).toBeInTheDocument();
    });

    it("renders the label", () => {
      render(<SignaturePad onSignatureCapture={vi.fn()} />);
      expect(screen.getByText("Inspector Signature")).toBeInTheDocument();
    });

    it("renders helper text when empty", () => {
      render(<SignaturePad onSignatureCapture={vi.fn()} />);
      expect(
        screen.getByText("Sign above using finger or stylus"),
      ).toBeInTheDocument();
    });

    it("renders Clear button", () => {
      render(<SignaturePad onSignatureCapture={vi.fn()} />);
      expect(
        screen.getByRole("button", { name: /clear/i }),
      ).toBeInTheDocument();
    });

    it("disables Clear button when empty", () => {
      render(<SignaturePad onSignatureCapture={vi.fn()} />);
      expect(screen.getByRole("button", { name: /clear/i })).toBeDisabled();
    });
  });

  describe("button attributes", () => {
    it("Clear button has type=button", () => {
      render(<SignaturePad onSignatureCapture={vi.fn()} />);
      expect(screen.getByRole("button", { name: /clear/i })).toHaveAttribute(
        "type",
        "button",
      );
    });
  });
});
