import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportPreview } from "@/components/review/report-preview";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

const generatePdf = vi.fn();
vi.mock("@/hooks/use-pdf-generation", () => ({
  usePdfGeneration: () => ({ generatePdf, pdfData: null, isGenerating: false, error: null, clearPdf: vi.fn() }),
}));

function Harness({ status, readOnly }: { status: string; readOnly: boolean }) {
  const form = useForm<InspectionFormData>({ defaultValues: getDefaultFormValues("Dan") });
  return (
    <ReportPreview inspectionId="insp-1" status={status} form={form} selectedMedia={[]} readOnly={readOnly} />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReportPreview", () => {
  it("in review: offers Regenerate PDF and generates from the current form values", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const user = userEvent.setup();
    render(<Harness status="in_review" readOnly={false} />);

    expect(screen.getByText(/click "regenerate pdf" to preview/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /regenerate pdf/i }));
    expect(generatePdf).toHaveBeenCalledWith(
      expect.objectContaining({ facilityInfo: expect.objectContaining({ inspectorName: "Dan" }) }),
      null,
      [],
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("completed: loads the finalized PDF from the download route and shows it in an iframe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ previewUrl: "https://x.test/preview.pdf", downloadUrl: "https://x.test/dl.pdf" }),
      }),
    );
    render(<Harness status="completed" readOnly />);

    expect(fetch).toHaveBeenCalledWith("/api/inspections/insp-1/download");
    await waitFor(() =>
      expect(screen.getByTitle("Finalized PDF")).toHaveAttribute("src", "https://x.test/preview.pdf"),
    );
    expect(screen.getByRole("link", { name: /download pdf/i })).toHaveAttribute("href", "https://x.test/dl.pdf");
    expect(screen.queryByRole("button", { name: /regenerate pdf/i })).not.toBeInTheDocument();
  });
});
