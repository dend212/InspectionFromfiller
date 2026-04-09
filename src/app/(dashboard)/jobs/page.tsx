import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { jobs, profiles } from "@/lib/db/schema";
import { getUserRole } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 20;

const STATUS_LABELS: Record<"open" | "in_progress" | "completed", string> = {
  open: "Open",
  in_progress: "In Progress",
  completed: "Completed",
};

function StatusBadge({ status }: { status: "open" | "in_progress" | "completed" }) {
  const styles: Record<typeof status, string> = {
    open: "bg-slate-100 text-slate-700",
    in_progress: "bg-blue-100 text-blue-800",
    completed: "bg-emerald-100 text-emerald-800",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(supabase);
  if (!role) redirect("/login");

  const { status, q, page } = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(page || "1", 10) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  const conditions = [];
  if (role === "field_tech") conditions.push(eq(jobs.assignedTo, user.id));
  if (status && status !== "all") {
    if (["open", "in_progress", "completed"].includes(status)) {
      conditions.push(eq(jobs.status, status as "open" | "in_progress" | "completed"));
    }
  }
  if (q?.trim()) {
    const like = `%${q.trim()}%`;
    const orCondition = or(
      ilike(jobs.title, like),
      ilike(jobs.customerName, like),
      ilike(jobs.serviceAddress, like),
    );
    if (orCondition) conditions.push(orCondition);
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
      updatedAt: jobs.updatedAt,
      assigneeName: profiles.fullName,
    })
    .from(jobs)
    .leftJoin(profiles, eq(profiles.id, jobs.assignedTo))
    .where(where)
    .orderBy(desc(jobs.updatedAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(jobs)
    .where(where);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Jobs</h1>
          <p className="text-muted-foreground text-sm">General service visits and non-ADEQ work.</p>
        </div>
        <Button asChild>
          <Link href="/jobs/new">New Job</Link>
        </Button>
      </div>

      <form className="flex flex-wrap gap-2" method="get">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by title, customer, address"
          className="h-9 flex-1 min-w-[220px] rounded-md border bg-background px-3 text-sm"
        />
        <select
          name="status"
          defaultValue={status ?? "all"}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No jobs match these filters.
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3">Assignee</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/jobs/${j.id}`} className="text-primary hover:underline">
                      {j.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{j.customerName || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {[j.serviceAddress, j.city, j.state].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{j.assigneeName || "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={j.status as "open" | "in_progress" | "completed"} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {j.updatedAt.toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {pageNum} of {totalPages} ({total} total)
          </span>
          <div className="flex gap-2">
            {pageNum > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link
                  href={{
                    pathname: "/jobs",
                    query: {
                      ...(status ? { status } : {}),
                      ...(q ? { q } : {}),
                      page: pageNum - 1,
                    },
                  }}
                >
                  Previous
                </Link>
              </Button>
            )}
            {pageNum < totalPages && (
              <Button asChild variant="outline" size="sm">
                <Link
                  href={{
                    pathname: "/jobs",
                    query: {
                      ...(status ? { status } : {}),
                      ...(q ? { q } : {}),
                      page: pageNum + 1,
                    },
                  }}
                >
                  Next
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
