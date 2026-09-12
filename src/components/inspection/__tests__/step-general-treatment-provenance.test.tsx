import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StepGeneralTreatment } from "@/components/inspection/step-general-treatment";
import { ProvenanceProvider } from "@/components/prefill/provenance-context";
import { Form } from "@/components/ui/form";
import type { FieldProvenance, ProvenanceEntry } from "@/lib/prefill/types";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/inspection/media-gallery", () => ({ MediaGallery: () => <div /> }));
vi.mock("@/components/inspection/photo-capture", () => ({ PhotoCapture: () => <div /> }));

const ALT = "generalTreatment.alternativeSystem";
const ALT_PREFILLED: ProvenanceEntry = {
  source: "permit",
  state: "prefilled",
  kind: "fill",
  value: true,
  confidence: 0.85,
  explanation: "Permit OW-1 · Approval to Construct p.1",
  at: "2026-09-11T10:00:00.000Z",
};
const ALT_SUGGESTED: ProvenanceEntry = { ...ALT_PREFILLED, state: "suggested", confidence: 0.7 };

function Harness({ initial, alternativeSystem = false }: { initial: FieldProvenance; alternativeSystem?: boolean }) {
  const defaults = getDefaultFormValues("Tech") as unknown as InspectionFormData;
  defaults.generalTreatment.alternativeSystem = alternativeSystem;
  const form = useForm<InspectionFormData>({ defaultValues: defaults });
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={initial}>
      <Form {...form}>
        <StepGeneralTreatment inspectionId="insp-1" />
      </Form>
    </ProvenanceProvider>
  );
}

beforeEach(() => {
  // The step loads media on mount (a non-ok response leaves it empty); the provider PATCHes on accept/verify/clear.
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

describe("StepGeneralTreatment provenance rendering — alternativeSystem toggle", () => {
  it("renders exactly one badge beside the heading for a prefilled toggle, with the popover reachable", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ [ALT]: ALT_PREFILLED }} alternativeSystem />);

    const badges = screen.getAllByRole("button", { name: "Prefilled from Permit records, 85% confidence" });
    expect(badges).toHaveLength(1);
    expect(document.querySelectorAll("[data-slot=provenance-badge]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-slot=suggestion-chip]")).toHaveLength(0);
    const heading = screen.getByRole("heading", { name: "Alternative Treatment System" });
    expect(badges[0].parentElement).toBe(heading.parentElement);
    // The switch keeps its own accessible name and reflects the prefilled value
    expect(screen.getByRole("switch", { name: "Toggle alternative treatment system fields" })).toBeChecked();

    await user.click(badges[0]);
    expect(await screen.findByText("Permit OW-1 · Approval to Construct p.1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("renders exactly one suggestion chip and no badge for a suggested toggle; accepting flips the switch", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ [ALT]: ALT_SUGGESTED }} />);

    expect(document.querySelectorAll("[data-slot=suggestion-chip]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-slot=provenance-badge]")).toHaveLength(0);
    const toggle = screen.getByRole("switch", { name: "Toggle alternative treatment system fields" });
    expect(toggle).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Accept suggestion from Permit records: Yes" }));

    expect(screen.getByRole("switch", { name: "Toggle alternative treatment system fields" })).toBeChecked();
    expect(document.querySelectorAll("[data-slot=suggestion-chip]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-slot=provenance-badge]")).toHaveLength(1);
  });

  it("renders no badge and no chip when the field has no provenance", () => {
    render(<Harness initial={{}} />);
    expect(document.querySelectorAll("[data-slot=provenance-badge]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-slot=suggestion-chip]")).toHaveLength(0);
  });
});
