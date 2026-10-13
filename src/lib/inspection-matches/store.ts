import "server-only";
import { and, desc, eq, inArray, ne, or, type SQL, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { inspections, profiles } from "@/lib/db/schema";

/**
 * The possible-duplicate check's only DB access (duplicate-warning spec §7.1): one bounded
 * SELECT. The WHERE is a SUPERSET prefilter — match.ts decides. Only house numbers (^\d{1,8}$)
 * and APN keys ([0-9A-Z]{6,20}) reach SQL, always as bound parameters. Callers log failures with
 * logDbError only: a Drizzle error message carries these params.
 */

export interface MatchCandidateRow {
  id: string;
  inspectorId: string;
  status: string;
  facilityAddress: string | null;
  facilityCity: string | null;
  facilityZip: string | null;
  apn: string | null;
  taxParcelNumber: string | null;
  inspectionDate: string | null;
  createdAt: Date;
  workizJobId: string | null;
  inspectorName: string | null;
}

export interface CandidateQueryArgs {
  houseNumbers: string[];
  apnKeys: string[];
  excludeInspectionId?: string;
  limit: number;
}

const FORM_APN = sql`${inspections.formData} -> 'facilityInfo' ->> 'taxParcelNumber'`;

/** Same leading-number rule as parseStreetAddress; [[:space:]]* also skips tabs/newlines */
const HOUSE_NUMBER = sql`substring(${inspections.facilityAddress} from '^[[:space:]]*([0-9]{1,8})[[:space:]]')`;

const compactApn = (value: SQL) => sql`upper(regexp_replace(coalesce(${value}, ''), '[^0-9A-Za-z]', '', 'g'))`;

/** Typed columns so createdAt goes through the timestamp mapper and arrives as a Date */
export const CANDIDATE_FIELDS = {
  id: inspections.id,
  inspectorId: inspections.inspectorId,
  status: inspections.status,
  facilityAddress: inspections.facilityAddress,
  facilityCity: inspections.facilityCity,
  facilityZip: inspections.facilityZip,
  apn: inspections.apn,
  taxParcelNumber: sql<string | null>`${FORM_APN}`,
  inspectionDate: sql<string | null>`${inspections.formData} -> 'facilityInfo' ->> 'dateOfInspection'`,
  createdAt: inspections.createdAt,
  workizJobId: inspections.workizJobId,
  inspectorName: profiles.fullName,
};

type AnyPgDatabase = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

/** The SELECT builder (exported so a test can inspect `.toSQL()`); null when nothing to match on */
export function candidateQuery(database: AnyPgDatabase, args: CandidateQueryArgs) {
  const branches: SQL[] = [];
  if (args.houseNumbers.length > 0) branches.push(inArray(HOUSE_NUMBER, args.houseNumbers));
  if (args.apnKeys.length > 0) {
    branches.push(inArray(compactApn(sql`${inspections.apn}`), args.apnKeys));
    branches.push(inArray(compactApn(FORM_APN), args.apnKeys));
  }
  if (branches.length === 0) return null;
  const anyBranch = or(...branches);
  const where = args.excludeInspectionId ? and(ne(inspections.id, args.excludeInspectionId), anyBranch) : anyBranch;
  return database
    .select(CANDIDATE_FIELDS)
    .from(inspections)
    .leftJoin(profiles, eq(profiles.id, inspections.inspectorId))
    .where(where)
    .orderBy(desc(inspections.createdAt))
    .limit(args.limit + 1);
}

/** Asks for limit + 1 rows: capHit only when the extra row came back (it is then dropped) */
export async function findMatchCandidates(
  args: CandidateQueryArgs,
): Promise<{ rows: MatchCandidateRow[]; capHit: boolean }> {
  const query = candidateQuery(db, args);
  if (!query) return { rows: [], capHit: false };
  const rows: MatchCandidateRow[] = await query;
  const capHit = rows.length > args.limit;
  return { rows: capHit ? rows.slice(0, args.limit) : rows, capHit };
}
