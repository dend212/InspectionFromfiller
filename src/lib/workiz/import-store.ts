import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { inspections, profiles } from "@/lib/db/schema";

/**
 * DB access for the Workiz routes. Callers wrap every call in try/catch and log failures with
 * logDbError only (Drizzle error messages carry the query params — PII).
 */

export interface ImportedInspectionRow {
  id: string;
  inspectorId: string;
  status: string;
  workizJobId: string | null;
}

/** Matches the uuid (what the import and the webhook store) and the JOB-… id */
export async function findInspectionsByWorkizIds(
  ids: ReadonlyArray<string | null | undefined>,
): Promise<ImportedInspectionRow[]> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return [];
  return db
    .select({
      id: inspections.id,
      inspectorId: inspections.inspectorId,
      status: inspections.status,
      workizJobId: inspections.workizJobId,
    })
    .from(inspections)
    .where(inArray(inspections.workizJobId, unique));
}

export type ImportedInspectionValues = Pick<
  typeof inspections.$inferInsert,
  | "inspectorId"
  | "status"
  | "formData"
  | "fieldProvenance"
  | "facilityAddress"
  | "facilityCity"
  | "facilityZip"
  | "facilityCounty"
  | "facilityName"
  | "customerEmail"
  | "customerName"
  | "workizJobId"
  | "apn"
>;

export async function insertImportedInspection(values: ImportedInspectionValues): Promise<string> {
  const [row] = await db.insert(inspections).values(values).returning({ id: inspections.id });
  return row.id;
}

export async function loadProfileFullName(userId: string): Promise<string | null> {
  const [profile] = await db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return profile?.fullName ?? null;
}

export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}
