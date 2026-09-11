import { readFileSync } from "node:fs";
import path from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inspectionPrefillRuns, inspectionRecords, inspections } from "@/lib/db/schema";

describe("prefill Drizzle schema", () => {
  it("adds field_provenance to inspections, NOT NULL with a {} default", () => {
    const cols = getTableColumns(inspections);
    expect(cols.fieldProvenance.name).toBe("field_provenance");
    expect(cols.fieldProvenance.notNull).toBe(true);
    expect(cols.fieldProvenance.default).toEqual({});
  });

  it("defines inspection_prefill_runs with the contract columns", () => {
    expect(getTableName(inspectionPrefillRuns)).toBe("inspection_prefill_runs");
    expect(Object.keys(getTableColumns(inspectionPrefillRuns))).toEqual([
      "id",
      "inspectionId",
      "trigger",
      "status",
      "input",
      "stages",
      "proposals",
      "candidates",
      "error",
      "appliedAt",
      "createdBy",
      "createdAt",
      "finishedAt",
    ]);
    expect(getTableColumns(inspectionPrefillRuns).status.default).toBe("queued");
  });

  it("defines inspection_records with the contract columns", () => {
    expect(getTableName(inspectionRecords)).toBe("inspection_records");
    expect(Object.keys(getTableColumns(inspectionRecords))).toEqual([
      "id",
      "inspectionId",
      "runId",
      "source",
      "permitNumber",
      "docType",
      "docDate",
      "description",
      "pageCount",
      "sizeBytes",
      "storagePath",
      "selected",
      "extractionStatus",
      "extractionError",
      "extracted",
      "createdAt",
    ]);
    expect(getTableColumns(inspectionRecords).selected.default).toBe(true);
    expect(getTableColumns(inspectionRecords).extractionStatus.default).toBe("pending");
  });
});

describe("migration 0015", () => {
  const sql = readFileSync(
    path.resolve(process.cwd(), "src/lib/db/migrations/0015_prefill_runs_records_provenance.sql"),
    "utf8",
  );

  it("adds the column and both tables idempotently", () => {
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS field_provenance jsonb NOT NULL DEFAULT '{}'::jsonb",
    );
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.inspection_prefill_runs");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.inspection_records");
    expect(sql).toContain("inspection_prefill_runs_inspection_created_idx");
    expect(sql).toContain("inspection_records_inspection_idx");
  });

  it("enables RLS on both tables with a read policy", () => {
    expect(sql).toContain("ALTER TABLE public.inspection_prefill_runs ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.inspection_records ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain('CREATE POLICY "Prefill runs readable by authenticated"');
    expect(sql).toContain('CREATE POLICY "Inspection records readable by authenticated"');
  });
});
