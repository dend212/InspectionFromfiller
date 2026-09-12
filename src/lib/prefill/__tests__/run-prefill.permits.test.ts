import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLoadRunRow,
  mockUpdateRun,
  mockRunAssessorStage,
  mockRunListingStage,
  mockRunPermitsStage,
  mockRunPermitsSelection,
} = vi.hoisted(() => ({
  mockLoadRunRow: vi.fn(),
  mockUpdateRun: vi.fn(),
  mockRunAssessorStage: vi.fn(),
  mockRunListingStage: vi.fn(),
  mockRunPermitsStage: vi.fn(),
  mockRunPermitsSelection: vi.fn(),
}));

vi.mock("@/lib/prefill/run-store", () => ({
  loadRunRow: mockLoadRunRow,
  updateRun: mockUpdateRun,
  setInspectionApnIfNull: vi.fn(async () => undefined),
}));
vi.mock("@/lib/prefill/assessor", () => ({ runAssessorStage: mockRunAssessorStage }));
vi.mock("@/lib/prefill/listing", () => ({ runListingStage: mockRunListingStage }));
vi.mock("@/lib/prefill/permits", () => ({
  runPermitsStage: mockRunPermitsStage,
  runPermitsSelection: mockRunPermitsSelection,
}));

import {
  GENERIC_RUN_ERROR,
  continuePrefillAfterSelection,
  runPrefill,
} from "@/lib/prefill/run-prefill";
import type { StageContext } from "@/lib/prefill/stage";
import type { PermitCandidate, PrefillInput, ProposedField } from "@/lib/prefill/types";

const RUN = {
  id: "run-1",
  inspectionId: "insp-1",
  trigger: "manual",
  status: "queued",
  input: { apn: "219-11-121", address: { streetNumber: "8911", streetName: "Princess Dr" } },
  stages: {},
  proposals: [],
  candidates: [],
  error: null,
  appliedAt: null,
  createdBy: "user-1",
  createdAt: new Date(),
  finishedAt: null,
};

const CANDIDATE: PermitCandidate = {
  key: "edms_env:OWR-20-04198:NOTICE OF TRANSFER:2020-10-27",
  archive: "edms_env",
  permitNumber: "OWR-20-04198",
  docType: "NOTICE OF TRANSFER",
  docDate: "2020-10-27",
  streetAddress: "8911 E PRINCESS DR",
  city: "MESA",
  zip: "85207",
  score: 7,
};

const ASSESSOR_PROPOSAL: ProposedField = {
  fieldPath: "facilityInfo.taxParcelNumber",
  value: "219-11-121",
  kind: "fill",
  provenance: { source: "assessor", confidence: 1, explanation: "Assessor" },
};

const PERMIT_PROPOSAL: ProposedField = {
  fieldPath: "facilityInfo.recordsAvailable",
  value: "yes",
  kind: "fill",
  provenance: { source: "permit", confidence: 1, explanation: "Permit found" },
};

function lastPatch() {
  const call = mockUpdateRun.mock.calls[mockUpdateRun.mock.calls.length - 1];
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadRunRow.mockResolvedValue(RUN);
  mockUpdateRun.mockResolvedValue(undefined);
  mockRunAssessorStage.mockResolvedValue({
    stage: { status: "done", summary: "Parcel 219-11-121", links: [] },
    proposals: [ASSESSOR_PROPOSAL],
  });
  mockRunListingStage.mockResolvedValue({
    stage: { status: "skipped", summary: "Not available yet", links: [] },
    proposals: [],
  });
  mockRunPermitsStage.mockResolvedValue({
    stage: { status: "done", summary: "1 permit document found: 000972 PERMIT", links: [] },
    proposals: [PERMIT_PROPOSAL],
  });
  mockRunPermitsSelection.mockResolvedValue({
    stage: {
      status: "done",
      summary: "1 permit document found: OWR-20-04198 NOTICE OF TRANSFER",
      links: [],
    },
    proposals: [PERMIT_PROPOSAL],
  });
});

describe("runPrefill — permits stage", () => {
  it("passes the run input and a StageContext to the permits stage and finishes done", async () => {
    await runPrefill("run-1");

    const [input, ctx] = mockRunPermitsStage.mock.calls[0] as [PrefillInput, StageContext];
    expect(input).toEqual(RUN.input);
    expect(ctx).toMatchObject({ inspectionId: "insp-1", runId: "run-1" });
    expect(ctx.signal).toBeInstanceOf(AbortSignal);

    const final = lastPatch();
    expect(final.status).toBe("done");
    expect(final.stages.permits.summary).toContain("000972");
    expect(final.proposals).toEqual([ASSESSOR_PROPOSAL, PERMIT_PROPOSAL]);
    expect(final.candidates).toEqual([]);
    expect(final.finishedAt).toBeInstanceOf(Date);
  });

  it("persists a permits progress update mid-run", async () => {
    mockRunPermitsStage.mockImplementationOnce(async (_input: PrefillInput, ctx: StageContext) => {
      await ctx.progress({ status: "running", summary: "Searching Maricopa EDMS…" });
      return { stage: { status: "done", summary: "0", links: [] }, proposals: [] };
    });
    await runPrefill("run-1");
    const progressCall = mockUpdateRun.mock.calls.find(
      (c) => c[1].stages?.permits?.summary === "Searching Maricopa EDMS…",
    );
    expect(progressCall).toBeDefined();
  });

  it("moves the run to awaiting_selection with the candidates when the stage returns them", async () => {
    mockRunPermitsStage.mockResolvedValueOnce({
      stage: { status: "pending", summary: "3 possible permits — pick the right one", links: [] },
      proposals: [],
      candidates: [CANDIDATE],
    });
    await runPrefill("run-1");
    const final = lastPatch();
    expect(final).toMatchObject({
      status: "awaiting_selection",
      candidates: [CANDIDATE],
      finishedAt: null,
    });
    // assessor proposals are persisted now so the client can apply them while waiting
    expect(final.proposals).toEqual([ASSESSOR_PROPOSAL]);
    expect(final.stages.permits.status).toBe("pending");
  });
});

