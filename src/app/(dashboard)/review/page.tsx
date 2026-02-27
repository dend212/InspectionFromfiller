import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspections, profiles } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AppRole } from "@/types/roles";
import { ClipboardCheck, Clock } from "lucide-react";

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

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In Review",
  completed: "Completed",
  sent: "Sent",
};

const STATUS_COLORS: Record<string, string> = {
  in_review: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
};

function formatDate(date: Date | null): string {
  if (!date) return "N/A";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default async function ReviewQueuePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const role = await getUserRole(supabase);
  const isPrivileged = role === "admin" || role === "office_staff";

  if (!isPrivileged) {
    redirect("/");
  }

  // Query inspections awaiting review
  const reviewQueue = await db
    .select({
      id: inspections.id,
      facilityName: inspections.facilityName,
      facilityAddress: inspections.facilityAddress,
      facilityCity: inspections.facilityCity,
      facilityCounty: inspections.facilityCounty,
      submittedAt: inspections.submittedAt,
      inspectorId: inspections.inspectorId,
    })
    .from(inspections)
    .where(eq(inspections.status, "in_review"))
    .orderBy(desc(inspections.submittedAt));

  // Query recently completed inspections (last 10)
  const recentlyCompleted = await db
    .select({
      id: inspections.id,
      facilityName: inspections.facilityName,
      facilityCity: inspections.facilityCity,
      facilityCounty: inspections.facilityCounty,
      completedAt: inspections.completedAt,
    })
    .from(inspections)
    .where(eq(inspections.status, "completed"))
    .orderBy(desc(inspections.completedAt))
    .limit(10);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Review Queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {reviewQueue.length} inspection{reviewQueue.length !== 1 ? "s" : ""}{" "}
            awaiting review
          </p>
        </div>
      </div>

      {/* In Review Queue */}
      {reviewQueue.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ClipboardCheck className="size-12 text-muted-foreground/50" />
            <p className="mt-4 text-lg font-medium text-muted-foreground">
              No inspections awaiting review
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Submitted inspections will appear here for review.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reviewQueue.map((inspection) => (
            <Link
              key={inspection.id}
              href={`/review/${inspection.id}`}
            >
              <Card className="transition-colors hover:bg-accent/50">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base truncate">
                      {inspection.facilityName || "Untitled Inspection"}
                    </CardTitle>
                    <Badge
                      className={STATUS_COLORS.in_review}
                      variant="secondary"
                    >
                      {STATUS_LABELS.in_review}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="space-y-1">
                    {inspection.facilityCity && (
                      <span className="block">
                        {inspection.facilityCity}
                        {inspection.facilityCounty
                          ? `, ${inspection.facilityCounty} County`
                          : ""}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-xs">
                      <Clock className="size-3" />
                      Submitted {formatDate(inspection.submittedAt)}
                    </span>
                  </CardDescription>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Recently Completed */}
      {recentlyCompleted.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-muted-foreground">
            Recently Completed
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recentlyCompleted.map((inspection) => (
              <Link
                key={inspection.id}
                href={`/review/${inspection.id}`}
              >
                <Card className="transition-colors hover:bg-accent/50">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base truncate">
                        {inspection.facilityName || "Untitled Inspection"}
                      </CardTitle>
                      <Badge
                        className={STATUS_COLORS.completed}
                        variant="secondary"
                      >
                        {STATUS_LABELS.completed}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="space-y-1">
                      {inspection.facilityCity && (
                        <span className="block">
                          {inspection.facilityCity}
                          {inspection.facilityCounty
                            ? `, ${inspection.facilityCounty} County`
                            : ""}
                        </span>
                      )}
                      <span className="block text-xs">
                        Completed {formatDate(inspection.completedAt)}
                      </span>
                    </CardDescription>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
