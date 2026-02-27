import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspections, profiles, inspectionEmails } from "@/lib/db/schema";
import {
  eq,
  desc,
  asc,
  ilike,
  or,
  and,
  count,
  sql,
  inArray,
} from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/dashboard/search-bar";
import { StatusTabs } from "@/components/dashboard/status-tabs";
import { InspectionsTable } from "@/components/dashboard/inspections-table";
import type { InspectionRow } from "@/components/dashboard/inspections-table";
import type { AppRole } from "@/types/roles";

const PAGE_SIZE = 20;

async function getUserRole(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<AppRole | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(session.access_token.split(".")[1], "base64").toString()
    );
    return payload.user_role ?? null;
  } catch {
    return null;
  }
}

export default async function InspectionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    sort?: string;
    order?: string;
    page?: string;
  }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const role = await getUserRole(supabase);
  const isPrivileged = role === "admin" || role === "office_staff";

  const { q, status, sort, order, page } = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(page || "1", 10) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  // Build filter conditions
  const conditions = [];

  // Role filter: field techs see only their own
  if (!isPrivileged) {
    conditions.push(eq(inspections.inspectorId, user.id));
  }

  // Status filter
  if (status && status !== "all") {
    conditions.push(eq(inspections.status, status as typeof inspections.status.enumValues[number]));
  }

  // Text search across multiple columns
  if (q) {
    conditions.push(
      or(
        ilike(inspections.facilityAddress, `%${q}%`),
        ilike(inspections.facilityCity, `%${q}%`),
        ilike(inspections.facilityName, `%${q}%`),
        ilike(inspections.customerName, `%${q}%`)
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Determine sort column and direction
  const sortColumnMap: Record<string, typeof inspections.facilityAddress | typeof inspections.createdAt | typeof inspections.customerName | typeof inspections.status> = {
    address: inspections.facilityAddress,
    date: inspections.createdAt,
    customer: inspections.customerName,
    status: inspections.status,
  };
  const sortCol = sortColumnMap[sort || ""] || inspections.createdAt;
  const sortDir = order === "asc" ? asc : desc;

  // Main query with inspector join
  const results = await db
    .select({
      id: inspections.id,
      facilityAddress: inspections.facilityAddress,
      customerName: inspections.customerName,
      status: inspections.status,
      createdAt: inspections.createdAt,
      completedAt: inspections.completedAt,
      finalizedPdfPath: inspections.finalizedPdfPath,
      inspectorName: profiles.fullName,
    })
    .from(inspections)
    .leftJoin(profiles, eq(inspections.inspectorId, profiles.id))
    .where(whereClause)
    .orderBy(sortDir(sortCol))
    .limit(PAGE_SIZE)
    .offset(offset);

  // Count query for pagination
  const [{ total }] = await db
    .select({ total: count() })
    .from(inspections)
    .where(whereClause);

  const totalCount = Number(total);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Email sent counts for the current page
  const inspectionIds = results.map((r) => r.id);
  let emailCountMap: Record<string, number> = {};

  if (inspectionIds.length > 0) {
    const emailCounts = await db
      .select({
        inspectionId: inspectionEmails.inspectionId,
        emailCount: count(),
      })
      .from(inspectionEmails)
      .where(inArray(inspectionEmails.inspectionId, inspectionIds))
      .groupBy(inspectionEmails.inspectionId);

    emailCountMap = Object.fromEntries(
      emailCounts.map((row) => [row.inspectionId, Number(row.emailCount)])
    );
  }

  // Status counts for tabs (apply role filter but NOT text search)
  const tabConditions = [];
  if (!isPrivileged) {
    tabConditions.push(eq(inspections.inspectorId, user.id));
  }
  const tabWhereClause =
    tabConditions.length > 0 ? and(...tabConditions) : undefined;

  const statusCountRows = await db
    .select({
      status: inspections.status,
      statusCount: count(),
    })
    .from(inspections)
    .where(tabWhereClause)
    .groupBy(inspections.status);

  const statusCounts = {
    all: 0,
    draft: 0,
    in_review: 0,
    completed: 0,
  };

  for (const row of statusCountRows) {
    const c = Number(row.statusCount);
    statusCounts.all += c;
    if (row.status === "draft") {
      statusCounts.draft += c;
    } else if (row.status === "submitted" || row.status === "in_review") {
      statusCounts.in_review += c;
    } else if (row.status === "completed") {
      statusCounts.completed += c;
    } else if (row.status === "sent") {
      // Sent counts toward completed for tab purposes
      statusCounts.completed += c;
    }
  }

  // Map to InspectionRow for client component
  const mappedRows: InspectionRow[] = results.map((r) => ({
    id: r.id,
    facilityAddress: r.facilityAddress,
    customerName: r.customerName,
    status: r.status,
    inspectorName: r.inspectorName ?? "Unknown",
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    finalizedPdfPath: r.finalizedPdfPath,
    emailSentCount: emailCountMap[r.id] ?? 0,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Inspections</h1>
        <Button asChild>
          <Link href="/inspections/new">New Inspection</Link>
        </Button>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <StatusTabs activeStatus={status || "all"} counts={statusCounts} />
        <SearchBar defaultValue={q} />
      </div>
      <InspectionsTable
        inspections={mappedRows}
        sortColumn={sort || "date"}
        sortOrder={order || "desc"}
        isPrivileged={isPrivileged}
        page={pageNum}
        totalPages={totalPages}
        totalCount={totalCount}
      />
    </div>
  );
}
