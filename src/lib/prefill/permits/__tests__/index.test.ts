// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StageContext } from "@/lib/prefill/stage";
import type { PermitCandidate } from "../../types";
import type { SearchHit } from "../candidates";
import type { StoreDocumentInput, StoreDocumentResult } from "../fetch-document";
import {
  type PermitsStageDeps,
  failedArchivesNote,
  notFoundSummary,
  runPermitsSelection,
  runPermitsStage,
} from "../index";
import { withExtraction } from "../with-extraction";

// index.ts → fetch-document.ts → run-store.ts → Drizzle; keep the DB out of the test process
vi.mock("@/lib/prefill/run-store", () => ({ createRecordRow: vi.fn() }));
// phase 3's hook reloads the run's rows through run-store (mocked above) — pass the stored result through
vi.mock("../with-extraction", () => ({
  withExtraction: vi.fn(async (_ctx: unknown, result: unknown) => result),
}));

function hit(over: Partial<PermitCandidate> & { permitNumber: string; docType: string }): SearchHit {
  const candidate: PermitCandidate = {
    key: `edms_env:${over.permitNumber}:${over.docType}:${over.docDate ?? ""}`,
    archive: "edms_env",
    streetAddress: "8911 W VILLA CHULA",
    city: "PEORIA",
    zip: "85383",
    apn: "200-08-079",
    score: 10,
    ...over,
  };
  return { candidate, documentId: `token-${over.permitNumber}` };
}

const PERMIT = hit({ permitNumber: "OW-17-00474", docType: "PERMIT", docDate: "2018-02-08" });
const TRANSFER = hit({
  permitNumber: "OWR-22-04475",
  docType: "NOTICE OF TRANSFER",
  docDate: "2022-09-21",
});
const ABANDON = hit({ permitNumber: "OWR-22-01512", docType: "ABANDONMENT", docDate: "2025-04-14" });
const PLAN = hit({ permitNumber: "OWR-23-02201", docType: "PLAN REVIEW", docDate: "2024-11-07" });

function makeCtx(): StageContext & { progress: ReturnType<typeof vi.fn>; controller: AbortController } {
  const controller = new AbortController();
  return {
    inspectionId: "insp-1",
    runId: "run-1",
    signal: controller.signal,
    progress: vi.fn().mockResolvedValue(undefined),
    controller,
  };
}

function storedResult(input: StoreDocumentInput, n: number): StoreDocumentResult {
  return {
    recordId: `rec-${n}`,
    stored: true,
    sizeBytes: 1000,
    pageCount: 8,
    extractionStatus: input.extractionStatus,
  };
}

function makeDeps(over: Partial<PermitsStageDeps> = {}): PermitsStageDeps & {
  storeDocument: ReturnType<typeof vi.fn>;
  searchPermits: ReturnType<typeof vi.fn>;
} {
  let n = 0;
  return {
    searchPermits: vi.fn().mockResolvedValue({ kind: "not_found", searched: [], failedArchives: [] }),
    storeDocument: vi.fn(async (input: StoreDocumentInput) => storedResult(input, ++n)),
    ...over,
  } as never;
}

const input = { apn: "200-08-079" };

