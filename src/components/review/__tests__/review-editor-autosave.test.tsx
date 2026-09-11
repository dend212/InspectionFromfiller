import { act, fireEvent, render, screen } from "@testing-library/react";
import { useFormContext } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Integration test: the REAL useAutoSave hook mounted by the review shell.
// Pins Important #1 of the final review — opening the page must not PATCH.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Step stubs register one real RHF field so a change flows through useWatch
function stepStub(index: number, fieldPath: "facilityInfo.facilityName" | "designFlow.designFlowComments") {
  return ({ readOnly }: { inspectionId: string; readOnly?: boolean }) => {
    const form = useFormContext();
    return (
      <fieldset disabled={readOnly} data-testid={`step-${index}`}>
        <input aria-label={fieldPath} {...form.register(fieldPath)} />
      </fieldset>
    );
  };
}
function empty(index: number) {
  return () => <fieldset data-testid={`step-${index}`} />;
}
vi.mock("@/components/inspection/step-facility-info", () => ({
  StepFacilityInfo: stepStub(0, "facilityInfo.facilityName"),
}));
vi.mock("@/components/inspection/step-general-treatment", () => ({ StepGeneralTreatment: empty(1) }));
vi.mock("@/components/inspection/step-design-flow", () => ({ StepDesignFlow: empty(2) }));
vi.mock("@/components/inspection/step-septic-tank", () => ({ StepSepticTank: empty(3) }));
vi.mock("@/components/inspection/step-disposal-works", () => ({ StepDisposalWorks: empty(4) }));
vi.mock("@/components/inspection/step-alternative-system", () => ({ StepAlternativeSystem: empty(5) }));

vi.mock("@/components/review/review-actions", () => ({
  ReviewActions: ({ status }: { status: string }) => <div data-testid="review-actions" data-status={status} />,
}));
vi.mock("@/hooks/use-pdf-generation", () => ({
  usePdfGeneration: () => ({
    generatePdf: vi.fn(),
    pdfData: null,
    isGenerating: false,
    error: null,
    clearPdf: vi.fn(),
  }),
}));

import { ReviewEditor } from "@/components/review/review-editor";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

function makeInspection(status = "in_review") {
  const formData = getDefaultFormValues("Dan Endres") as unknown as InspectionFormData;
  formData.facilityInfo.facilityName = "Smith Residence";
  return {
    id: "insp-1",
    status,
    formData,
    facilityName: "Smith Residence",
    facilityAddress: "123 Main St",
    customerEmail: null,
    isFromWorkiz: false,
  };
}

const patchCalls = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([url, init]) => url === "/api/inspections/insp-1" && init?.method === "PATCH");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ReviewEditor autosave (real hook)", () => {
  it("does not PATCH after opening an in_review page, then PATCHes once after an edit", async () => {
    render(<ReviewEditor inspection={makeInspection()} media={[]} />);

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(patchCalls()).toHaveLength(0);

    // Expand Facility Info and edit the registered field
    fireEvent.click(screen.getByText("Facility Info"));
    fireEvent.input(screen.getByLabelText("facilityInfo.facilityName"), {
      target: { value: "Jones Residence" },
    });
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(patchCalls()).toHaveLength(1);
    const body = JSON.parse(patchCalls()[0][1]!.body as string);
    expect(body.facilityInfo.facilityName).toBe("Jones Residence");

    // Settled: no further PATCH without another edit
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(patchCalls()).toHaveLength(1);
  });

  it("sent: no PATCH is ever sent and the steps are disabled", async () => {
    render(<ReviewEditor inspection={makeInspection("sent")} media={[]} />);
    fireEvent.click(screen.getByText("Facility Info"));
    expect(document.querySelector("fieldset[disabled]")).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(patchCalls()).toHaveLength(0);
  });
});
