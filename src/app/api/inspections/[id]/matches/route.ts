import { NextResponse } from "next/server";
import { z } from "zod";
import { findPossibleDuplicates } from "@/lib/inspection-matches/find";
import { buildMatchQuery, MATCH_FIELD_BODY_MAX } from "@/lib/inspection-matches/normalize";
import { requireInspectionAccess } from "@/lib/prefill/route-access";
import { logDbError } from "@/lib/workiz/log-db-error";
import type { InspectionMatchResult } from "@/types/inspection-matches";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const matchField = z.string().max(MATCH_FIELD_BODY_MAX).optional();

/** Body-size caps only: an unusable value is ignored per field by buildMatchQuery, never rejected */
const inspectionMatchRequestSchema = z
  .object({
    facilityAddress: matchField,
    facilityCity: matchField,
    facilityZip: matchField,
    taxParcelNumber: matchField,
  })
  .strict();

const NO_STORE = { "Cache-Control": "no-store" };
const EMPTY: InspectionMatchResult = { matches: [], hiddenCount: 0, truncated: false };

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/**
 * POST /api/inspections/[id]/matches — possible-duplicate check for the live Step 1 values
 * (duplicate-warning spec §6.1). A POST so addresses and APNs stay out of URLs and logs. Changes
 * nothing. Responses carry fixed messages only; the input is never echoed.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return json({ error: "Inspection not found" }, 404);

  const access = await requireInspectionAccess(id, "view");
  if (!access.ok) return access.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const parsed = inspectionMatchRequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid request" }, 400);

  const query = buildMatchQuery(parsed.data);
  if (!query) return json(EMPTY);

  try {
    const result = await findPossibleDuplicates(
      query,
      { userId: access.userId, privileged: access.isPrivileged },
      { excludeInspectionId: id },
    );
    return json(result);
  } catch (err) {
    logDbError("match_lookup", err, {}, "inspection-matches");
    return json({ error: "Couldn't check for matching reports", code: "internal" }, 500);
  }
}
