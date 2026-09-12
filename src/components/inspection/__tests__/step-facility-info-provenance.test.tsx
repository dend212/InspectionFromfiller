import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StepFacilityInfo } from "@/components/inspection/step-facility-info";
import { ProvenanceProvider } from "@/components/prefill/provenance-context";
import { Form } from "@/components/ui/form";
import type { FieldProvenance, ProvenanceEntry } from "@/lib/prefill/types";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/inspection/media-gallery", () => ({ MediaGallery: () => <div /> }));
vi.mock("@/components/inspection/photo-capture", () => ({ PhotoCapture: () => <div /> }));

const SYSTEM_TYPES = "facilityInfo.facilitySystemTypes";
const SYSTEM_TYPES_SUGGESTION: ProvenanceEntry = {
  source: "permit",
  state: "suggested",
  kind: "fill",
  value: ["conventional"],
  confidence: 0.7,
  explanation: "Permit 000972 · Approval to Construct p.1",
  at: "2026-09-11T10:00:00.000Z",
};
const APPROVAL = "facilityInfo.hasApprovalOfConstruction";
const SITE_PLAN = "facilityInfo.hasSitePlan";
const BOOL_ENTRY: ProvenanceEntry = {
  source: "permit",
  state: "prefilled",
  kind: "fill",
  value: true,
  confidence: 0.99,
  explanation: "Approval to construct issued 04/2000 (permit 000972)",
  at: "2026-09-11T10:00:00.000Z",
};

function Harness({ initial }: { initial: FieldProvenance }) {
  const form = useForm<InspectionFormData>({
    defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
  });
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={initial}>
      <Form {...form}>
        <StepFacilityInfo inspectionId="insp-1" />
      </Form>
    </ProvenanceProvider>
  );
}

beforeEach(() => {
  // The step loads media on mount (a non-ok response leaves it empty, no state update);
  // the provenance provider PATCHes on accept/verify/clear.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/media") ? { ok: false } : { ok: true, text: async () => "" },
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StepFacilityInfo provenance rendering", () => {
  it("renders exactly one suggestion chip for the System Type group; accepting it ticks the right box", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ [SYSTEM_TYPES]: SYSTEM_TYPES_SUGGESTION }} />);

    const chips = document.querySelectorAll("[data-slot=suggestion-chip]");
    expect(chips).toHaveLength(1);
    const group = screen.getByRole("group", { name: "System Type" });
    expect(group).toContainElement(chips[0] as HTMLElement);
    expect(within(group).getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /prefilled from/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Accept suggestion from Permit records: conventional" }));

    expect(screen.getByRole("checkbox", { name: "Conventional System" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Alternative System" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Gray Water System Observed" })).not.toBeChecked();
    expect(document.querySelectorAll("[data-slot=suggestion-chip]")).toHaveLength(0);
    // One badge, beside the group label
    const badges = screen.getAllByRole("button", { name: "Prefilled from Permit records, 70% confidence" });
    expect(badges).toHaveLength(1);
    expect(badges[0].parentElement).toBe(screen.getByText("System Type").parentElement);
  });

  it("renders one badge per prefilled boolean row, after the label text, with the popover reachable", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ [APPROVAL]: BOOL_ENTRY, [SITE_PLAN]: BOOL_ENTRY }} />);

    const badges = screen.getAllByRole("button", { name: "Prefilled from Permit records, 99% confidence" });
    expect(badges).toHaveLength(2);
    for (const text of ["Approval of Construction", "Site Plan / As-Built Drawings"]) {
      const row = screen.getByText(text).closest("[data-slot=form-checkbox-row]") as HTMLElement;
      expect(row).not.toBeNull();
      const badge = within(row).getByRole("button", { name: /prefilled from permit records/i });
      expect(badge.closest("label")).toBeNull();
      const label = screen.getByText(text).closest("label") as HTMLElement;
      expect(label.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // The row's checkbox is still named by the label alone
      expect(within(row).getByRole("checkbox", { name: text })).toBeInTheDocument();
    }

    await user.click(badges[0]);
    expect(await screen.findByText("Approval to construct issued 04/2000 (permit 000972)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("label text click still toggles a boolean row's checkbox", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{}} />);
    const box = screen.getByRole("checkbox", { name: "Approval of Construction" });
    expect(box).not.toBeChecked();
    await user.click(screen.getByText("Approval of Construction"));
    expect(box).toBeChecked();
  });
});