describe("runPermitsStage", () => {
  let ctx: ReturnType<typeof makeCtx>;
  beforeEach(() => {
    ctx = makeCtx();
  });

  it("stores found documents in extraction rank order and proposes recordsAvailable = yes", async () => {
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "found",
        via: "apn",
        hits: [TRANSFER, PERMIT],
        searched: ["APN 200-08-079"],
        failedArchives: [],
      }),
    });
    const result = await runPermitsStage(input, ctx, deps);

    expect(deps.searchPermits).toHaveBeenCalledWith(input, ctx.signal);
    expect(deps.storeDocument).toHaveBeenCalledTimes(2);
    const calls = deps.storeDocument.mock.calls.map((c) => c[0] as StoreDocumentInput);
    expect(calls.map((c) => c.hit.candidate.permitNumber)).toEqual(["OW-17-00474", "OWR-22-04475"]);
    expect(calls.every((c) => c.extractionStatus === "pending")).toBe(true);
    expect(calls[0]).toMatchObject({ inspectionId: "insp-1", runId: "run-1", signal: ctx.signal });

    expect(result.stage.status).toBe("done");
    expect(result.stage.summary).toBe(
      "2 permit documents found: OW-17-00474 PERMIT, OWR-22-04475 NOTICE OF TRANSFER",
    );
    expect(result.stage.links.map((l) => l.url)).toEqual([
      "https://edms.maricopa.gov/env/",
      "https://edms.maricopa.gov/eplpav/",
    ]);
    expect(result.stage.startedAt).toBeTruthy();
    expect(result.stage.finishedAt).toBeTruthy();
    expect(result.stage.error).toBeUndefined();
    expect(result.candidates).toBeUndefined();

    expect(result.proposals).toEqual([
      {
        fieldPath: "facilityInfo.recordsAvailable",
        value: "yes",
        kind: "fill",
        provenance: {
          source: "permit",
          confidence: 1,
          explanation: "Permit OW-17-00474 (PERMIT) found on Maricopa EDMS",
          sourceUrl: "/api/inspections/insp-1/records/rec-1",
          recordId: "rec-1",
          runId: "run-1",
        },
      },
    ]);

    // progress: running → per-document download lines
    expect(ctx.progress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: "running", summary: "Searching Maricopa EDMS…" }),
    );
    expect(ctx.progress).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "Downloading 1 of 2: OW-17-00474 PERMIT…" }),
    );
    expect(ctx.progress).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "Downloading 2 of 2: OWR-22-04475 NOTICE OF TRANSFER…" }),
    );
  });

  it("captions recordsAvailable as a transfer record, not a permit, when the top-ranked hit is a Notice of Transfer", async () => {
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "found",
        via: "apn",
        hits: [
          hit({ permitNumber: "OWR-23-02001", docType: "NOTICE OF TRANSFER", docDate: "2023-06-07" }),
        ],
        searched: ["APN 200-08-079"],
        failedArchives: [],
      }),
    });
    const result = await runPermitsStage(input, ctx, deps);
    expect(result.proposals[0].provenance.explanation).toBe(
      "Notice of Transfer OWR-23-02001 found on Maricopa EDMS (transfer record — no permit found)",
    );
  });

  it("caps pending extraction at MAX_DOCUMENTS_PER_RUN and skips non-extractable types", async () => {
    const many = [
      PLAN,
      ABANDON,
      TRANSFER,
      PERMIT,
      hit({ permitNumber: "000972", docType: "PERMIT", docDate: "2015-09-11" }),
    ];
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "found",
        via: "apn",
        hits: many,
        searched: ["APN x"],
        failedArchives: [],
      }),
    });
    const result = await runPermitsStage(input, ctx, deps);
    const calls = deps.storeDocument.mock.calls.map((c) => c[0] as StoreDocumentInput);
    expect(
      calls.map((c) => [c.hit.candidate.permitNumber, c.extractionStatus, c.extractionError]),
    ).toEqual([
      ["OW-17-00474", "pending", null],
      ["000972", "pending", null],
      ["OWR-22-04475", "pending", null],
      ["OWR-22-01512", "skipped", "Over the 3-document extraction limit"],
      ["OWR-23-02201", "skipped", "PLAN REVIEW documents are not extracted"],
    ]);
    expect(result.stage.summary).toBe(
      "5 permit documents found: OW-17-00474 PERMIT, 000972 PERMIT, OWR-22-04475 NOTICE OF TRANSFER, OWR-22-01512 ABANDONMENT, … · ABANDONMENT on file (OWR-22-01512)",
    );
  });

  it("frees the extraction slot when a pending document fails to store", async () => {
    let n = 0;
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "found",
        via: "apn",
        hits: [
          PERMIT,
          hit({ permitNumber: "A", docType: "PERMIT" }),
          hit({ permitNumber: "B", docType: "PERMIT" }),
          hit({ permitNumber: "C", docType: "PERMIT" }),
        ],
        searched: ["APN x"],
        failedArchives: [],
      }),
      storeDocument: vi.fn(async (i: StoreDocumentInput): Promise<StoreDocumentResult> => {
        n++;
        if (n === 1) {
          return {
            recordId: "rec-1",
            stored: false,
            sizeBytes: null,
            pageCount: null,
            extractionStatus: "failed",
            error: "Download failed: 500",
          };
        }
        return storedResult(i, n);
      }),
    });
    const result = await runPermitsStage(input, ctx, deps);
    const statuses = deps.storeDocument.mock.calls.map(
      (c) => (c[0] as StoreDocumentInput).extractionStatus,
    );
    expect(statuses).toEqual(["pending", "pending", "pending", "pending"]);
    expect(result.stage.summary).toContain("1 download failed");
    // the proposal links to the first *stored* record
    expect(result.proposals[0].provenance.recordId).toBe("rec-2");
    expect(result.proposals[0].provenance.sourceUrl).toBe("/api/inspections/insp-1/records/rec-2");
  });

  it("counts over-size documents separately from failed downloads", async () => {
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "found",
        via: "apn",
        hits: [PERMIT, TRANSFER],
        searched: ["APN x"],
        failedArchives: [],
      }),
      storeDocument: vi.fn(async (i: StoreDocumentInput): Promise<StoreDocumentResult> => ({
        recordId: `rec-${i.hit.candidate.permitNumber}`,
        stored: false,
        sizeBytes: 30 * 1024 * 1024,
        pageCount: null,
        extractionStatus: "skipped",
        error: "Larger than 25 MB (30.0 MB) — open it on Maricopa EDMS",
      })),
    });
    const result = await runPermitsStage(input, ctx, deps);
    expect(result.stage.summary).toBe(
      "2 permit documents found: OW-17-00474 PERMIT, OWR-22-04475 NOTICE OF TRANSFER · 2 over 25 MB not downloaded",
    );
    // nothing stored → the proposal falls back to the EDMS search page, no recordId
    expect(result.proposals[0].provenance).toEqual({
      source: "permit",
      confidence: 1,
      explanation: "Permit OW-17-00474 (PERMIT) found on Maricopa EDMS",
      sourceUrl: "https://edms.maricopa.gov/env/",
      runId: "run-1",
    });
  });

  it("returns candidates with a pending stage when the fallback is ambiguous", async () => {
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "ambiguous",
        hits: [PERMIT, TRANSFER, ABANDON],
        searched: ["8911 PRINCESS"],
        failedArchives: [],
      }),
    });
    const result = await runPermitsStage(input, ctx, deps);
    expect(deps.storeDocument).not.toHaveBeenCalled();
    expect(result.stage.status).toBe("pending");
    expect(result.stage.summary).toBe("3 possible permits — pick the right one");
    expect(result.candidates?.map((c) => c.key)).toEqual(
      [PERMIT, TRANSFER, ABANDON].map((h) => h.candidate.key),
    );
    expect(result.proposals).toEqual([]);
  });

  it("reports not_found with the searched terms and suggests recordsAvailable = no", async () => {
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "not_found",
        searched: ["APN 219-11-121", "8911 CAVE CREEK"],
        failedArchives: [],
      }),
    });
    const result = await runPermitsStage(input, ctx, deps);
    expect(result.stage.status).toBe("not_found");
    expect(result.stage.summary).toBe(
      "No permit records found (searched APN 219-11-121 and 8911 CAVE CREEK — 0 matches)",
    );
    expect(result.proposals).toEqual([
      {
        fieldPath: "facilityInfo.recordsAvailable",
        value: "no",
        kind: "fill",
        provenance: {
          source: "permit",
          confidence: 0.6,
          explanation:
            "No permit records found on Maricopa EDMS (searched APN 219-11-121 and 8911 CAVE CREEK)",
          sourceUrl: "https://edms.maricopa.gov/env/",
          runId: "run-1",
        },
      },
    ]);
  });

  it("proposes nothing when there was nothing to search", async () => {
    const result = await runPermitsStage({}, ctx, makeDeps());
    expect(result.stage.status).toBe("not_found");
    expect(result.stage.summary).toBe(notFoundSummary([]));
    expect(result.stage.summary).toBe(
      "No permit records searched — add an APN or street address and run Find records",
    );
    expect(result.proposals).toEqual([]);
  });

  it("maps a search error onto the stage without throwing", async () => {
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "error",
        message: "Maricopa EDMS unavailable — try Find records later",
        searched: ["APN 200-08-079"],
      }),
    });
    const result = await runPermitsStage(input, ctx, deps);
    expect(result.stage).toMatchObject({
      status: "error",
      error: "Maricopa EDMS unavailable — try Find records later",
      summary: "Maricopa EDMS unavailable — try Find records later",
    });
    expect(deps.storeDocument).not.toHaveBeenCalled();
    expect(result.proposals).toEqual([]);
  });

  it("survives a thrown storeDocument and an unexpected search exception", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const deps = makeDeps({
        searchPermits: vi.fn().mockResolvedValue({
          kind: "found",
          via: "apn",
          hits: [PERMIT],
          searched: ["APN x"],
          failedArchives: [],
        }),
        storeDocument: vi.fn().mockRejectedValue(new Error("db down")),
      });
      const result = await runPermitsStage(input, ctx, deps);
      expect(result.stage.status).toBe("done");
      expect(result.stage.summary).toContain("1 download failed");
      // nothing stored → the proposal still says "yes" but links to the search page
      expect(result.proposals[0]).toMatchObject({
        value: "yes",
        provenance: { sourceUrl: "https://edms.maricopa.gov/env/" },
      });
      expect(result.proposals[0].provenance.recordId).toBeUndefined();

      const boom = makeDeps({ searchPermits: vi.fn().mockRejectedValue(new Error("kaboom")) });
      const crashed = await runPermitsStage(input, ctx, boom);
      expect(crashed.stage).toMatchObject({
        status: "error",
        error: "kaboom",
        summary: "Permit search failed",
      });
      expect(crashed.proposals).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("stops downloading once the run budget signal fires", async () => {
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "found",
        via: "apn",
        hits: [PERMIT, TRANSFER],
        searched: ["APN x"],
        failedArchives: [],
      }),
      storeDocument: vi.fn(async (i: StoreDocumentInput) => {
        ctx.controller.abort();
        return storedResult(i, 1);
      }),
    });
    const result = await runPermitsStage(input, ctx, deps);
    expect(deps.storeDocument).toHaveBeenCalledTimes(1);
    expect(result.stage.status).toBe("done");
    expect(result.stage.summary).toContain("1 not downloaded (out of time)");
  });

  it("hands the stored result to phase 3's withExtraction on the initial run and on selection", async () => {
    vi.mocked(withExtraction).mockClear();
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "found",
        via: "apn",
        hits: [PERMIT],
        searched: ["APN 200-08-079"],
        failedArchives: [],
      }),
    });
    const result = await runPermitsStage(input, ctx, deps);
    expect(result.stage.status).toBe("done");
    expect(withExtraction).toHaveBeenCalledTimes(1);
    expect(withExtraction).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ stage: expect.objectContaining({ status: "done" }) }),
    );

    await runPermitsSelection(input, ctx, [PERMIT.candidate.key], deps);
    expect(withExtraction).toHaveBeenCalledTimes(2);
  });

  describe("failed archives (A8)", () => {
    it("flags a found result as possibly incomplete when one archive query failed", async () => {
      const deps = makeDeps({
        searchPermits: vi.fn().mockResolvedValue({
          kind: "found",
          via: "street",
          hits: [PERMIT],
          searched: ["8911 VILLA CHULA"],
          failedArchives: ["edms_eplpav"],
        }),
      });
      const result = await runPermitsStage(input, ctx, deps);
      expect(result.stage.status).toBe("done");
      expect(result.stage.summary).toBe(
        "1 permit document found: OW-17-00474 PERMIT · A query to the 2024+ archive (eplpav) failed — results may be incomplete",
      );
      expect(result.proposals[0]).toMatchObject({ value: "yes" });
    });

    it("never renders a confident negative after a partial outage", async () => {
      const deps = makeDeps({
        searchPermits: vi.fn().mockResolvedValue({
          kind: "not_found",
          searched: ["APN 200-08-079"],
          failedArchives: ["edms_env"],
        }),
      });
      const result = await runPermitsStage(input, ctx, deps);
      expect(result.stage.status).toBe("not_found");
      expect(result.stage.summary).toBe(
        "No permit records found (searched APN 200-08-079 — 0 matches) · A query to the legacy archive (env) failed — results may be incomplete",
      );
      // no recordsAvailable = "no" suggestion when we could not actually check
      expect(result.proposals).toEqual([]);
    });

    it("appends the note to the ambiguous summary too", async () => {
      const deps = makeDeps({
        searchPermits: vi.fn().mockResolvedValue({
          kind: "ambiguous",
          hits: [PERMIT, TRANSFER],
          searched: ["8911 PRINCESS"],
          failedArchives: ["edms_env", "edms_eplpav"],
        }),
      });
      const result = await runPermitsStage(input, ctx, deps);
      expect(result.stage.status).toBe("pending");
      expect(result.stage.summary).toBe(
        "2 possible permits — pick the right one · Queries to the legacy archive (env) and the 2024+ archive (eplpav) failed — results may be incomplete",
      );
      expect(result.candidates).toHaveLength(2);
    });

    it("failedArchivesNote is null when nothing failed", () => {
      expect(failedArchivesNote([])).toBeNull();
      expect(failedArchivesNote(["edms_env"])).toBe(
        "A query to the legacy archive (env) failed — results may be incomplete",
      );
    });
  });
});

