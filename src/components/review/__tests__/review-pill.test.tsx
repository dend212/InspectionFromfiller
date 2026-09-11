import { act, render, renderHook, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pillKind, ReviewPill, useStepValidations } from "@/components/review/review-pill";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

describe("pillKind", () => {
  it("maps validation results to pill kinds", () => {
    expect(pillKind(null)).toBe("excluded");
    expect(pillKind({ errors: [{ path: "a.b", message: "x" }], emptyCount: 0 })).toBe("issues");
    expect(pillKind({ errors: [{ path: "a.b", message: "x" }], emptyCount: 3 })).toBe("issues");
    expect(pillKind({ errors: [], emptyCount: 3 })).toBe("empty");
    expect(pillKind({ errors: [], emptyCount: 0 })).toBe("complete");
  });
});

describe("ReviewPill", () => {
  it("renders complete / N empty / N issues / Not included", () => {
    const { rerender } = render(<ReviewPill result={{ errors: [], emptyCount: 0 }} />);
    expect(screen.getByText("complete")).toHaveAttribute("data-pill", "complete");

    rerender(<ReviewPill result={{ errors: [], emptyCount: 4 }} />);
    expect(screen.getByText("4 empty")).toHaveAttribute("data-pill", "empty");

    rerender(<ReviewPill result={{ errors: [{ path: "a", message: "m" }], emptyCount: 4 }} />);
    expect(screen.getByText("1 issue")).toHaveAttribute("data-pill", "issues");

    rerender(
      <ReviewPill
        result={{ errors: [{ path: "a", message: "m" }, { path: "b", message: "m" }], emptyCount: 0 }}
      />,
    );
    expect(screen.getByText("2 issues")).toBeInTheDocument();

    rerender(<ReviewPill result={null} />);
    expect(screen.getByText("Not included")).toHaveAttribute("data-pill", "excluded");
  });
});

describe("useStepValidations", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("computes synchronously on mount and recomputes 300 ms after a change", () => {
    const { result } = renderHook(() => {
      const form = useForm<InspectionFormData>({ defaultValues: getDefaultFormValues("") });
      const validations = useStepValidations(form.control);
      return { form, validations };
    });

    // Fresh defaults: facilityName + inspectorName missing → 2 issues in step 0
    expect(result.current.validations[0].errors).toHaveLength(2);

    act(() => {
      result.current.form.setValue("facilityInfo.facilityName", "Smith Residence");
      result.current.form.setValue("facilityInfo.inspectorName", "Dan");
    });
    // Debounced: unchanged until the timer fires
    expect(result.current.validations[0].errors).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(result.current.validations[0].errors).toHaveLength(0);
  });
});
