import { after, NextResponse } from "next/server";
import { z } from "zod";
import { isUniqueViolation } from "@/lib/prefill/db-errors";
import { runPrefill } from "@/lib/prefill/run-prefill";
import { createRun } from "@/lib/prefill/run-store";
import { canImportNow, isAdeqJob } from "@/lib/workiz/adeq";
import { getCachedSummary, getJob } from "@/lib/workiz/adeq-jobs";
import { WorkizError } from "@/lib/workiz/client";
import {
  findInspectionsByWorkizIds,
  type ImportedInspectionRow,
  insertImportedInspection,
  loadProfileFullName,
} from "@/lib/workiz/import-store";
import { logDbError } from "@/lib/workiz/log-db-error";
import { mapJobToImportPlan, sanitizeProvenance } from "@/lib/workiz/map-job";
import type { WorkizJob } from "@/lib/workiz/schema";
import { requireWorkizImporter, type WorkizImporterAuth } from "@/lib/workiz/route-auth";
import { errorResponse, internalErrorResponse, workizErrorResponse } from "@/lib/workiz/route-errors";
import type { WorkizImportCreated, WorkizImportExisting, WorkizImportPrefill } from "@/types/workiz-import";

// The run continues in after() once the 201 is sent — needs Fluid Compute's longer budget
export const maxDuration = 300;

// Not exported: a route module may only export Next.js route fields
const workizImportBodySchema = z.strictObject({
  jobId: z.string().regex(/^JOB-[A-Za-z0-9]{6,40}$/),
});

type Importer = Extract<WorkizImporterAuth, { ok: true }>;

/** 200 when the user can open the match (checkInspectionAccess rule), else 409 with no id */
function existingResponse(match: ImportedInspectionRow, auth: Importer) {
  if (match.inspectorId === auth.user.id || auth.role === "admin") {
    return NextResponse.json<WorkizImportExisting>(
      { inspectionId: match.id, existing: true, status: match.status },
      { status: 200 },
    );
  }
  return errorResponse(409, "already_imported", "This Workiz job was already imported by another inspector");
}

/**
 * POST /api/workiz/import  { jobId: "JOB-…" }
 * Creates a draft from a finished Workiz ADEQ job and starts the address-driven prefill run
 * (spec §4, §8.2). One inspection per job: three existing-job checks plus the unique
 * workiz_job_id index. DB errors are logged with logDbError only — never err/message/params.
 */
export async function POST(request: Request) {
  const auth = await requireWorkizImporter();
  if (!auth.ok) return auth.response;

  const raw: unknown = await request.json().catch(() => null);
  const parsed = workizImportBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", code: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { jobId } = parsed.data;
  let serialId: number | null = null;

  try {
    // 1. Before calling Workiz: the JOB- id and, when the list cached it, the uuid
    const before = await findInspectionsByWorkizIds([jobId, getCachedSummary(jobId)?.uuid]);
    if (before[0]) return existingResponse(before[0], auth);

    // 2. Fresh, authoritative job
    let job: WorkizJob;
    try {
      job = await getJob(jobId);
    } catch (err) {
      if (err instanceof WorkizError) return workizErrorResponse(err, "import");
      throw err;
    }
    serialId = job.serialId;

    // The server re-checks type AND status: a hand-crafted jobId cannot pull a pumping job or a
    // canceled job's client data
    if (!isAdeqJob(job)) return errorResponse(422, "not_adeq_job", "Only ADEQ inspection jobs can be imported");
    if (!canImportNow(job)) return errorResponse(422, "not_importable", "This Workiz job isn't ready to import");
    if (!job.uuid) {
      return errorResponse(502, "workiz_bad_response", "Workiz sent a response the app couldn't read");
    }

    // 3. After the fetch: the uuid (what this route and the webhook store) ∪ the JOB- id
    const after_ = await findInspectionsByWorkizIds([job.uuid, job.id]);
    if (after_[0]) return existingResponse(after_[0], auth);

    const inspectorName = (await loadProfileFullName(auth.user.id)) ?? auth.user.user_metadata?.full_name ?? "";
    const plan = mapJobToImportPlan(job, { inspectorName });
    for (const skip of plan.skips) {
      console.info(`[workiz-import] skip job=${serialId ?? "?"} field=${skip.field} reason=${skip.reason}`);
    }
    const { map: fieldProvenance, dropped } = sanitizeProvenance(plan.fieldProvenance);
    for (const path of dropped) {
      console.warn(`[workiz-import] dropped provenance entry job=${serialId ?? "?"} path=${path}`);
    }

    let inspectionId: string;
    try {
      inspectionId = await insertImportedInspection({
        inspectorId: auth.user.id,
        status: "draft",
        formData: plan.formData,
        fieldProvenance,
        facilityAddress: plan.columns.facilityAddress,
        facilityCity: plan.columns.facilityCity,
        facilityZip: plan.columns.facilityZip,
        facilityCounty: null,
        facilityName: null,
        customerEmail: plan.columns.customerEmail,
        // Left null: the wizard's first autosave writes sellerName ?? null anyway (spec §5.1)
        customerName: null,
        workizJobId: plan.columns.workizJobId,
        // The run sets it via setInspectionApnIfNull; the unverified hint is never written here
        apn: null,
      });
    } catch (err) {
      // A concurrent import of the same job won the unique index: return what it created
      if (isUniqueViolation(err)) {
        const winner = await findInspectionsByWorkizIds([job.uuid]);
        if (winner[0]) return existingResponse(winner[0], auth);
      }
      logDbError("insert", err, { serialId });
      return internalErrorResponse();
    }

    let prefill: WorkizImportPrefill;
    if (!plan.prefillInput) {
      prefill = { status: "skipped", reason: "address_unparseable" };
    } else {
      try {
        // A brand-new inspection cannot trip countRunsInLastHour or findActiveRun — no checks needed
        const runId = await createRun({
          inspectionId,
          trigger: "workiz_import",
          input: plan.prefillInput,
          createdBy: auth.user.id,
        });
        after(() => runPrefill(runId));
        prefill = { status: "started", runId };
      } catch (err) {
        logDbError("create_run", err, { serialId });
        prefill = { status: "failed" };
      }
    }

    return NextResponse.json<WorkizImportCreated>(
      { inspectionId, existing: false, prefill },
      { status: 201 },
    );
  } catch (err) {
    logDbError("import", err, { serialId });
    return internalErrorResponse();
  }
}
