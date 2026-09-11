import { NextResponse } from "next/server";
import { requireInspectionAccess } from "@/lib/prefill/route-access";
import { loadRunRow, markRunApplied } from "@/lib/prefill/run-store";

/** POST /api/inspections/[id]/prefill/[runId]/applied — the client has merged this run's proposals into the form. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  const access = await requireInspectionAccess(id, "edit");
  if (!access.ok) return access.response;

  const run = await loadRunRow(runId);
  if (!run || run.inspectionId !== id) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  await markRunApplied(runId);
  return NextResponse.json({ ok: true });
}
