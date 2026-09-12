import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StageContext } from "@/lib/prefill/stage";
import type { PrefillInput, PrefillStage, ProposedField } from "@/lib/prefill/types";

// ---------------------------------------------------------------------------
// Mocks — same shape as run-prefill.test.ts / run-prefill.listing.test.ts: the
// orchestrator only reaches the DB through run-store, so that is what we mock.
// ---------------------------------------------------------------------------

const {
  mockLoadRunRow,
  mockUpdateRun,
  mockSetInspectionApnIfNull,
  mockRunAssessorStage,
  mockRunListingStage,
  mockRunPermitsStage,
  mockRunPermitsSelection,
} = vi.hoisted(() => ({
  mockLoadRunRow: vi.fn(),
  mockUpdateRun: vi.fn(),
  mockSetInspectionApnIfNull: vi.fn(),
  mockRunAssessorStage: vi.fn(),
  mockRunListingStage: vi.fn(),
  mockRunPermitsStage: vi.fn(),
  mockRunPermitsSelection: vi.fn(),
}));

vi.mock("@/lib/prefill/run-store", () => ({
  loadRunRow: mockLoadRunRow,
  updateRun: mockUpdateRun,
  setInspectionApnIfNull: mockSetInspectionApnIfNull,
}));
vi.mock("@/lib/prefill/assessor", () => ({ runAssessorStage: mockRunAssessorStage }));
vi.mock("@/lib/prefill/listing", () => ({ runListingStage: mockRunListingStage }));
vi.mock("@/lib/prefill/permits", () => ({
  runPermitsStage: mockRunPermitsStage,
  runPermitsSelection: mockRunPermitsSelection,
}));

import { runPrefill } from "@/lib/prefill/run-prefill";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RUN_ID = "run-1";
const APN_ONLY: PrefillInput = { apn: "219-11-121" };
const RESOLVED_ADDRESS = {
  streetNumber: "8911",
  streetDir: "E",
  streetName: "CAVE CREEK RD",
  city: "CAREFREE",
  zip: "85377",
  full: "8911 E CAVE CREEK RD, CAREFREE, AZ 85377",
};
const WITH_ADDRESS: PrefillInput = {
  apn: "219-11-121",
  address: { streetNumber: "8911", streetDir: "E", streetName: "Cave Creek Rd", city: "Carefree", zip: "85377" },
};

function doneStage(summary: string): PrefillStage {
  const at = new Date().toISOString();
  return { status: "done", startedAt: at, finishedAt: at, summary, links: [] };
}

function skippedStage(summary: string): PrefillStage {
  const at = new Date().toISOString();
  return { status: "skipped", startedAt: at, finishedAt: at, summary, links: [] };
}

const ASSESSOR_PROPOSAL: ProposedField = {
  fieldPath: "facilityInfo.taxParcelNumber",
  value: "219-11-121",
  kind: "fill",
  provenance: { source: "assessor", confidence: 1, explanation: "Assessor" },
};
const LISTING_PROPOSAL: ProposedField = {
  fieldPath: "facilityInfo.waterSource",
  value: "private_well",
  kind: "fill",
  provenance: { source: "listing", confidence: 0.8, explanation: "Zillow" },
};

/** The assessor stage's result when the parcel resolves, including the situs address it found */
function assessorFound() {
  return {
    stage: doneStage("Parcel 219-11-121 · 8911 E CAVE CREEK RD"),
    proposals: [ASSESSOR_PROPOSAL],
    resolved: {
      apn: "219-11-121",
      address: RESOLVED_ADDRESS,
      subdivision: "CAVE CREEK ESTATES",
      lot: "4",
    },
  };
}

type RunPatch = {
  status?: string;
  input?: PrefillInput;
  stages?: Record<string, PrefillStage>;
  proposals?: ProposedField[];
};

function patches(): RunPatch[] {
  return mockUpdateRun.mock.calls.map((c) => c[1] as RunPatch);
}

