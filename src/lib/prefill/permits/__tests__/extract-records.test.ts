import { beforeEach, describe, expect, it, vi } from "vitest";

// extract-records imports db/admin/storage for its default deps only; the tests inject deps, so stub the modules
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/storage/record-storage", () => ({ RECORD_BUCKET: "inspection-media" }));

import { ExtractionError } from "@/lib/ai/extract-permit-facts";
import { emptyPermitFacts, type PermitFacts } from "@/lib/ai/permit-extraction-schema";
import { dedupeProposals } from "@/lib/prefill/map-facts-to-fields";
import {
  describeFacts,
  extractStoredRecords,
  rankRecordsForExtraction,
  type ExtractRecordsDeps,
  type StoredRecord,
} from "@/lib/prefill/permits/extract-records";
import type { StageContext } from "@/lib/prefill/stage";

const f = <T>(value: T, confidence = 0.9, page = 1) => ({ value, confidence, page, evidence: `ev:${String(value)}`, handwritten: false });

function rec(over: Partial<StoredRecord> & { id: string }): StoredRecord {
  return {
    inspectionId: "insp-1",
    permitNumber: "OW-17-00474",
    docType: "PERMIT",
    source: "edms_env",
    storagePath: `records/insp-1/${over.id}.pdf`,
    docDate: "2017-05-12",
    sizeBytes: 500_000,
    extractionStatus: "pending",
    ...over,
  };
}

const daFacts: PermitFacts = {
  ...emptyPermitFacts(),
  documentKind: "discharge_authorization",
  permitNumber: f("OW-17-00474", 0.98),
  tanks: [{ capacityGal: f(1250, 0.97), material: null, model: null, dimensions: null }],
  disposal: { ...emptyPermitFacts().disposal, type: f("seepage_pit" as const, 0.97), count: f(2, 0.97), dimensions: null, absorptionAreaSqft: null },
  designFlowGpd: f(450, 0.96),
};

function ctx(over: Partial<StageContext> = {}): StageContext & { progress: ReturnType<typeof vi.fn> } {
  return {
    inspectionId: "insp-1",
    runId: "run-1",
    signal: new AbortController().signal,
    progress: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as StageContext & { progress: ReturnType<typeof vi.fn> };
}

function deps(over: Partial<ExtractRecordsDeps> = {}) {
  const d = {
    loadPdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])),
    extract: vi.fn().mockResolvedValue({
      facts: daFacts,
      passes: 1,
      escalations: 0,
      pageCount: 4,
      usage: { calls: [], estimatedCostUsd: 0.04 },
    }),
    persist: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    ...over,
  };
  return d as ExtractRecordsDeps & { [K in keyof ExtractRecordsDeps]: ReturnType<typeof vi.fn> };
}

describe("rankRecordsForExtraction", () => {
  it("orders PERMIT/FINAL DA (newest first) → PERMIT SUB → NOTICE OF TRANSFER and never PLAN REVIEW / SUB", () => {
    const records = [
      rec({ id: "sub", docType: "SUB" }),
      rec({ id: "old", docType: "PERMIT", docDate: "2000-03-15" }),
      rec({ id: "transfer", docType: "NOTICE OF TRANSFER", docDate: "2021-01-01" }),
      rec({ id: "new", docType: "FINAL DA", docDate: "2017-05-12" }),
      rec({ id: "psub", docType: "PERMIT SUB", docDate: "2016-01-01" }),
      rec({ id: "big", docType: "PERMIT", docDate: "2024-01-01", sizeBytes: 30 * 1024 * 1024 }),
      rec({ id: "done-before", docType: "PERMIT", docDate: "2025-01-01", extractionStatus: "skipped" }),
    ];
    const { toExtract, toSkip } = rankRecordsForExtraction(records);
    expect(toExtract.map((r) => r.id)).toEqual(["new", "old", "psub"]);
    expect(toSkip.map((s) => [s.record.id, s.reason])).toEqual([
      ["sub", "SUB documents are not read"],
      ["transfer", "Only the first 3 documents are read per run"],
      ["big", "Document is larger than 25 MB"],
    ]);
  });

  it("only considers records phase 2 left as pending", () => {
    const { toExtract, toSkip } = rankRecordsForExtraction([
      rec({ id: "already", extractionStatus: "done" }),
      rec({ id: "skipped-by-p2", extractionStatus: "skipped" }),
      rec({ id: "unstored", storagePath: "" }),
      rec({ id: "todo" }),
    ]);
    expect(toExtract.map((r) => r.id)).toEqual(["todo"]);
    expect(toSkip.map((s) => [s.record.id, s.reason])).toEqual([["unstored", "Document was not stored"]]);
  });

  it("extracts an ABANDONMENT record last and skips unknown types", () => {
    const { toExtract, toSkip } = rankRecordsForExtraction([
      rec({ id: "ab", docType: "ABANDONMENT", docDate: "2022-01-01" }),
      rec({ id: "odd", docType: "FEE RECEIPT" }),
      rec({ id: "p", docType: "PERMIT", docDate: "2001-01-01" }),
    ]);
    expect(toExtract.map((r) => r.id)).toEqual(["p", "ab"]);
    expect(toSkip.map((s) => s.reason)).toEqual(["FEE RECEIPT documents are not read"]);
  });
});

