import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AppRole } from "@/types/roles";

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

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  submitted: "default",
  in_review: "default",
  completed: "outline",
  sent: "outline",
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default async function InspectionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const role = await getUserRole(supabase);
  const isPrivileged = role === "admin" || role === "office_staff";

  const results = isPrivileged
    ? await db
        .select({
          id: inspections.id,
          status: inspections.status,
          facilityName: inspections.facilityName,
          facilityAddress: inspections.facilityAddress,
          facilityCity: inspections.facilityCity,
          facilityCounty: inspections.facilityCounty,
          createdAt: inspections.createdAt,
          updatedAt: inspections.updatedAt,
        })
        .from(inspections)
        .orderBy(desc(inspections.updatedAt))
    : await db
        .select({
          id: inspections.id,
          status: inspections.status,
          facilityName: inspections.facilityName,
          facilityAddress: inspections.facilityAddress,
          facilityCity: inspections.facilityCity,
          facilityCounty: inspections.facilityCounty,
          createdAt: inspections.createdAt,
          updatedAt: inspections.updatedAt,
        })
        .from(inspections)
        .where(eq(inspections.inspectorId, user.id))
        .orderBy(desc(inspections.updatedAt));

  const pageTitle = isPrivileged ? "All Inspections" : "My Inspections";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{pageTitle}</h1>
        <Button asChild>
          <Link href="/inspections/new">New Inspection</Link>
        </Button>
      </div>

      {results.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-lg font-medium text-muted-foreground">
              No inspections yet
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Start your first inspection to get going.
            </p>
            <Button asChild className="mt-4">
              <Link href="/inspections/new">Start New Inspection</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((inspection) => (
            <Link
              key={inspection.id}
              href={
                inspection.status === "draft"
                  ? `/inspections/${inspection.id}/edit`
                  : `/inspections/${inspection.id}/edit`
              }
            >
              <Card className="transition-colors hover:bg-accent/50">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base truncate">
                      {inspection.facilityName || "Untitled Inspection"}
                    </CardTitle>
                    <Badge variant={STATUS_VARIANTS[inspection.status] ?? "secondary"}>
                      {STATUS_LABELS[inspection.status] ?? inspection.status}
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
                      Updated {formatDate(inspection.updatedAt)}
                    </span>
                  </CardDescription>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
