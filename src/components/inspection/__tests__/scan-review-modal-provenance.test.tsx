import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScanReviewModal } from "@/components/inspection/scan-review-modal";
import { ProvenanceProvider, useProvenance } from "@/components/prefill/provenance-context";
import type { UseFormScanReturn } from "@/hooks/use-form-scan";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

vi.mock("@/components/inspection/scan-upload-zone", () => ({
  ScanUploadZone: () => <div data-testid="scan-upload-zone">Upload Zone</div>,
}));

function Probe() {
  const { provenance } = useProvenance();
  return <div data-testid="probe">{Object.keys(provenance).join(",")}</div>;
}

function Harness({
  children,
}: {
  children: (form: UseFormReturn<InspectionFormData>) => React.ReactNode;
}) {
  const form = useForm<InspectionFormData>({
    defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
  });
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={{}}>
      {children(form)}
      <Probe />
    </ProvenanceProvider>
  );
}

function makeScan(): UseFormScanReturn {
  return {
    state: "reviewing",
    setState: vi.fn(),
    uploadedImages: [],
    scanResult: {
      fields: [
        { fieldPath: "facilityInfo.facilityName", value: "Test Facility", confidence: 0.95, source: "Page 1" },
      ],
      metadata: { pagesProcessed: 1, totalFieldsExtracted: 1, processingTimeMs: 900 },
    },
    selectedFields: new Set(["facilityInfo.facilityName"]),
    error: null,
    addUploadedImage: vi.fn(),
    removeUploadedImage: vi.fn(),
    startScan: vi.fn(),
    toggleField: vi.fn(),
    selectAllHighConfidence: vi.fn(),
    clearAllSelections: vi.fn(),
    // Real-ish applyFields: forwards the provider's setMany like the hook does
    applyFields: vi.fn((_form, onProvenance) => {
      onProvenance?.({
        "facilityInfo.facilityName": {
          source: "scan",
          state: "prefilled",
          kind: "fill",
          value: "Test Facility",
          confidence: 0.95,
          explanation: "Scanned form · Page 1",
          at: "2026-09-11T10:00:00.000Z",
        },
      });
    }),
    reset: vi.fn(),
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ScanReviewModal provenance", () => {
  it("passes the provider's setMany into applyFields so scanned fields get badges", async () => {
    const user = userEvent.setup();
    const scan = makeScan();
    render(
      <Harness>
        {(form) => (
          <ScanReviewModal open onOpenChange={vi.fn()} inspectionId="insp-1" form={form} scan={scan} />
        )}
      </Harness>,
    );

    await user.click(screen.getByRole("button", { name: /apply 1 field/i }));

    expect(scan.applyFields).toHaveBeenCalledWith(expect.anything(), expect.any(Function));
    expect(screen.getByTestId("probe")).toHaveTextContent("facilityInfo.facilityName");
  });
});