describe("extractStoredRecords", () => {
  beforeEach(() => vi.clearAllMocks());

  it("downloads, extracts, persists `done` with the facts, reports progress and returns proposals", async () => {
    const d = deps();
    const c = ctx();
    const result = await extractStoredRecords([rec({ id: "r1" })], c, d);

    expect(d.loadPdf).toHaveBeenCalledWith("records/insp-1/r1.pdf");
    expect(d.extract).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      { permitNumber: "OW-17-00474", docType: "PERMIT", archive: "edms_env" },
      { signal: c.signal },
    );
    expect(c.progress).toHaveBeenCalledWith({ status: "running", summary: "Reading OW-17-00474…" });
    expect(d.persist).toHaveBeenCalledWith("r1", { extractionStatus: "done", extractionError: null, extracted: daFacts });
    expect(result.done).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.estimatedCostUsd).toBeCloseTo(0.04, 5);
    const cap = result.proposals.find((p) => p.fieldPath === "septicTank.tanks.0.tankCapacity");
    expect(cap?.value).toBe("1250");
    expect(cap?.provenance.sourceUrl).toBe("/api/inspections/insp-1/records/r1#page=1");
    expect(result.highlights).toEqual(["OW-17-00474: 1,250 gal tank · 2 seepage pits · 450 gpd design flow"]);
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("OW-17-00474: 1 pass(es), 0 escalation(s)"));
  });

  it("marks a record failed with the ExtractionError message and continues with the next one", async () => {
    const d = deps();
    d.extract
      .mockRejectedValueOnce(new ExtractionError("Claude API error: 500 boom"))
      .mockResolvedValueOnce({ facts: daFacts, passes: 1, escalations: 0, pageCount: 4, usage: { calls: [], estimatedCostUsd: 0.03 } });
    const result = await extractStoredRecords(
      [rec({ id: "r1", docDate: "2020-01-01" }), rec({ id: "r2", docDate: "2019-01-01" })],
      ctx(),
      d,
    );
    expect(d.persist).toHaveBeenCalledWith("r1", { extractionStatus: "failed", extractionError: "Claude API error: 500 boom" });
    expect(d.persist).toHaveBeenCalledWith("r2", expect.objectContaining({ extractionStatus: "done" }));
    expect(result.failed).toBe(1);
    expect(result.done).toBe(1);
    expect(result.proposals.length).toBeGreaterThan(0);
  });

  it("marks a record failed when the download fails", async () => {
    const d = deps({ loadPdf: vi.fn().mockRejectedValue(new Error("Object not found")) });
    const result = await extractStoredRecords([rec({ id: "r1" })], ctx(), d);
    expect(d.persist).toHaveBeenCalledWith("r1", { extractionStatus: "failed", extractionError: "Object not found" });
    expect(result.failed).toBe(1);
    expect(d.extract).not.toHaveBeenCalled();
  });

  it("persists `skipped` with the reason for records beyond the cap or of unread types", async () => {
    const d = deps();
    await extractStoredRecords(
      [rec({ id: "a", docDate: "2020-01-01" }), rec({ id: "b", docDate: "2019-01-01" }), rec({ id: "c", docDate: "2018-01-01" }), rec({ id: "d", docDate: "2017-01-01" }), rec({ id: "plan", docType: "PLAN REVIEW" })],
      ctx(),
      d,
    );
    expect(d.persist).toHaveBeenCalledWith("d", { extractionStatus: "skipped", extractionError: "Only the first 3 documents are read per run" });
    expect(d.persist).toHaveBeenCalledWith("plan", { extractionStatus: "skipped", extractionError: "PLAN REVIEW documents are not read" });
    expect(d.extract).toHaveBeenCalledTimes(3);
  });

  it("flags abandonment documents and proposes nothing from them", async () => {
    const facts: PermitFacts = { ...emptyPermitFacts(), documentKind: "abandonment", isAbandonment: true, permitNumber: f("AB-01", 0.9) };
    const d = deps({ extract: vi.fn().mockResolvedValue({ facts, passes: 1, escalations: 0, pageCount: 2, usage: { calls: [], estimatedCostUsd: 0.01 } }) });
    const result = await extractStoredRecords([rec({ id: "ab", docType: "ABANDONMENT", permitNumber: "AB-01" })], ctx(), d);
    expect(result.abandonmentPermits).toEqual(["AB-01"]);
    expect(result.proposals).toEqual([]);
    expect(result.highlights).toEqual([]);
    expect(result.done).toBe(1);
  });

  describe("records reused from an earlier run (D7)", () => {
    it("replays the stored facts of a `done` record without downloading, calling Claude or persisting", async () => {
      const d = deps();
      const c = ctx();
      const result = await extractStoredRecords([rec({ id: "r-old", extractionStatus: "done", extracted: daFacts })], c, d);
      expect(d.loadPdf).not.toHaveBeenCalled();
      expect(d.extract).not.toHaveBeenCalled();
      expect(d.persist).not.toHaveBeenCalled();
      expect(result.estimatedCostUsd).toBe(0);
      expect(result.done).toBe(0);
      expect(result.failed).toBe(0);
      const cap = result.proposals.find((p) => p.fieldPath === "septicTank.tanks.0.tankCapacity");
      expect(cap?.value).toBe("1250");
      expect(cap?.provenance.sourceUrl).toBe("/api/inspections/insp-1/records/r-old#page=1");
      expect(result.highlights).toEqual(["OW-17-00474: 1,250 gal tank · 2 seepage pits · 450 gpd design flow"]);
      expect(d.log).toHaveBeenCalledWith(expect.stringContaining("OW-17-00474: reused stored facts"));
    });

    it("flags a reused abandonment record without proposing from it", async () => {
      const facts: PermitFacts = { ...emptyPermitFacts(), documentKind: "abandonment", isAbandonment: true };
      const result = await extractStoredRecords(
        [rec({ id: "ab", docType: "ABANDONMENT", permitNumber: "AB-01", extractionStatus: "done", extracted: facts })],
        ctx(),
        deps(),
      );
      expect(result.abandonmentPermits).toEqual(["AB-01"]);
      expect(result.proposals).toEqual([]);
      expect(result.highlights).toEqual([]);
    });

    it("reads a re-queued (formerly failed) record again alongside the replayed ones", async () => {
      const d = deps();
      const result = await extractStoredRecords(
        [
          rec({ id: "r-old", docDate: "2018-01-01", extractionStatus: "done", extracted: daFacts }),
          rec({ id: "r-retry", docDate: "2017-01-01", extractionStatus: "pending" }),
        ],
        ctx(),
        d,
      );
      expect(d.loadPdf).toHaveBeenCalledTimes(1);
      expect(d.loadPdf).toHaveBeenCalledWith("records/insp-1/r-retry.pdf");
      expect(d.extract).toHaveBeenCalledTimes(1);
      expect(d.persist).toHaveBeenCalledWith("r-retry", expect.objectContaining({ extractionStatus: "done" }));
      expect(result.done).toBe(1);
      expect(result.proposals.filter((p) => p.fieldPath === "septicTank.tanks.0.tankCapacity")).toHaveLength(2);
    });

    it("ignores a `done` record without stored facts", async () => {
      const d = deps();
      const result = await extractStoredRecords([rec({ id: "r-old", extractionStatus: "done", extracted: null })], ctx(), d);
      expect(result.proposals).toEqual([]);
      expect(d.extract).not.toHaveBeenCalled();
    });

    it("Dove Valley: a replayed Notice of Transfer never supplies the age; the freshly read permit does", async () => {
      // 1414 E Dove Valley Rd — the NOT was reused from an earlier run, the 2007 permit read fresh
      const notFacts: PermitFacts = {
        ...emptyPermitFacts(),
        documentKind: "notice_of_transfer",
        issueDate: { value: "2023-06-07", confidence: 0.95, page: 5, evidence: "Date 6/7/2023", handwritten: false },
        finalDate: { value: "2023-04-27", confidence: 0.97, page: 1, evidence: "Inspection date 4/27/2023", handwritten: false },
        designFlowGpd: { value: 450, confidence: 0.97, page: 2, evidence: "Design flow 450 gpd", handwritten: false },
        systemType: { value: "conventional", confidence: 0.97, page: 2, evidence: "Conventional", handwritten: false },
      };
      const permitFacts: PermitFacts = {
        ...emptyPermitFacts(),
        documentKind: "other",
        issueDate: { value: "2007-04-12", confidence: 0.75, page: 1, evidence: "Date Issued 4/12/07", handwritten: true },
        tanks: [{ capacityGal: { value: 1500, confidence: 0.72, page: 4, evidence: "1500 gal", handwritten: true }, material: null, model: null, dimensions: null }],
      };
      const d = deps({
        extract: vi.fn().mockResolvedValue({ facts: permitFacts, passes: 1, escalations: 0, pageCount: 15, usage: { calls: [], estimatedCostUsd: 0.05 } }),
      });
      const result = await extractStoredRecords(
        [
          rec({ id: "rec-not", permitNumber: "OWR-23-02001", docType: "NOTICE OF TRANSFER", docDate: "2023-06-07", extractionStatus: "done", extracted: notFacts }),
          rec({ id: "rec-permit", permitNumber: "071533", docType: "PERMIT", docDate: "2007-04-12", extractionStatus: "pending" }),
        ],
        ctx(),
        d,
      );
      expect(d.extract).toHaveBeenCalledTimes(1);
      // the replayed NOT comes first in result.proposals (D7 order) and proposes no age at all
      expect(result.proposals.filter((p) => p.fieldPath === "facilityInfo.facilityAge")).toHaveLength(1);
      const ages = dedupeProposals(result.proposals).filter((p) => p.fieldPath === "facilityInfo.facilityAge");
      expect(ages).toHaveLength(1);
      expect(ages[0].value).toBe("19");
      expect(ages[0].provenance.recordId).toBe("rec-permit");
      expect(ages[0].provenance.explanation).toMatch(/^Permit issued 04\/2007 \(permit 071533\)$/);
      // the NOT still supplies what the permit does not
      const flow = dedupeProposals(result.proposals).find((p) => p.fieldPath === "designFlow.estimatedDesignFlow");
      expect(flow?.value).toBe("450");
      expect(flow?.provenance.recordId).toBe("rec-not");
    });
  });

  it("fails remaining records without calling Claude once the run budget is exhausted", async () => {
    const controller = new AbortController();
    controller.abort();
    const d = deps();
    const result = await extractStoredRecords([rec({ id: "r1" })], ctx({ signal: controller.signal }), d);
    expect(d.extract).not.toHaveBeenCalled();
    expect(d.persist).toHaveBeenCalledWith("r1", {
      extractionStatus: "failed",
      extractionError: "Prefill time budget exceeded before this document was read",
    });
    expect(result.failed).toBe(1);
  });
});

describe("describeFacts", () => {
  it("summarises the key facts in one line and says when nothing was found", () => {
    expect(describeFacts("000972", { ...emptyPermitFacts(), tanks: [{ capacityGal: f(1200), material: null, model: null, dimensions: null }], disposal: { ...emptyPermitFacts().disposal, type: f("seepage_pit" as const) } })).toBe(
      "000972: 1,200 gal tank · seepage pit",
    );
    expect(describeFacts("000972", emptyPermitFacts())).toBe("000972: no system facts found");
  });
});
