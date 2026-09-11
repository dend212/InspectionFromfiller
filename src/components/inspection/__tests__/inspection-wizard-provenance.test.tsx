import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProvenanceEntry } from "@/lib/prefill/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/hooks/use-auto-save", () => ({ useAutoSave: () => ({ saving: false, lastSaved: null }) }));

// Step 0 doubles as a probe for the provenance context the wizard provides
vi.mock("@/components/inspection/step-facility-info", async () => {
  const { useProvenance } = await import("@/components/prefill/provenance-context");
  return {
    StepFacilityInfo: () => {
      const { provenance, readOnly } = useProvenance();
      return (
        <div data-testid="step-0" data-readonly={String(readOnly)}>
          {Object.keys(provenance).join(",")}
        </div>
      );
    },
  };
});
vi.mock("@/components/inspection/step-general-treatment", () => ({ StepGeneralTreatment: () => <div /> }));
vi.mock("@/components/inspection/step-design-flow", () => ({ StepDesignFlow: () => <div /> }));
vi.mock("@/components/inspection/step-septic-tank", () => ({ StepSepticTank: () => <div /> }));
vi.mock("@/components/inspection/step-disposal-works", () => ({ StepDisposalWorks: () => <div /> }));
vi.mock("@/components/inspection/step-alternative-system", () => ({ StepAlternativeSystem: () => <div /> }));
vi.mock("@/components/prefill/prefill-panel", () => ({
  PrefillPanel: ({ inspectionId }: { inspectionId: string }) => (
    <div data-testid="prefill-panel">{inspectionId}</div>
  ),
}));

import { InspectionWizard } from "@/components/inspection/inspection-wizard";

const ENTRY: ProvenanceEntry = {
  source: "assessor",
  state: "prefilled",
  kind: "fill",
  value: "JOHN DOE",
  confidence: 1,
  explanation: "Maricopa County Assessor · parcel 219-11-121",
  at: "2026-09-11T10:00:00.000Z",
};

describe("InspectionWizard provenance wiring", () => {
  it("provides the loaded provenance to the steps and renders the prefill panel for drafts", () => {
    render(
      <InspectionWizard
        inspection={{
          id: "insp-1",
          formData: null,
          status: "draft",
          fieldProvenance: { "facilityInfo.facilityName": ENTRY },
          prefillRun: null,
        }}
      />,
    );
    expect(screen.getByTestId("step-0")).toHaveTextContent("facilityInfo.facilityName");
    expect(screen.getByTestId("step-0")).toHaveAttribute("data-readonly", "false");
    expect(screen.getByTestId("prefill-panel")).toHaveTextContent("insp-1");
  });

  it("is read-only and hides the panel on non-drafts", () => {
    render(
      <InspectionWizard
        inspection={{
          id: "insp-1",
          formData: null,
          status: "submitted",
          fieldProvenance: { "facilityInfo.facilityName": ENTRY },
        }}
      />,
    );
    expect(screen.getByTestId("step-0")).toHaveAttribute("data-readonly", "true");
    expect(screen.queryByTestId("prefill-panel")).toBeNull();
  });

  it("defaults to an empty map when no provenance is passed", () => {
    render(<InspectionWizard inspection={{ id: "insp-1", formData: null, status: "draft" }} />);
    expect(screen.getByTestId("step-0")).toHaveTextContent("");
  });
});
