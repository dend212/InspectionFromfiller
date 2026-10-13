import { act, cleanup, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StepFacilityInfo } from "@/components/inspection/step-facility-info";
import { Form } from "@/components/ui/form";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";
import type { InspectionMatchResult } from "@/types/inspection-matches";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/inspection/media-gallery", () => ({ MediaGallery: () => <div /> }));
vi.mock("@/components/inspection/photo-capture", () => ({ PhotoCapture: () => <div /> }));

// Synthetic fixtures only (duplicate-warning spec §12)
const INSPECTION_ID = "6f1c2a9e-0000-4000-8000-0000000000aa";
const RESULT: InspectionMatchResult = {
  matches: [
    {
      inspectionId: "6f1c2a9e-0000-4000-8000-000000000001",
      href: "/review/6f1c2a9e-0000-4000-8000-000000000001",
      status: "completed",
      facilityAddress: "100 E Example Rd",
      facilityCity: "Cave Creek",
      inspectionDate: "2026-10-06",
      createdAt: "2026-10-06T19:12:00.000Z",
      inspectorName: "Sam Sample",
      isOwn: false,
      reasons: ["address"],
    },
  ],
  hiddenCount: 0,
  truncated: false,
};

function Harness({ address, readOnly = false }: { address: string; readOnly?: boolean }) {
  const defaults = getDefaultFormValues("Tech") as unknown as InspectionFormData;
  const form = useForm<InspectionFormData>({
    defaultValues: { ...defaults, facilityInfo: { ...defaults.facilityInfo, facilityAddress: address } },
  });
  return (
    <Form {...form}>
      <StepFacilityInfo inspectionId={INSPECTION_ID} readOnly={readOnly} />
    </Form>
  );
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
  String(input).endsWith("/matches") ? { ok: true, status: 200, json: async () => RESULT } : { ok: false },
);

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

describe("StepFacilityInfo possible-duplicate warning", () => {
  it("shows the new-tab notice directly under Address, before City", async () => {
    render(<Harness address="100 E Example Rd" />);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledWith(`/api/inspections/${INSPECTION_ID}/matches`, expect.objectContaining({ method: "POST" }));
    const link = screen.getByRole("link", { name: /This address may match another report/ });
    expect(link).toHaveAttribute("target", "_blank");
    const address = document.querySelector('input[name="facilityInfo.facilityAddress"]') as HTMLElement;
    const city = document.querySelector('input[name="facilityInfo.facilityCity"]') as HTMLElement;
    expect(address.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(city) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("still links on the read-only review step", async () => {
    render(<Harness address="100 E Example Rd" readOnly />);
    await act(async () => {});
    expect(screen.getByRole("link", { name: /may match another report/ })).toHaveAttribute(
      "href",
      "/review/6f1c2a9e-0000-4000-8000-000000000001",
    );
  });

  it("a blank draft makes no match request", async () => {
    render(<Harness address="" />);
    await act(async () => {});
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/matches"))).toBe(false);
    expect(screen.queryByRole("link", { name: /may match/ })).toBeNull();
  });
});
