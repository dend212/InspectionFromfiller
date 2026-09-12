import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { provenancePatchBodySchema } from "@/lib/prefill/provenance-schema";
import { requireInspectionAccess } from "@/lib/prefill/route-access";

/**
 * PATCH /api/inspections/[id]/provenance
 * Whole-map replace of the per-field provenance sidecar. Body: { fieldProvenance }.
 * Same access rule as PATCH /api/inspections/[id]; form_data is untouched.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireInspectionAccess(id, "edit");
  if (!access.ok) return access.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = provenancePatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid provenance", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Whole-map replace is last-writer-wins across tabs/devices by design (spec §4).
  await db
    .update(inspections)
    .set({ fieldProvenance: parsed.data.fieldProvenance })
    .where(eq(inspections.id, id));

  return NextResponse.json({ saved: true });
}
