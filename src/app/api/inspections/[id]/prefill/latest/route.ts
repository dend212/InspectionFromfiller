import { NextResponse } from "next/server";
import { requireInspectionAccess } from "@/lib/prefill/route-access";
import { loadLatestRunDTO } from "@/lib/prefill/run-dto";

/** GET /api/inspections/[id]/prefill/latest — most recent run, or JSON null. Used on wizard mount. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireInspectionAccess(id, "view");
  if (!access.ok) return access.response;

  const run = await loadLatestRunDTO(id);
  return NextResponse.json(run);
}
