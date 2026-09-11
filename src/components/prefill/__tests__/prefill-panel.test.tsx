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

function Harness() {
  const form = useForm<InspectionFormData>({
    defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
  });
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={{}}>
      <PrefillPanel inspectionId="insp-1" form={form} initialRun={null} />
    </ProvenanceProvider>
  );
}

function installFetch() {
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
            status: "running",
            input: {},
            stages: {
              assessor: { status: "running", links: [] },
              listing: { status: "pending", links: [] },
              permits: { status: "pending", links: [] },
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

  it("Find records starts a manual run", async () => {
    const mock = installFetch();
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /find records/i }));
    await waitFor(() => {
      const post = mock.mock.calls.find(
        ([url, init]) => init?.method === "POST" && url === "/api/inspections/insp-1/prefill",
      );
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({ trigger: "manual" });
    });
  });
});
