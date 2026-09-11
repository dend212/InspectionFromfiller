import { render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProvenanceProvider } from "@/components/prefill/provenance-context";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { FieldProvenance, ProvenanceEntry } from "@/lib/prefill/types";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

const ENTRY: ProvenanceEntry = {
  source: "assessor",
  state: "prefilled",
  kind: "fill",
  value: "JOHN DOE",
  confidence: 1,
  explanation: "Maricopa County Assessor · parcel 219-11-121",
  at: "2026-09-11T10:00:00.000Z",
};

function NameField() {
  const form = useForm<InspectionFormData>({
    defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
  });
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="facilityInfo.facilityName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Facility name</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
          </FormItem>
        )}
      />
    </Form>
  );
}

function WithProvenance({ initial }: { initial: FieldProvenance }) {
  const form = useForm<InspectionFormData>({
    defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
  });
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={initial}>
      <Form {...form}>
        <FormField
          control={form.control}
          name="facilityInfo.facilityName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Facility name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
            </FormItem>
          )}
        />
      </Form>
    </ProvenanceProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FormLabel / FormItem provenance integration", () => {
  it("renders no badge or chip outside a ProvenanceProvider", () => {
    render(<NameField />);
    expect(screen.getByText("Facility name")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /prefilled from/i })).toBeNull();
    expect(document.querySelector("[data-slot=suggestion-chip]")).toBeNull();
  });

  it("renders no badge when the field has no entry", () => {
    render(<WithProvenance initial={{ "facilityInfo.facilityCity": ENTRY }} />);
    expect(screen.queryByRole("button", { name: /prefilled from/i })).toBeNull();
  });

  it("renders the badge as a sibling of the label, not inside it, so the input's name stays clean", () => {
    render(<WithProvenance initial={{ "facilityInfo.facilityName": ENTRY }} />);
    const badge = screen.getByRole("button", { name: "Prefilled from County Assessor, 100% confidence" });
    // Not nested in the <label> (buttons inside labels are invalid HTML and pollute the accessible name)
    expect(badge.closest("label")).toBeNull();
    const label = screen.getByText("Facility name").closest("label");
    expect(label).not.toBeNull();
    expect(label).toHaveTextContent(/^Facility name$/);
    // Same inline-flex row as the label
    expect(badge.parentElement).toBe(label?.parentElement);
    expect(label?.parentElement).toHaveClass("inline-flex");
    // The control is announced by its label only
    expect(screen.getByRole("textbox", { name: "Facility name" })).toBeInTheDocument();
    expect(document.querySelector("[data-slot=suggestion-chip]")).toBeNull();
  });

  it("appends the suggestion chip inside the item for a suggested field", () => {
    render(
      <WithProvenance
        initial={{ "facilityInfo.facilityName": { ...ENTRY, state: "suggested", confidence: 0.6 } }}
      />,
    );
    const chip = document.querySelector("[data-slot=suggestion-chip]");
    expect(chip).not.toBeNull();
    expect(chip?.closest("[data-slot=form-item]")).not.toBeNull();
    expect(chip?.closest("[data-slot=form-item]")).toHaveAttribute(
      "data-field-path",
      "facilityInfo.facilityName",
    );
    expect(screen.getByRole("button", { name: /accept suggestion from county assessor/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /prefilled from/i })).toBeNull();
  });
});
