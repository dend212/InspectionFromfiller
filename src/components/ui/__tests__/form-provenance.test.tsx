import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProvenanceProvider } from "@/components/prefill/provenance-context";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormCheckboxRow,
  FormControl,
  FormField,
  FormFieldGroup,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
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
  // Unmount before unstubbing fetch — otherwise RTL's auto-unmount cleanup fires after the
  // stub is gone and the provider's unmount flush hits real fetch (stderr noise).
  cleanup();
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

  it("gives the item min-w-0 so a chip can never widen a grid column", () => {
    render(<NameField />);
    const item = document.querySelector("[data-slot=form-item]");
    expect(item).toHaveClass("grid", "gap-2", "min-w-0");
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

describe("FormItem — prefilled field carrying a warning (audit 5.1)", () => {
  const SEWER = 'Listing says "Sewer" — confirm this property is on septic';

  it("keeps the Prefilled badge and renders the amber warning line under the field", async () => {
    const user = userEvent.setup();
    render(<WithProvenance initial={{ "facilityInfo.facilityName": { ...ENTRY, warning: SEWER } }} />);
    expect(screen.getByRole("button", { name: "Prefilled from County Assessor, 100% confidence" })).toBeInTheDocument();
    const line = document.querySelector("[data-slot=provenance-warning]");
    expect(line).not.toBeNull();
    expect(line?.closest("[data-slot=form-item]")).toHaveAttribute("data-field-path", "facilityInfo.facilityName");
    expect(screen.getByText(SEWER)).toBeInTheDocument();
    // no suggestion to accept — the field is filled
    expect(screen.queryByRole("button", { name: /accept suggestion/i })).toBeNull();
    expect(document.querySelector("[data-slot=suggestion-chip]")).toBeNull();
    // dismissing the line leaves the badge
    await user.click(screen.getByRole("button", { name: "Dismiss warning" }));
    expect(document.querySelector("[data-slot=provenance-warning]")).toBeNull();
    expect(screen.getByRole("button", { name: "Prefilled from County Assessor, 100% confidence" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Checkbox groups (one field path, many controls) and boolean checkbox rows
// ---------------------------------------------------------------------------

const SYSTEM_TYPES = [
  { value: "conventional", label: "Conventional System" },
  { value: "alternative", label: "Alternative System" },
  { value: "gray_water", label: "Gray Water System Observed" },
] as const;
const GROUP_FIELD = "facilityInfo.facilitySystemTypes";
const GROUP_SUGGESTION: ProvenanceEntry = {
  source: "permit",
  state: "suggested",
  kind: "fill",
  value: ["conventional"],
  confidence: 0.7,
  explanation: "Permit 000972 · Approval to Construct p.1",
  at: "2026-09-11T10:00:00.000Z",
};

function SystemTypeGroup({ initial }: { initial: FieldProvenance }) {
  const form = useForm<InspectionFormData>({
    defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
  });
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={initial}>
      <Form {...form}>
        <FormFieldGroup name={GROUP_FIELD} label="System Type" className="space-y-3">
          {SYSTEM_TYPES.map((type) => (
            <FormField
              key={type.value}
              control={form.control}
              name={GROUP_FIELD}
              render={({ field }) => (
                <FormItem>
                  <FormCheckboxRow
                    control={
                      <Checkbox
                        checked={field.value?.includes(type.value)}
                        onCheckedChange={(checked) => {
                          const current = field.value ?? [];
                          field.onChange(
                            checked
                              ? [...current, type.value]
                              : current.filter((v: string) => v !== type.value),
                          );
                        }}
                      />
                    }
                  >
                    {type.label}
                  </FormCheckboxRow>
                </FormItem>
              )}
            />
          ))}
        </FormFieldGroup>
      </Form>
    </ProvenanceProvider>
  );
}

describe("FormFieldGroup (checkbox group sharing one field path)", () => {
  it("renders exactly one chip for the group, after the last option", () => {
    render(<SystemTypeGroup initial={{ [GROUP_FIELD]: GROUP_SUGGESTION }} />);
    const chips = document.querySelectorAll("[data-slot=suggestion-chip]");
    expect(chips).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /accept suggestion from permit records/i })).toHaveLength(1);
    // Placement: the chip follows every option row inside the group container
    const group = screen.getByRole("group", { name: "System Type" });
    expect(group).toContainElement(chips[0] as HTMLElement);
    const lastRow = screen.getByRole("checkbox", { name: "Gray Water System Observed" });
    expect(lastRow.compareDocumentPosition(chips[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Members render no per-option badge either
    expect(screen.queryByRole("button", { name: /prefilled from/i })).toBeNull();
  });

  it("accepting the chip ticks the right checkbox and shows one badge beside the group label", async () => {
    const user = userEvent.setup();
    render(<SystemTypeGroup initial={{ [GROUP_FIELD]: GROUP_SUGGESTION }} />);
    await user.click(screen.getByRole("button", { name: /accept suggestion from permit records/i }));

    expect(screen.getByRole("checkbox", { name: "Conventional System" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Alternative System" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Gray Water System Observed" })).not.toBeChecked();
    expect(document.querySelectorAll("[data-slot=suggestion-chip]")).toHaveLength(0);

    const badges = screen.getAllByRole("button", { name: "Prefilled from Permit records, 70% confidence" });
    expect(badges).toHaveLength(1);
    // Beside the group label, in the same flex row
    const label = screen.getByText("System Type");
    expect(badges[0].parentElement).toBe(label.parentElement);
    expect(label.parentElement).toHaveClass("flex", "items-center");
    // The group is named by its label, not by the badge
    expect(screen.getByRole("group", { name: "System Type" })).toBeInTheDocument();
  });

  it("renders the warning line once for a prefilled group that carries one", () => {
    render(
      <SystemTypeGroup
        initial={{
          [GROUP_FIELD]: { ...GROUP_SUGGESTION, state: "prefilled", confidence: 0.9, warning: "Confirm the system is not shared" },
        }}
      />,
    );
    expect(document.querySelectorAll("[data-slot=provenance-warning]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-slot=suggestion-chip]")).toHaveLength(0);
    expect(screen.getByText("Confirm the system is not shared")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Prefilled from Permit records, 90% confidence" })).toHaveLength(1);
  });

  it("renders one badge next to the group label for a prefilled group and none inside the rows", () => {
    render(
      <SystemTypeGroup
        initial={{ [GROUP_FIELD]: { ...GROUP_SUGGESTION, state: "prefilled", confidence: 0.99 } }}
      />,
    );
    const badges = screen.getAllByRole("button", { name: "Prefilled from Permit records, 99% confidence" });
    expect(badges).toHaveLength(1);
    expect(badges[0].closest("label")).toBeNull();
    for (const type of SYSTEM_TYPES) {
      const row = screen.getByText(type.label).closest("[data-slot=form-checkbox-row]");
      expect(row).not.toBeNull();
      expect(within(row as HTMLElement).queryByRole("button", { name: /prefilled from/i })).toBeNull();
    }
  });
});

const BOOL_FIELD = "facilityInfo.hasApprovalOfConstruction";
const BOOL_ENTRY: ProvenanceEntry = {
  source: "permit",
  state: "prefilled",
  kind: "fill",
  value: true,
  confidence: 0.99,
  explanation: "Approval to construct issued 04/2000 (permit 000972)",
  at: "2026-09-11T10:00:00.000Z",
};

function BooleanRow({
  initial,
  controlPosition,
}: {
  initial: FieldProvenance;
  controlPosition?: "start" | "end";
}) {
  const form = useForm<InspectionFormData>({
    defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
  });
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={initial}>
      <Form {...form}>
        <FormField
          control={form.control}
          name={BOOL_FIELD}
          render={({ field }) => (
            <FormItem>
              <FormCheckboxRow
                controlPosition={controlPosition}
                control={<Checkbox checked={field.value} onCheckedChange={field.onChange} />}
              >
                Approval of Construction
              </FormCheckboxRow>
            </FormItem>
          )}
        />
      </Form>
    </ProvenanceProvider>
  );
}

describe("FormCheckboxRow (boolean checkbox row)", () => {
  it("names the checkbox by the label only and toggles it when the label text is clicked", async () => {
    const user = userEvent.setup();
    render(<BooleanRow initial={{}} />);
    const box = screen.getByRole("checkbox", { name: "Approval of Construction" });
    expect(box).not.toBeChecked();
    await user.click(screen.getByText("Approval of Construction"));
    expect(box).toBeChecked();
    await user.click(box);
    expect(box).not.toBeChecked();
    expect(screen.queryByRole("button", { name: /prefilled from/i })).toBeNull();
  });

  it("renders the provenance badge after the label text, outside the <label>, for a prefilled field", () => {
    render(<BooleanRow initial={{ [BOOL_FIELD]: BOOL_ENTRY }} />);
    const badge = screen.getByRole("button", { name: "Prefilled from Permit records, 99% confidence" });
    const label = screen.getByText("Approval of Construction").closest("label");
    expect(label).not.toBeNull();
    expect(label).toHaveTextContent(/^Approval of Construction$/);
    expect(badge.closest("label")).toBeNull();
    expect(label!.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Same bordered row
    expect(badge.closest("[data-slot=form-checkbox-row]")).toBe(label!.closest("[data-slot=form-checkbox-row]"));
    // The checkbox is still named by the label alone
    expect(screen.getByRole("checkbox", { name: "Approval of Construction" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /prefilled from/i })).toHaveLength(1);
  });

  it("keeps the badge between the label and a trailing control", () => {
    render(<BooleanRow initial={{ [BOOL_FIELD]: BOOL_ENTRY }} controlPosition="end" />);
    const badge = screen.getByRole("button", { name: /prefilled from permit records/i });
    const box = screen.getByRole("checkbox", { name: "Approval of Construction" });
    const label = screen.getByText("Approval of Construction").closest("label") as HTMLElement;
    expect(label.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(badge.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the source label in the badge popover so Verify / Clear are reachable", async () => {
    const user = userEvent.setup();
    render(<BooleanRow initial={{ [BOOL_FIELD]: BOOL_ENTRY }} />);
    await user.click(screen.getByRole("button", { name: /prefilled from permit records/i }));
    expect(await screen.findByText("Permit records")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });
});
