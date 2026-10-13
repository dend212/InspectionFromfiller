import { act, render, screen } from "@testing-library/react";
import { FormProvider, type UseFormReturn, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hiddenOnly,
  hiddenTail,
  MATCH_ANNOUNCEMENT,
  MATCH_DEBOUNCE_MS,
  MORE_MATCHES,
  PICKER_HEADER_MULTIPLE,
  PICKER_HEADER_SINGLE,
  PossibleDuplicateNotice,
  PossibleDuplicateWarning,
} from "@/components/inspection/possible-duplicate-warning";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";
import type { InspectionMatchResult, VisibleInspectionMatch } from "@/types/inspection-matches";

// Synthetic fixtures only (spec §12)
const INSPECTION_ID = "6f1c2a9e-0000-4000-8000-0000000000aa";

function match(over: Partial<VisibleInspectionMatch> = {}): VisibleInspectionMatch {
  return {
    inspectionId: "6f1c2a9e-0000-4000-8000-000000000001",
    href: "/review/6f1c2a9e-0000-4000-8000-000000000001",
    status: "completed",
    facilityAddress: "100 E Example Rd",
    facilityCity: "Cave Creek",
    inspectionDate: "2026-10-06",
    createdAt: "2026-10-06T19:12:00.000Z",
    inspectorName: "Sam Sample",
    isOwn: false,
    reasons: ["apn", "address"],
    ...over,
  };
}

const result = (over: Partial<InspectionMatchResult> = {}): InspectionMatchResult => ({
  matches: [match()],
  hiddenCount: 0,
  truncated: false,
  ...over,
});