function lastPatch(): RunPatch {
  const all = patches();
  return all[all.length - 1];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeRun(input: PrefillInput) {
  return {
    id: RUN_ID,
    inspectionId: "insp-1",
    trigger: "manual",
    status: "queued",
    input,
    stages: {},
    proposals: [],
    candidates: [],
    error: null,
    appliedAt: null,
    createdBy: null,
    createdAt: new Date(),
    finishedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadRunRow.mockResolvedValue(makeRun(APN_ONLY));
  mockUpdateRun.mockResolvedValue(undefined);
  mockSetInspectionApnIfNull.mockResolvedValue(undefined);
  mockRunAssessorStage.mockResolvedValue(assessorFound());
  mockRunListingStage.mockImplementation(async (input: PrefillInput) =>
    input.address
      ? { stage: doneStage("Water: Private Well"), proposals: [LISTING_PROPOSAL] }
      : { stage: skippedStage("No address to search"), proposals: [] },
  );
  mockRunPermitsStage.mockResolvedValue({
    stage: doneStage("1 permit found"),
    proposals: [],
    candidates: [],
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPrefill — APN-only input (D2)", () => {
  it("runs the assessor first and hands its resolved address to listing and permits", async () => {
    const assessor = deferred<ReturnType<typeof assessorFound>>();
    mockRunAssessorStage.mockReturnValue(assessor.promise);

    const run = runPrefill(RUN_ID);
    // Let the orchestrator get past the `running` update and start the assessor
    await vi.waitFor(() => expect(mockRunAssessorStage).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    // Neither dependent stage may start before the assessor has resolved
    expect(mockRunListingStage).not.toHaveBeenCalled();
    expect(mockRunPermitsStage).not.toHaveBeenCalled();

    assessor.resolve(assessorFound());
    await run;

    expect(mockRunAssessorStage.mock.calls[0][0]).toEqual(APN_ONLY);
    const expectedInput: PrefillInput = {
      apn: "219-11-121",
      address: RESOLVED_ADDRESS,
      subdivision: "CAVE CREEK ESTATES",
      lot: "4",
    };
    expect(mockRunListingStage).toHaveBeenCalledTimes(1);
    expect(mockRunListingStage.mock.calls[0][0]).toEqual(expectedInput);
    expect(mockRunPermitsStage).toHaveBeenCalledTimes(1);
    expect(mockRunPermitsStage.mock.calls[0][0]).toEqual(expectedInput);

    const final = lastPatch();
    expect(final.status).toBe("done");
    expect(final.stages?.assessor).toMatchObject({ status: "done" });
    expect(final.stages?.listing).toMatchObject({ status: "done", summary: "Water: Private Well" });
    expect(final.stages?.permits).toMatchObject({ status: "done" });
    expect(final.proposals).toEqual(expect.arrayContaining([ASSESSOR_PROPOSAL, LISTING_PROPOSAL]));
  });

  it("persists the assessor-derived address on the run's input so the tile can show what was searched", async () => {
    await runPrefill(RUN_ID);

    const echo = patches().find((p) => p.input?.address);
    expect(echo).toBeDefined();
    expect(echo?.input).toEqual({
      apn: "219-11-121",
      address: RESOLVED_ADDRESS,
      subdivision: "CAVE CREEK ESTATES",
      lot: "4",
    });
    // The assessor's finished stage is part of the same snapshot
    expect(echo?.stages?.assessor).toMatchObject({ status: "done" });
  });

  it("shares one abort signal across the sequential assessor and the parallel stages", async () => {
    await runPrefill(RUN_ID);
    const assessorCtx = mockRunAssessorStage.mock.calls[0][1] as StageContext;
    const listingCtx = mockRunListingStage.mock.calls[0][1] as StageContext;
    const permitsCtx = mockRunPermitsStage.mock.calls[0][1] as StageContext;
    expect(listingCtx.signal).toBe(assessorCtx.signal);
    expect(permitsCtx.signal).toBe(assessorCtx.signal);
    expect(assessorCtx.signal.aborted).toBe(false);
  });

  it("still runs listing and permits with the APN-only input when the assessor finds nothing", async () => {
    mockRunAssessorStage.mockResolvedValue({
      stage: { ...doneStage("No parcel found (searched APN 219-11-121)"), status: "not_found" },
      proposals: [],
    });

    await runPrefill(RUN_ID);

    expect(mockRunListingStage).toHaveBeenCalledTimes(1);
    expect(mockRunListingStage.mock.calls[0][0]).toEqual(APN_ONLY);
    expect(mockRunPermitsStage).toHaveBeenCalledTimes(1);
    expect(mockRunPermitsStage.mock.calls[0][0]).toEqual(APN_ONLY);
    expect(patches().some((p) => p.input)).toBe(false);

    const final = lastPatch();
    expect(final.status).toBe("done");
    expect(final.stages?.assessor).toMatchObject({ status: "not_found" });
    expect(final.stages?.listing).toMatchObject({ status: "skipped", summary: "No address to search" });
    expect(final.stages?.permits).toMatchObject({ status: "done" });
  });

  it("still runs listing and permits with the APN-only input when the assessor rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRunAssessorStage.mockRejectedValue(new Error("ECONNREFUSED"));

    await runPrefill(RUN_ID);

    expect(mockRunListingStage.mock.calls[0][0]).toEqual(APN_ONLY);
    expect(mockRunPermitsStage.mock.calls[0][0]).toEqual(APN_ONLY);
    const final = lastPatch();
    expect(final.status).toBe("done");
    expect(final.stages?.assessor).toMatchObject({ status: "error" });
    expect(final.stages?.listing).toMatchObject({ status: "skipped" });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("writes the resolved dashed APN to inspections.apn (only when the column is null)", async () => {
    await runPrefill(RUN_ID);
    expect(mockSetInspectionApnIfNull).toHaveBeenCalledTimes(1);
    expect(mockSetInspectionApnIfNull).toHaveBeenCalledWith("insp-1", "219-11-121");
  });

  it("normalises a compact input APN to the dashed form before writing it", async () => {
    mockLoadRunRow.mockResolvedValue(makeRun({ apn: "21911121" }));
    mockRunAssessorStage.mockResolvedValue({
      stage: { ...doneStage("No parcel found"), status: "not_found" },
      proposals: [],
    });
    await runPrefill(RUN_ID);
    expect(mockSetInspectionApnIfNull).toHaveBeenCalledWith("insp-1", "219-11-121");
  });

  it("a failed apn write is logged and never fails the run", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSetInspectionApnIfNull.mockRejectedValue(new Error("db down"));
    await runPrefill(RUN_ID);
    expect(lastPatch().status).toBe("done");
    expect(errorSpy).toHaveBeenCalledWith(
      "[prefill] could not record inspection apn",
      RUN_ID,
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});

describe("runPrefill — input already has a street address", () => {
  beforeEach(() => {
    mockLoadRunRow.mockResolvedValue(makeRun(WITH_ADDRESS));
  });

  it("starts all three stages concurrently — listing is entered before the assessor resolves", async () => {
    const assessor = deferred<ReturnType<typeof assessorFound>>();
    mockRunAssessorStage.mockReturnValue(assessor.promise);

    const run = runPrefill(RUN_ID);
    await vi.waitFor(() => {
      expect(mockRunListingStage).toHaveBeenCalledTimes(1);
      expect(mockRunPermitsStage).toHaveBeenCalledTimes(1);
    });
    // Assessor is still pending at this point — the dependent stages did not wait for it
    assessor.resolve(assessorFound());
    await run;

    expect(mockRunListingStage.mock.calls[0][0]).toEqual(WITH_ADDRESS);
    expect(mockRunPermitsStage.mock.calls[0][0]).toEqual(WITH_ADDRESS);
    expect(patches().some((p) => p.input)).toBe(false);
    expect(lastPatch().status).toBe("done");
  });

  it("writes the APN the assessor confirmed to inspections.apn", async () => {
    mockLoadRunRow.mockResolvedValue(makeRun({ address: WITH_ADDRESS.address }));
    await runPrefill(RUN_ID);
    expect(mockSetInspectionApnIfNull).toHaveBeenCalledWith("insp-1", "219-11-121");
  });

  it("does not touch inspections.apn when no APN was given or resolved", async () => {
    mockLoadRunRow.mockResolvedValue(makeRun({ address: WITH_ADDRESS.address }));
    mockRunAssessorStage.mockResolvedValue({
      stage: { ...doneStage("No parcel found"), status: "not_found" },
      proposals: [],
    });
    await runPrefill(RUN_ID);
    expect(mockSetInspectionApnIfNull).not.toHaveBeenCalled();
  });
});
