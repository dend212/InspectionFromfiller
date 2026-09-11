import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireInspectionAccess } from "@/lib/prefill/route-access";
import { continuePrefillAfterSelection } from "@/lib/prefill/run-prefill";
import { loadRunRow, updateRun } from "@/lib/prefill/run-store";

// Extraction continues in after() once the 200 is sent
export const maxDuration = 300;

const selectBodySchema = z.object({
  candidateKeys: z.array(z.string().min(1).max(200)).min(1).max(3),
});

/**
 * POST /api/inspections/[id]/prefill/[runId]/select
 * Body: { candidateKeys: string[] } (1–3). Only valid while the run is awaiting_selection;
 * phase 1 never produces candidates, so this always 409s until phase 2.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  const access = await requireInspectionAccess(id, "edit");
  if (!access.ok) return access.response;

  const raw: unknown = await request.json().catch(() => null);
  const parsed = selectBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "candidateKeys must be 1–3 strings", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const run = await loadRunRow(runId);
  if (!run || run.inspectionId !== id) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  if (run.status !== "awaiting_selection") {
    return NextResponse.json({ error: "Run is not awaiting selection" }, { status: 409 });
  }

  await updateRun(runId, { status: "running" });
  const keys = parsed.data.candidateKeys;
  // continuePrefillAfterSelection never throws; the guard keeps a rejection out of after() regardless
  after(async () => {
    try {
      await continuePrefillAfterSelection(runId, keys);
    } catch (err) {
      console.error("[prefill] selection continuation rejected", runId, err);
    }
  });

  return NextResponse.json({ ok: true });
}
