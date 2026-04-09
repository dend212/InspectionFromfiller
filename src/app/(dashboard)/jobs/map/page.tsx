import { and, desc, inArray, or, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { type JobMapItem, JobsMapView } from "@/components/jobs/jobs-map-view";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { jobs, profiles } from "@/lib/db/schema";
import { getUserRole } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * /jobs/map — plots all jobs with an address on a Google Map.
 *
 * Role scoping mirrors /jobs: admins and office staff see every job, field
 * technicians see only their own. Jobs without any address data are still
 * reported in the footer but not plotted.
 */
export default async function JobsMapPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(supabase);
  if (!role) redirect("/login");

  const conditions = [];
  if (role === "field_tech") {
    const visCond = or(
      sql`cardinality(${jobs.assignees}) = 0`,
      sql`${user.id}::uuid = ANY(${jobs.assignees})`,
    );
    if (visCond) conditions.push(visCond);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      status: jobs.status,
      customerName: jobs.customerName,
      serviceAddress: jobs.serviceAddress,
      city: jobs.city,
      state: jobs.state,
      zip: jobs.zip,
      assignees: jobs.assignees,
    })
    .from(jobs)
    .where(where)
    .orderBy(desc(jobs.updatedAt));

  // Batch-resolve assignee names
  const allAssigneeIds = Array.from(new Set(rows.flatMap((r) => r.assignees)));
  const assigneeProfiles = allAssigneeIds.length
    ? await db
        .select({ id: profiles.id, fullName: profiles.fullName })
        .from(profiles)
        .where(inArray(profiles.id, allAssigneeIds))
    : [];
  const nameById = new Map(assigneeProfiles.map((p) => [p.id, p.fullName] as const));

  const mapItems: JobMapItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status as "open" | "in_progress" | "completed",
    customerName: r.customerName,
    serviceAddress: r.serviceAddress,
    city: r.city,
    state: r.state,
    zip: r.zip,
    assigneeNames: r.assignees.map((id) => nameById.get(id) ?? "Unknown"),
  }));

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Jobs Map</h1>
          <p className="text-muted-foreground text-sm">
            {role === "field_tech"
              ? "Your assigned service visits plotted by address."
              : "All service visits plotted by address."}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/jobs">
            <ArrowLeft className="mr-1.5 size-4" />
            Back to list
          </Link>
        </Button>
      </div>

      <JobsMapView jobs={mapItems} />
    </div>
  );
}
