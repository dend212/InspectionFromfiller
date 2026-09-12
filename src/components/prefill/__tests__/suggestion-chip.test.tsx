import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { FormProvider, type UseFormReturn, useForm, useFormContext } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProvenanceProvider } from "@/components/prefill/provenance-context";
import {
  SuggestionChip,
  suggestionDisplayText,
  suggestionText,
} from "@/components/prefill/suggestion-chip";
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
  values,
  withFormProvider,
  children,
}: {
  initial: FieldProvenance;
  readOnly?: boolean;
  /** Patch applied to the default form values before mount */
  values?: (f: InspectionFormData) => void;
  /** Wrap in react-hook-form's FormProvider, as the wizard's <Form> does */
  withFormProvider?: boolean;
  children: React.ReactNode;
}) {
  const defaults = getDefaultFormValues("Tech") as unknown as InspectionFormData;
  values?.(defaults);
  const form = useForm<InspectionFormData>({ defaultValues: defaults });
  formRef.current = form;
  const body = withFormProvider ? <FormProvider {...form}>{children}</FormProvider> : children;
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={initial} readOnly={readOnly}>
      {body}
    </ProvenanceProvider>
  );
}

function BedroomsInput() {
  const { register } = useFormContext<InspectionFormData>();
  return <input aria-label="Bedrooms" {...register("designFlow.numberOfBedrooms")} />;
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

  it("drops the explanation when it merely repeats the value (trimmed, case-insensitive)", () => {
    const basis = "Approval to construct issued 04/2000 (permit 000972)";
    expect(suggestionText({ ...SUGGESTION, value: basis, explanation: basis })).toBe(
      `Suggested: ${basis} · 61%`,
    );
    expect(
      suggestionText({ ...SUGGESTION, value: `  ${basis.toUpperCase()} `, explanation: basis }),
    ).toBe(`Suggested:   ${basis.toUpperCase()}  · 61%`);
    // A genuinely different explanation is kept
    expect(suggestionText({ ...SUGGESTION, value: "26", explanation: basis })).toBe(
      `Suggested: 26 · 61% · ${basis}`,
    );
  });
});

describe("suggestionDisplayText", () => {
  it("shortens a long value to 57 characters + ellipsis, leaving short values alone", () => {
    const long = "x".repeat(61);
    expect(suggestionDisplayText({ ...SUGGESTION, value: long })).toBe(
      `Suggested: ${"x".repeat(57)}… · 61% · Permit OW-17-00474 p.2`,
    );
    const exactly60 = "y".repeat(60);
    expect(suggestionDisplayText({ ...SUGGESTION, value: exactly60 })).toBe(
      `Suggested: ${exactly60} · 61% · Permit OW-17-00474 p.2`,
    );
    expect(suggestionDisplayText(SUGGESTION)).toBe(suggestionText(SUGGESTION));
    expect(suggestionDisplayText(WARNING)).toBe(WARNING.explanation);
  });

  it("also dedupes a long explanation that repeats the value", () => {
    const long = "Approval to construct issued 04/2000 (permit 000972) — county EDMS record";
    expect(suggestionDisplayText({ ...SUGGESTION, value: long, explanation: long })).toBe(
      `Suggested: ${long.slice(0, 57)}… · 61%`,
    );
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

  it("shows the shortened value on the chip but keeps the full text in title and aria-label", () => {
    const long = "Approval to construct issued 04/2000 (permit 000972) — county EDMS record";
    const entry: ProvenanceEntry = { ...SUGGESTION, value: long, explanation: long };
    render(
      <Harness initial={{ [FIELD]: entry }}>
        <SuggestionChip fieldPath={FIELD} />
      </Harness>,
    );
    const accept = screen.getByRole("button", { name: `Accept suggestion from Permit records: ${long}` });
    expect(accept).toHaveTextContent(`Suggested: ${long.slice(0, 57)}… · 61%`);
    expect(accept).toHaveAttribute("title", `Suggested: ${long} · 61%`);
  });

  it("wraps instead of truncating so it can never widen its column", () => {
    render(
      <Harness initial={{ [FIELD]: SUGGESTION }}>
        <SuggestionChip fieldPath={FIELD} />
      </Harness>,
    );
    const chip = document.querySelector("[data-slot=suggestion-chip]");
    expect(chip).toHaveClass("min-w-0", "max-w-full", "whitespace-normal", "break-words", "rounded-lg");
    expect(chip).not.toHaveClass("rounded-full", "truncate");
    const accept = screen.getByRole("button", { name: /accept suggestion/i });
    expect(accept).not.toHaveClass("truncate");
    expect(accept).toHaveClass("whitespace-normal", "break-words", "min-w-0");
    // The dismiss control stays after the text and never shrinks away
    const dismiss = screen.getByRole("button", { name: "Dismiss suggestion" });
    expect(dismiss).toHaveClass("shrink-0");
    expect(accept.compareDocumentPosition(dismiss) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("wraps a warning too", () => {
    render(
      <Harness initial={{ "facilityInfo.wastewaterSource": WARNING }}>
        <SuggestionChip fieldPath="facilityInfo.wastewaterSource" />
      </Harness>,
    );
    const text = screen.getByText(WARNING.explanation);
    expect(text).not.toHaveClass("truncate");
    expect(text).toHaveClass("whitespace-normal", "break-words", "min-w-0");
  });

  it("renders nothing when the field already holds the suggested value", () => {
    const { container } = render(
      <Harness
        initial={{ [FIELD]: SUGGESTION }}
        values={(f) => {
          f.designFlow.numberOfBedrooms = " 3 ";
        }}
        withFormProvider
      >
        <SuggestionChip fieldPath={FIELD} />
      </Harness>,
    );
    expect(container.querySelector("[data-slot=suggestion-chip]")).toBeNull();
  });

  it("renders when the field holds a different value", () => {
    render(
      <Harness
        initial={{ [FIELD]: SUGGESTION }}
        values={(f) => {
          f.designFlow.numberOfBedrooms = "4";
        }}
        withFormProvider
      >
        <SuggestionChip fieldPath={FIELD} />
      </Harness>,
    );
    expect(screen.getByRole("button", { name: "Accept suggestion from Permit records: 3" })).toBeInTheDocument();
  });

  it("disappears live once the user types the suggested value", async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={{ [FIELD]: SUGGESTION }} withFormProvider>
        <BedroomsInput />
        <SuggestionChip fieldPath={FIELD} />
      </Harness>,
    );
    expect(screen.getByRole("button", { name: /accept suggestion/i })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Bedrooms" }), "3");
    expect(screen.queryByRole("button", { name: /accept suggestion/i })).toBeNull();
    // Provenance is untouched — only the live value hides the chip
    expect(formRef.current?.getValues("designFlow.numberOfBedrooms")).toBe("3");
  });

  it("still renders a warning on an empty field (warnings carry no value to compare)", () => {
    render(
      <Harness initial={{ "facilityInfo.wastewaterSource": WARNING }} withFormProvider>
        <SuggestionChip fieldPath="facilityInfo.wastewaterSource" />
      </Harness>,
    );
    expect(screen.getByText(WARNING.explanation)).toBeInTheDocument();
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
