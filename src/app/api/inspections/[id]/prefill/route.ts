import { after, NextResponse } from "next/server";
import { buildPrefillInput, isValidApn, prefillStartBodySchema } from "@/lib/prefill/input";
import { requireInspectionAccess } from "@/lib/prefill/route-access";
import { runPrefill } from "@/lib/prefill/run-prefill";
import {
  countRunsInLastHour,
  createRun,
  failStaleRuns,
  findActiveRun,
} from "@/lib/prefill/run-store";
import { MAX_PREFILL_RUNS_PER_HOUR } from "@/lib/prefill/types";

// The run continues in after() once the 201 is sent — needs Fluid Compute's longer budget
export const maxDuration = 300;

/**
 * POST /api/inspections/[id]/prefill
 * Body: { apn?, address?, trigger? } — defaults come from the inspection's facilityInfo.
 * Creates a queued run row and executes it in after(). 201 { runId }.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireInspectionAccess(id, "edit");
  if (!access.ok) return access.response;

  // An empty body is fine — "Find records" sends none
  const raw: unknown = await request.json().catch(() => ({}));
  const parsed = prefillStartBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = buildPrefillInput(access.inspection.formData, parsed.data);
  if (input.apn && !isValidApn(input.apn)) {
    return NextResponse.json({ error: "Invalid APN format" }, { status: 400 });
  }
  if (!input.apn && !input.address) {
    return NextResponse.json(
      { error: "Enter an APN or a street address first" },
      { status: 400 },
    );
  }

  if ((await countRunsInLastHour(id)) >= MAX_PREFILL_RUNS_PER_HOUR) {
    return NextResponse.json(
      { error: `Prefill limit reached (${MAX_PREFILL_RUNS_PER_HOUR} per hour)` },
      { status: 429 },
    );
  }

  await failStaleRuns(id);
  if (await findActiveRun(id)) {
    return NextResponse.json({ error: "A prefill run is already in progress" }, { status: 409 });
  }

  let runId: string;
  try {
    runId = await createRun({
      inspectionId: id,
      trigger: parsed.data.trigger ?? "manual",
      input,
      createdBy: access.userId,
    });
  } catch (err) {
    // Backstop for the check-then-act lock above: a concurrent POST can slip past
    // findActiveRun before either insert lands, so the partial unique index (migration
    // 0015) is the actual guarantee — postgres.js surfaces a violation as `code: "23505"`.
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      return NextResponse.json(
        { error: "A prefill run is already in progress" },
        { status: 409 },
      );
    }
    throw err;
  }

  after(() => runPrefill(runId));

  return NextResponse.json({ runId }, { status: 201 });
}
