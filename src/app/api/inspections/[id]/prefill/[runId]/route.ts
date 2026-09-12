import { NextResponse } from "next/server";
import { requireInspectionAccess } from "@/lib/prefill/route-access";
import { loadRunDTO } from "@/lib/prefill/run-dto";

/** GET /api/inspections/[id]/prefill/[runId] — run status, stages, proposals, candidates, records. Polled every 2 s. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  const access = await requireInspectionAccess(id, "view");
  if (!access.ok) return access.response;

  const run = await loadRunDTO(runId);
  if (!run || run.inspectionId !== id) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json(run);
}