describe("continuePrefillAfterSelection", () => {
  it("re-runs the permit search for the chosen keys and merges proposals", async () => {
    mockLoadRunRow.mockResolvedValueOnce({
      ...RUN,
      status: "running",
      candidates: [CANDIDATE],
      proposals: [ASSESSOR_PROPOSAL],
      stages: {
        assessor: { status: "done", links: [] },
        listing: { status: "skipped", links: [] },
        permits: { status: "pending", links: [] },
      },
    });
    await continuePrefillAfterSelection("run-1", [CANDIDATE.key]);

    expect(mockRunPermitsSelection).toHaveBeenCalledTimes(1);
    const [input, ctx, keys] = mockRunPermitsSelection.mock.calls[0] as [
      PrefillInput,
      StageContext,
      string[],
    ];
    expect(input).toEqual(RUN.input);
    expect(ctx).toMatchObject({ inspectionId: "insp-1", runId: "run-1" });
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
    expect(keys).toEqual([CANDIDATE.key]);

    const final = lastPatch();
    expect(final).toMatchObject({ status: "done", candidates: [] });
    expect(final.finishedAt).toBeInstanceOf(Date);
    expect(final.stages.assessor.status).toBe("done");
    expect(final.stages.permits.summary).toContain("OWR-20-04198");
    expect(final.proposals).toEqual([ASSESSOR_PROPOSAL, PERMIT_PROPOSAL]);
    expect(mockRunPermitsStage).not.toHaveBeenCalled();
  });

  it("replaces stale permit proposals from the first pass with the selection's", async () => {
    const stalePermit: ProposedField = {
      ...PERMIT_PROPOSAL,
      value: "no",
      provenance: { source: "permit", confidence: 0.6, explanation: "Stale" },
    };
    mockLoadRunRow.mockResolvedValueOnce({
      ...RUN,
      status: "running",
      proposals: [ASSESSOR_PROPOSAL, stalePermit],
    });
    await continuePrefillAfterSelection("run-1", [CANDIDATE.key]);
    expect(lastPatch().proposals).toEqual([ASSESSOR_PROPOSAL, PERMIT_PROPOSAL]);
  });

  it("persists permit progress while the selection is being fetched", async () => {
    mockLoadRunRow.mockResolvedValueOnce({ ...RUN, status: "running" });
    mockRunPermitsSelection.mockImplementationOnce(
      async (_i: PrefillInput, ctx: StageContext) => {
        await ctx.progress({ status: "running", summary: "Fetching the selected permits…" });
        return { stage: { status: "done", links: [] }, proposals: [] };
      },
    );
    await continuePrefillAfterSelection("run-1", [CANDIDATE.key]);
    expect(
      mockUpdateRun.mock.calls.find(
        (c) => c[1].stages?.permits?.summary === "Fetching the selected permits…",
      ),
    ).toBeDefined();
  });

  it("does nothing when the run is missing or not running", async () => {
    mockLoadRunRow.mockResolvedValueOnce(null);
    await continuePrefillAfterSelection("run-1", [CANDIDATE.key]);
    mockLoadRunRow.mockResolvedValueOnce({ ...RUN, status: "done" });
    await continuePrefillAfterSelection("run-1", [CANDIDATE.key]);
    expect(mockRunPermitsSelection).not.toHaveBeenCalled();
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });

  it("marks the run failed with a generic message if the continuation throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("unexpected: connection refused at 10.0.0.1:5432");
    mockLoadRunRow.mockResolvedValueOnce({ ...RUN, status: "running" });
    mockRunPermitsSelection.mockRejectedValueOnce(boom);
    await expect(continuePrefillAfterSelection("run-1", [CANDIDATE.key])).resolves.toBeUndefined();
    // Internal error text never reaches the tile — same rule as runPrefill
    expect(lastPatch()).toMatchObject({ status: "failed", error: GENERIC_RUN_ERROR });
    expect(lastPatch().finishedAt).toBeInstanceOf(Date);
    expect(errorSpy).toHaveBeenCalledWith("[prefill] run failed", "run-1", boom);
    errorSpy.mockRestore();
  });

  it("swallows a load failure", async () => {
    mockLoadRunRow.mockRejectedValueOnce(new Error("db down"));
    await expect(continuePrefillAfterSelection("run-1", [CANDIDATE.key])).resolves.toBeUndefined();
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });
});
