import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, useWatch } from "react-hook-form";
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

/** The two fields inferred from the property use code, as the form currently holds them */
function FormProbe({ form }: { form: ReturnType<typeof useForm<InspectionFormData>> }) {
  const wastewaterSource = useWatch({ control: form.control, name: "facilityInfo.wastewaterSource" });
  const facilityType = useWatch({ control: form.control, name: "facilityInfo.facilityType" });
  const facilityName = useWatch({ control: form.control, name: "facilityInfo.facilityName" });
  return <p data-testid="form">{`${wastewaterSource}|${facilityType}|${facilityName}`}</p>;
}

function Harness({
  onLookupSuccess,
  facilityInfo,
}: {
  onLookupSuccess?: (r: { apn: string }) => void;
  /** Values the form already holds before the lookup (a user's own choices) */
  facilityInfo?: Partial<InspectionFormData["facilityInfo"]>;
}) {
  const defaults = getDefaultFormValues("Tech") as unknown as InspectionFormData;
  const form = useForm<InspectionFormData>({
    defaultValues: { ...defaults, facilityInfo: { ...defaults.facilityInfo, ...facilityInfo } },
  });
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={{}}>
      <ApnLookupInput form={form} onLookupSuccess={onLookupSuccess} />
      <Probe />
      <FormProbe form={form} />
    </ProvenanceProvider>
  );
}

function stubLookup(assessor: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ assessor }) }),
  );
}

async function lookup(apn: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Assessor Parcel Number"), apn);
  await user.click(screen.getByRole("button", { name: /apn lookup/i }));
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

  describe("property-use-code proposals", () => {
    it("writes an inferred field at or above the fill threshold and only suggests one below it", async () => {
      // 07xx → wastewater source residential @ 0.9 (fill), facility type multifamily @ 0.7 (< 0.75)
      stubLookup({ ...ASSESSOR, propertyUseCode: "0712" });
      render(<Harness />);

      await lookup("123-45-678");

      await waitFor(() => {
        expect(screen.getByTestId("probe").children).toHaveLength(9);
      });
      expect(screen.getByTestId("form")).toHaveTextContent("residential||John Smith");
      expect(
        screen.getByText("facilityInfo.wastewaterSource|assessor|prefilled|0.9|residential"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("facilityInfo.facilityType|assessor|suggested|0.7|multifamily"),
      ).toBeInTheDocument();
    });

    it("never overwrites a value the user already chose for an inferred field — it suggests instead", async () => {
      stubLookup({ ...ASSESSOR, propertyUseCode: "0141" });
      render(
        <Harness
          facilityInfo={{
            wastewaterSource: "commercial",
            facilityType: "commercial",
            facilityName: "Previous Owner",
          }}
        />,
      );

      await lookup("123-45-678");

      await waitFor(() => {
        expect(screen.getByTestId("probe").children).toHaveLength(9);
      });
      // The verbatim parcel attributes still overwrite; the two inferences do not
      expect(screen.getByTestId("form")).toHaveTextContent("commercial|commercial|John Smith");
      expect(
        screen.getByText("facilityInfo.wastewaterSource|assessor|suggested|0.95|residential"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("facilityInfo.facilityType|assessor|suggested|0.95|single_family"),
      ).toBeInTheDocument();
    });

    it("marks an inferred field prefilled when the form already holds the proposed value", async () => {
      stubLookup({ ...ASSESSOR, propertyUseCode: "0141" });
      render(<Harness facilityInfo={{ wastewaterSource: "residential", facilityType: "" }} />);

      await lookup("123-45-678");

      await waitFor(() => {
        expect(screen.getByTestId("probe").children).toHaveLength(9);
      });
      expect(screen.getByTestId("form")).toHaveTextContent("residential|single_family|John Smith");
      expect(
        screen.getByText("facilityInfo.wastewaterSource|assessor|prefilled|0.95|residential"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("facilityInfo.facilityType|assessor|prefilled|0.95|single_family"),
      ).toBeInTheDocument();
    });
  });
});
