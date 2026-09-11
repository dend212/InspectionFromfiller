import { act, renderHook } from "@testing-library/react";
import type { UseFormReturn } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFormScan } from "@/hooks/use-form-scan";
import type { ScanResult } from "@/lib/ai/scan-types";
import type { FieldProvenance } from "@/lib/prefill/types";
import type { InspectionFormData } from "@/types/inspection";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SCAN: ScanResult = {
  fields: [
    { fieldPath: "facilityInfo.facilityName", value: "Test Facility", confidence: 0.95, source: "Page 1, Facility Information" },
    { fieldPath: "facilityInfo.facilityAddress", value: "123 Main St", confidence: 0.5, source: "Page 1" },
    { fieldPath: "septicTank.tanks[0].tankCapacity", value: "1000", confidence: 0.9, source: "Page 2, Section 4E" },
  ],
  metadata: { pagesProcessed: 2, totalFieldsExtracted: 3, processingTimeMs: 1200 },
};

const makeMockForm = () =>
  ({
    setValue: vi.fn(),
    getValues: vi.fn().mockReturnValue([]),
  }) as unknown as UseFormReturn<InspectionFormData>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useFormScan.applyFields provenance", () => {
  it("reports a scan entry for every applied field, keyed by the normalised path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(SCAN) }));
    const { result } = renderHook(() => useFormScan());
    const form = makeMockForm();
    const onProvenance = vi.fn<(entries: FieldProvenance) => void>();

    act(() => result.current.addUploadedImage({ storagePath: "a.jpg", previewUrl: "blob:a", fileName: "a.jpg" }));
    await act(() => result.current.startScan("insp-1"));
    // auto-selected: facilityName (0.95) and tanks[0].tankCapacity (0.9); address (0.5) is not
    act(() => result.current.applyFields(form, onProvenance));

    expect(onProvenance).toHaveBeenCalledTimes(1);
    const entries = onProvenance.mock.calls[0][0];
    expect(Object.keys(entries).sort()).toEqual([
      "facilityInfo.facilityName",
      "septicTank.tanks.0.tankCapacity",
    ]);
    expect(entries["facilityInfo.facilityName"]).toMatchObject({
      source: "scan",
      state: "prefilled",
      kind: "fill",
      value: "Test Facility",
      confidence: 0.95,
      explanation: "Scanned form · Page 1, Facility Information",
    });
    expect(entries["septicTank.tanks.0.tankCapacity"]).toMatchObject({
      value: "1000",
      confidence: 0.9,
      explanation: "Scanned form · Page 2, Section 4E",
    });
    expect(Date.parse(entries["facilityInfo.facilityName"].at)).not.toBeNaN();
  });

  it("still works without an onProvenance callback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(SCAN) }));
    const { result } = renderHook(() => useFormScan());
    const form = makeMockForm();
    act(() => result.current.addUploadedImage({ storagePath: "a.jpg", previewUrl: "blob:a", fileName: "a.jpg" }));
    await act(() => result.current.startScan("insp-1"));
    expect(() => act(() => result.current.applyFields(form))).not.toThrow();
    expect(form.setValue).toHaveBeenCalled();
  });
});