describe("runPermitsSelection", () => {
  it("re-runs the search and stores only the chosen candidate keys", async () => {
    const ctx = makeCtx();
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "ambiguous",
        hits: [PERMIT, TRANSFER, ABANDON],
        searched: ["8911 PRINCESS"],
        failedArchives: [],
      }),
    });
    const result = await runPermitsSelection(
      input,
      ctx,
      [TRANSFER.candidate.key, ABANDON.candidate.key],
      deps,
    );
    expect(deps.searchPermits).toHaveBeenCalledWith(input, ctx.signal);
    const stored = deps.storeDocument.mock.calls.map(
      (c) => (c[0] as StoreDocumentInput).hit.candidate.permitNumber,
    );
    expect(stored).toEqual(["OWR-22-04475", "OWR-22-01512"]);
    expect(result.stage.status).toBe("done");
    expect(result.stage.summary).toBe(
      "2 permit documents found: OWR-22-04475 NOTICE OF TRANSFER, OWR-22-01512 ABANDONMENT · ABANDONMENT on file (OWR-22-01512)",
    );
    expect(result.proposals[0]).toMatchObject({
      fieldPath: "facilityInfo.recordsAvailable",
      value: "yes",
    });
    expect((result as { candidates?: unknown }).candidates).toBeUndefined();
    expect(ctx.progress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: "running", summary: "Fetching the selected permits…" }),
    );
  });

  it("also accepts keys from a fresh search that auto-selected", async () => {
    const ctx = makeCtx();
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "found",
        via: "street",
        hits: [PERMIT, TRANSFER],
        searched: ["8911 PRINCESS"],
        failedArchives: [],
      }),
    });
    const result = await runPermitsSelection(input, ctx, [PERMIT.candidate.key], deps);
    expect(deps.storeDocument).toHaveBeenCalledTimes(1);
    expect(result.stage.status).toBe("done");
  });

  it("errors when none of the chosen keys are in the fresh results", async () => {
    const ctx = makeCtx();
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "ambiguous",
        hits: [PERMIT],
        searched: ["x"],
        failedArchives: [],
      }),
    });
    const result = await runPermitsSelection(input, ctx, ["edms_env:NOPE:PERMIT:"], deps);
    expect(deps.storeDocument).not.toHaveBeenCalled();
    expect(result.stage).toMatchObject({
      status: "error",
      error: "Selected permits are no longer available on Maricopa EDMS — run Find records again",
    });
    expect(result.proposals).toEqual([]);
  });

  it("errors when the fresh search itself fails or returns nothing", async () => {
    const ctx = makeCtx();
    const errored = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "error",
        message: "Maricopa EDMS unavailable — try Find records later",
        searched: ["x"],
      }),
    });
    const a = await runPermitsSelection(input, ctx, [PERMIT.candidate.key], errored);
    expect(a.stage).toMatchObject({
      status: "error",
      error: "Maricopa EDMS unavailable — try Find records later",
    });

    const empty = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({ kind: "not_found", searched: ["x"], failedArchives: [] }),
    });
    const b = await runPermitsSelection(input, ctx, [PERMIT.candidate.key], empty);
    expect(b.stage).toMatchObject({
      status: "error",
      error: "Selected permits are no longer available on Maricopa EDMS — run Find records again",
    });
  });

  it("never throws when the search rejects", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ctx = makeCtx();
      const deps = makeDeps({ searchPermits: vi.fn().mockRejectedValue(new Error("kaboom")) });
      const result = await runPermitsSelection(input, ctx, [PERMIT.candidate.key], deps);
      expect(result.stage).toMatchObject({
        status: "error",
        error: "kaboom",
        summary: "Fetching the selected permits failed",
      });
    } finally {
      spy.mockRestore();
    }
  });
});
