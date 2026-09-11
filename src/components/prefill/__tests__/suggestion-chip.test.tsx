import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProvenanceProvider } from "@/components/prefill/provenance-context";
import { SuggestionChip, suggestionText } from "@/components/prefill/suggestion-chip";
import type { FieldProvenance, ProvenanceEntry } from "@/lib/prefill/types";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

const SUGGESTION: ProvenanceEntry = {
  source: "permit",
  state: "suggested",
  kind: "fill",
  value: "3",
  confidence: 0.61,
  explanation: "Permit OW-17-00474 p.2",
  at: "2026-09-11T10:00:00.000Z",
};
const WARNING: ProvenanceEntry = {
  source: "listing",
  state: "suggested",
  kind: "warning",
  value: "",
  confidence: 0.8,
  explanation: 'Listing says "Sewer" — confirm this property is on septic',
  at: "2026-09-11T10:00:00.000Z",
};
const FIELD = "designFlow.numberOfBedrooms";
const formRef: { current: UseFormReturn<InspectionFormData> | null } = { current: null };

function Harness({
  initial,
  readOnly,
  children,
}: {
  initial: FieldProvenance;
  readOnly?: boolean;
  children: React.ReactNode;
}) {
  const form = useForm<InspectionFormData>({
    defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
  });
  formRef.current = form;
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={initial} readOnly={readOnly}>
      {children}
    </ProvenanceProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  // Unmount before unstubbing fetch — otherwise RTL's own auto-unmount cleanup
  // fires after the stub is gone and the provider's unmount flush hits real
  // fetch, logging "[provenance] save failed" noise to stderr.
  cleanup();
  vi.unstubAllGlobals();
});

describe("suggestionText", () => {
  it("formats value, confidence and explanation", () => {
    expect(suggestionText(SUGGESTION)).toBe("Suggested: 3 · 61% · Permit OW-17-00474 p.2");
    expect(suggestionText({ ...SUGGESTION, value: true })).toBe("Suggested: Yes · 61% · Permit OW-17-00474 p.2");
    expect(suggestionText({ ...SUGGESTION, value: ["a", "b"] })).toBe("Suggested: a, b · 61% · Permit OW-17-00474 p.2");
    expect(suggestionText(WARNING)).toBe('Listing says "Sewer" — confirm this property is on septic');
  });
});

describe("SuggestionChip", () => {
  it("renders nothing without a suggested entry", () => {
    const { container } = render(
      <Harness initial={{ [FIELD]: { ...SUGGESTION, state: "prefilled" } }}>
        <SuggestionChip fieldPath={FIELD} />
      </Harness>,
    );
    expect(container.querySelector("[data-slot=suggestion-chip]")).toBeNull();
  });

  it("accepts the suggestion into the form and disappears", async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={{ [FIELD]: SUGGESTION }}>
        <SuggestionChip fieldPath={FIELD} />
      </Harness>,
    );
    await user.click(
      screen.getByRole("button", { name: "Accept suggestion from Permit records: 3" }),
    );
    expect(formRef.current?.getValues("designFlow.numberOfBedrooms")).toBe("3");
    expect(screen.queryByRole("button", { name: /accept suggestion/i })).toBeNull();
  });

  it("dismisses the suggestion without touching the form", async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={{ [FIELD]: SUGGESTION }}>
        <SuggestionChip fieldPath={FIELD} />
      </Harness>,
    );
    await user.click(screen.getByRole("button", { name: "Dismiss suggestion" }));
    expect(screen.queryByRole("button", { name: /accept suggestion/i })).toBeNull();
    expect(formRef.current?.getValues("designFlow.numberOfBedrooms")).toBe("");
  });

  it("renders a warning as an amber message with dismiss only", () => {
    render(
      <Harness initial={{ "facilityInfo.wastewaterSource": WARNING }}>
        <SuggestionChip fieldPath="facilityInfo.wastewaterSource" />
      </Harness>,
    );
    expect(screen.getByText(WARNING.explanation)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /accept suggestion/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss suggestion" })).toBeInTheDocument();
    expect(document.querySelector("[data-slot=suggestion-chip]")).toHaveClass("border-amber-300");
  });

  it("puts the full text in title so a truncated chip is still readable", () => {
    render(
      <Harness initial={{ [FIELD]: SUGGESTION }}>
        <SuggestionChip fieldPath={FIELD} />
      </Harness>,
    );
    expect(screen.getByRole("button", { name: /accept suggestion/i })).toHaveAttribute(
      "title",
      suggestionText(SUGGESTION),
    );
  });

  it("puts the full warning message in title so a truncated warning chip is still readable", () => {
    render(
      <Harness initial={{ "facilityInfo.wastewaterSource": WARNING }}>
        <SuggestionChip fieldPath="facilityInfo.wastewaterSource" />
      </Harness>,
    );
    expect(screen.getByText(WARNING.explanation)).toHaveAttribute("title", WARNING.explanation);
  });

  it("is inert when read-only", () => {
    render(
      <Harness initial={{ [FIELD]: SUGGESTION }} readOnly>
        <SuggestionChip fieldPath={FIELD} />
      </Harness>,
    );
    expect(screen.getByRole("button", { name: /accept suggestion/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Dismiss suggestion" })).toBeNull();
  });
});
