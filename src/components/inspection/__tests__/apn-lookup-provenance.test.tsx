import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApnLookupInput } from "@/components/inspection/apn-lookup-input";
import { ProvenanceProvider, useProvenance } from "@/components/prefill/provenance-context";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ASSESSOR = {
  ownerName: "John Smith",
  physicalAddress: "123 Main St",
  city: "Phoenix",
  zip: "85001",
  county: "Maricopa",
  apnFormatted: "123-45-678",
  legalDescription: "",
  lotSize: "",
  yearBuilt: "",
};

function Probe() {
  const { provenance } = useProvenance();
  return (
    <ul data-testid="probe">
      {Object.entries(provenance).map(([path, entry]) => (
        <li key={path}>{`${path}|${entry.source}|${entry.state}|${entry.confidence}|${entry.value}`}</li>
      ))}
    </ul>
  );
}

function Harness({ onLookupSuccess }: { onLookupSuccess?: (r: { apn: string }) => void }) {
  const form = useForm<InspectionFormData>({
    defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
  });
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={{}}>
      <ApnLookupInput form={form} onLookupSuccess={onLookupSuccess} />
      <Probe />
    </ProvenanceProvider>
  );
}

// Unmount before the fetch stub is torn down: ProvenanceProvider flushes a pending
// save on unmount, and testing-library's automatic cleanup runs after this hook
// (afterEach hooks run in reverse registration order), which would otherwise hit
// the real, un-stubbed fetch and log "Failed to parse URL" from an unrelated test.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ApnLookupInput provenance", () => {
  it("writes an assessor entry for every field it fills and reports success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ assessor: ASSESSOR }) }),
    );
    const onLookupSuccess = vi.fn();
    const user = userEvent.setup();
    render(<Harness onLookupSuccess={onLookupSuccess} />);

    await user.type(screen.getByLabelText("Assessor Parcel Number"), "123-45-678");
    await user.click(screen.getByRole("button", { name: /apn lookup/i }));

    await waitFor(() => {
      expect(screen.getByTestId("probe").children).toHaveLength(7);
    });
    expect(screen.getByText("facilityInfo.facilityName|assessor|prefilled|1|John Smith")).toBeInTheDocument();
    expect(screen.getByText("facilityInfo.taxParcelNumber|assessor|prefilled|1|123-45-678")).toBeInTheDocument();
    expect(onLookupSuccess).toHaveBeenCalledWith({ apn: "123-45-678", assessor: ASSESSOR });
  });

  it("does not write provenance or call onLookupSuccess when the lookup fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: "No property found" }) }),
    );
    const onLookupSuccess = vi.fn();
    const user = userEvent.setup();
    render(<Harness onLookupSuccess={onLookupSuccess} />);

    await user.type(screen.getByLabelText("Assessor Parcel Number"), "999-99-999");
    await user.click(screen.getByRole("button", { name: /apn lookup/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /apn lookup/i })).toBeEnabled();
    });
    expect(screen.getByTestId("probe").children).toHaveLength(0);
    expect(onLookupSuccess).not.toHaveBeenCalled();
  });
});