describe("PossibleDuplicateNotice", () => {
  it("one visible match: the whole box is ONE new-tab link with the header and detail line", () => {
    render(<PossibleDuplicateNotice result={result()} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    const link = links[0];
    expect(link).toHaveAttribute("href", "/review/6f1c2a9e-0000-4000-8000-000000000001");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAccessibleName(/This address and APN may match another report/);
    expect(link).toHaveAccessibleName(/\(opens in a new tab\)/);
    expect(link).toHaveTextContent(
      "100 E Example Rd, Cave Creek · Completed · Inspected Oct 6, 2026 · Sam Sample · Same APN and address",
    );
  });

  it("names only the APN or only the address when that is all that matched", () => {
    const { rerender } = render(<PossibleDuplicateNotice result={result({ matches: [match({ reasons: ["apn"] })] })} />);
    expect(screen.getByRole("link")).toHaveAccessibleName(/^This APN may match another report/);
    rerender(<PossibleDuplicateNotice result={result({ matches: [match({ reasons: ["address"] })] })} />);
    expect(screen.getByRole("link")).toHaveAccessibleName(/^This address may match another report/);
  });

  it("falls back to Created … in America/Phoenix without an inspection date", () => {
    render(
      <PossibleDuplicateNotice result={result({ matches: [match({ inspectionDate: null, createdAt: "2026-10-02T00:00:00.000Z" })] })} />,
    );
    expect(screen.getByRole("link")).toHaveTextContent("Created Oct 1, 2026");
  });

  it("several matches: plain-text header and one link per item", () => {
    render(
      <PossibleDuplicateNotice
        result={result({ matches: [match(), match({ inspectionId: "m2", href: "/review/m2", reasons: ["address"] })] })}
      />,
    );
    const header = screen.getByText("This address and APN may match other reports:");
    expect(header.closest("a")).toBeNull();
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/review/6f1c2a9e-0000-4000-8000-000000000001", "/review/m2"]);
    for (const link of links) expect(link).toHaveAttribute("target", "_blank");
  });

  it("hidden only: no link, the exact count copy, and no detail at all", () => {
    const { container } = render(<PossibleDuplicateNotice result={result({ matches: [], hiddenCount: 1 })} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(hiddenOnly(1))).toBeInTheDocument();
    expect(container).not.toHaveTextContent("Example");
    expect(hiddenOnly(3)).toBe("May match 3 reports by other inspectors");
  });

  it("mixed: links, then the hidden tail; truncated adds the more line", () => {
    render(<PossibleDuplicateNotice result={result({ hiddenCount: 2, truncated: true })} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText(hiddenTail(2))).toBeInTheDocument();
    expect(screen.getByText(MORE_MATCHES)).toBeInTheDocument();
    expect(hiddenTail(1)).toBe("+ 1 more by another inspector");
  });

  it("renders nothing for an empty result", () => {
    const { container } = render(<PossibleDuplicateNotice result={result({ matches: [] })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("compact variant uses the picker copy", () => {
    const { rerender } = render(<PossibleDuplicateNotice result={result()} variant="compact" />);
    expect(screen.getByRole("link")).toHaveAccessibleName(new RegExp(`^${PICKER_HEADER_SINGLE}`));
    rerender(<PossibleDuplicateNotice result={result({ matches: [match(), match({ inspectionId: "m2" })] })} variant="compact" />);
    expect(screen.getByText(PICKER_HEADER_MULTIPLE)).toBeInTheDocument();
  });
});

describe("PossibleDuplicateWarning (container)", () => {
  const fetchMock = vi.fn();
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  let form: UseFormReturn<InspectionFormData> | undefined;

  function Harness({ facility = {}, disabled = false }: { facility?: Record<string, string>; disabled?: boolean }) {
    const defaults = getDefaultFormValues("Tech") as unknown as InspectionFormData;
    const methods = useForm<InspectionFormData>({
      defaultValues: { ...defaults, facilityInfo: { ...defaults.facilityInfo, ...facility } },
    });
    form = methods;
    return (
      <FormProvider {...methods}>
        <fieldset disabled={disabled}>
          <PossibleDuplicateWarning inspectionId={INSPECTION_ID} />
        </fieldset>
      </FormProvider>
    );
  }

  const ADDRESS = { facilityAddress: "100 E Example Rd", facilityCity: "Cave Creek", facilityZip: "85331" };
  const flush = () => act(async () => {});
  const advance = (ms: number) => act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  const setField = (name: "facilityAddress" | "taxParcelNumber" | "facilityCity", value: string) =>
    act(() => {
      form?.setValue(`facilityInfo.${name}`, value);
    });
  const sentBody = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body as string);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(ok(result()));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    form = undefined;
  });

  it("no request for a blank draft", async () => {
    render(<Harness />);
    await advance(MATCH_DEBOUNCE_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("checks at once on mount with the trimmed values and shows the notice", async () => {
    render(<Harness facility={{ ...ADDRESS, facilityAddress: "  100 E Example Rd ", taxParcelNumber: "123-45-678" }} />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/inspections/${INSPECTION_ID}/matches`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(sentBody(0)).toEqual({ ...ADDRESS, taxParcelNumber: "123-45-678" });
    expect(screen.getByRole("link")).toHaveAttribute("target", "_blank");
  });

  it("debounces a changed address, and a suffix-only edit (Rd → Road) sends nothing", async () => {
    render(<Harness facility={ADDRESS} />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await setField("facilityAddress", "100 E Example Road");
    await advance(MATCH_DEBOUNCE_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link")).toBeInTheDocument();

    await setField("facilityAddress", "102 E Example Rd");
    await advance(MATCH_DEBOUNCE_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(1).facilityAddress).toBe("102 E Example Rd");
  });

  it("an APN set through form.setValue (as APN Lookup does) triggers a check", async () => {
    render(<Harness />);
    await flush();
    await setField("taxParcelNumber", "123-45-678");
    await advance(MATCH_DEBOUNCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody(0).taxParcelNumber).toBe("123-45-678");
  });

  it("removes the old notice at once when the key changes, before the new check answers", async () => {
    render(<Harness facility={ADDRESS} />);
    await flush();
    expect(screen.getByRole("link")).toBeInTheDocument();
    await setField("facilityAddress", "104 E Example Rd");
    expect(screen.queryByRole("link")).toBeNull();
    fetchMock.mockResolvedValueOnce(ok(result({ matches: [] })));
    await advance(MATCH_DEBOUNCE_MS);
    expect(screen.queryByRole("link")).toBeNull();
    // Restoring the old values does not bring the old notice back before the new check answers
    await setField("facilityAddress", "100 E Example Rd");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("ignores a stale response that arrives after a newer key", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    render(<Harness facility={ADDRESS} />);
    await flush();
    await setField("facilityAddress", "106 E Example Rd");
    fetchMock.mockResolvedValueOnce(ok(result({ matches: [] })));
    await advance(MATCH_DEBOUNCE_MS);
    await act(async () => {
      resolveFirst(ok(result()));
    });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("aborts the request on unmount", async () => {
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const { unmount } = render(<Harness facility={ADDRESS} />);
    await flush();
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it.each([
    ["a 500", () => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "x" }) })],
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a 200 with {}", () => Promise.resolve(ok({}))],
    ["a 200 with []", () => Promise.resolve(ok([]))],
    ["a reply without json()", () => Promise.resolve({ ok: true, status: 200, text: async () => "" })],
  ])("%s renders nothing and does not throw", async (_label, reply) => {
    fetchMock.mockImplementationOnce(reply);
    const { container } = render(<Harness facility={ADDRESS} />);
    await flush();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector('[data-slot="possible-duplicate-warning"]')).toBeNull();
  });

  it("slices each value to 1,000 characters before sending", async () => {
    render(<Harness facility={{ ...ADDRESS, facilityCity: "c".repeat(1500) }} />);
    await flush();
    expect(sentBody(0).facilityCity).toHaveLength(1000);
  });

  it("keeps a polite live region in the tree before any result, then announces a match", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    const { container } = render(<Harness facility={ADDRESS} />);
    const region = container.querySelector('[data-slot="possible-duplicate-announcement"]');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeVisible();
    expect(region).toHaveTextContent("");
    await act(async () => {
      resolveFirst(ok(result({ matches: [], hiddenCount: 1 })));
    });
    expect(region).toHaveTextContent(MATCH_ANNOUNCEMENT);
  });

  it("still links from inside a disabled fieldset (read-only review)", async () => {
    render(<Harness facility={ADDRESS} disabled />);
    await flush();
    const link = screen.getByRole("link");
    expect(link.closest("fieldset")).toBeDisabled();
    expect(link).toHaveAttribute("href", "/review/6f1c2a9e-0000-4000-8000-000000000001");
  });
});
