import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrefillPanel } from "@/components/prefill/prefill-panel";
import { ProvenanceProvider } from "@/components/prefill/provenance-context";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/inspection/scan-form-button", () => ({
  ScanFormButton: () => <button type="button">Scan Paper Form</button>,
}));

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

function Harness({ facility }: { facility?: Partial<InspectionFormData["facilityInfo"]> }) {
  const defaults = getDefaultFormValues("Tech") as unknown as InspectionFormData;
  const form = useForm<InspectionFormData>({
    defaultValues: { ...defaults, facilityInfo: { ...defaults.facilityInfo, ...facility } },
  });
  const taxParcelNumber = form.watch("facilityInfo.taxParcelNumber");
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={{}}>
      <PrefillPanel inspectionId="insp-1" form={form} initialRun={null} />
      <output data-testid="tax-parcel-number">{taxParcelNumber}</output>
    </ProvenanceProvider>
  );
}

function prefillPostBodies(mock: ReturnType<typeof vi.fn>): unknown[] {
  return mock.mock.calls
    .filter(([url, init]) => init?.method === "POST" && url === "/api/inspections/insp-1/prefill")
    .map(([, init]) => JSON.parse(String(init?.body)));
}

function installFetch(opts: { runStatus?: "running" | "done" } = {}) {
  const runStatus = opts.runStatus ?? "running";
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.startsWith("/api/apn-lookup")) {
      return { ok: true, status: 200, json: () => Promise.resolve({ assessor: ASSESSOR }) };
    }
    if (method === "POST" && url === "/api/inspections/insp-1/prefill") {
      return { ok: true, status: 201, json: () => Promise.resolve({ runId: "run-1" }) };
    }
    if (method === "GET" && url === "/api/inspections/insp-1/prefill/run-1") {
      return {
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "run-1",
            inspectionId: "insp-1",
            trigger: "apn_lookup",
            status: runStatus,
            input: {},
            stages: {
              assessor: { status: runStatus, links: [] },
              listing: { status: runStatus === "done" ? "skipped" : "pending", links: [] },
              permits: { status: runStatus === "done" ? "not_found" : "pending", links: [] },
            },
            proposals: [],
            candidates: [],
            error: null,
            appliedAt: null,
            createdAt: "2026-09-11T10:00:00.000Z",
            finishedAt: null,
            records: [],
          }),
      };
    }
    if (method === "PATCH" && url === "/api/inspections/insp-1/provenance") {
      return { ok: true, status: 200, json: () => Promise.resolve({ saved: true }) };
    }
    return {
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "no route" }),
      text: () => Promise.resolve('{"error":"no route"}'),
    };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

// Unmount before the fetch stub is torn down — see apn-lookup-provenance.test.tsx.
// The panel also polls a running run on an interval; unmounting here clears it.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PrefillPanel", () => {
  it("renders the toolbar and the tile", () => {
    installFetch();
    render(<Harness />);
    expect(screen.getByLabelText("Assessor Parcel Number")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /scan paper form/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /find records/i })).toBeInTheDocument();
  });

  it("auto-starts an apn_lookup run after a successful APN lookup", async () => {
    const mock = installFetch();
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText("Assessor Parcel Number"), "123-45-678");
    await user.click(screen.getByRole("button", { name: /apn lookup/i }));

    await waitFor(() => {
      const post = mock.mock.calls.find(
        ([url, init]) => init?.method === "POST" && url === "/api/inspections/insp-1/prefill",
      );
      expect(post).toBeDefined();
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({ apn: "123-45-678", trigger: "apn_lookup" });
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /searching/i })).toBeDisabled();
    });
  });

  it("a successful toolbar lookup writes the APN into the form's Tax Parcel Number, so a later Find records needs no apn", async () => {
    const mock = installFetch({ runStatus: "done" });
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText("Assessor Parcel Number"), "123-45-678");
    await user.click(screen.getByRole("button", { name: /apn lookup/i }));
    await waitFor(() => {
      expect(screen.getByTestId("tax-parcel-number")).toHaveTextContent("123-45-678");
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /find records/i })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: /find records/i }));
    await waitFor(() => {
      expect(prefillPostBodies(mock)).toEqual([
        { apn: "123-45-678", trigger: "apn_lookup" },
        { trigger: "manual" },
      ]);
    });
  });

  describe("Find records", () => {
    it("sends the toolbar box's APN when the form's Tax Parcel Number is empty", async () => {
      const mock = installFetch();
      const user = userEvent.setup();
      render(<Harness />);

      await user.type(screen.getByLabelText("Assessor Parcel Number"), "219-11-121");
      await user.click(screen.getByRole("button", { name: /find records/i }));

      await waitFor(() => {
        expect(prefillPostBodies(mock)).toEqual([{ apn: "219-11-121", trigger: "manual" }]);
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("prefers the form's Tax Parcel Number over the toolbar box", async () => {
      const mock = installFetch();
      const user = userEvent.setup();
      render(<Harness facility={{ taxParcelNumber: "123-45-678" }} />);

      await user.type(screen.getByLabelText("Assessor Parcel Number"), "219-11-121");
      await user.click(screen.getByRole("button", { name: /find records/i }));

      await waitFor(() => {
        expect(prefillPostBodies(mock)).toEqual([{ trigger: "manual" }]);
      });
    });

    it("starts a manual run without an apn when the box is empty and the form has a street address", async () => {
      const mock = installFetch();
      const user = userEvent.setup();
      render(<Harness facility={{ facilityAddress: "8911 E Cave Creek Rd" }} />);

      await user.click(screen.getByRole("button", { name: /find records/i }));

      await waitFor(() => {
        expect(prefillPostBodies(mock)).toEqual([{ trigger: "manual" }]);
      });
    });

    it("sends nothing and explains where to enter an APN when both the box and the form are empty", async () => {
      const mock = installFetch();
      const user = userEvent.setup();
      render(<Harness />);

      await user.click(screen.getByRole("button", { name: /find records/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Enter an APN in the box above or a street address in the form first",
      );
      expect(prefillPostBodies(mock)).toEqual([]);
      expect(screen.getByRole("button", { name: /find records/i })).toBeEnabled();
    });

    it("ignores toolbar text that is not a valid APN", async () => {
      const mock = installFetch();
      const user = userEvent.setup();
      render(<Harness />);

      await user.type(screen.getByLabelText("Assessor Parcel Number"), "not an apn");
      await user.click(screen.getByRole("button", { name: /find records/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/enter an apn in the box above/i);
      expect(prefillPostBodies(mock)).toEqual([]);
    });

    it("clears the inline message once a run starts", async () => {
      const mock = installFetch();
      const user = userEvent.setup();
      render(<Harness />);

      await user.click(screen.getByRole("button", { name: /find records/i }));
      expect(await screen.findByRole("alert")).toBeInTheDocument();

      await user.type(screen.getByLabelText("Assessor Parcel Number"), "219-11-121");
      await user.click(screen.getByRole("button", { name: /find records/i }));

      await waitFor(() => {
        expect(prefillPostBodies(mock)).toHaveLength(1);
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});
