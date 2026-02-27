import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/types/roles";
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

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const role = await getUserRole(supabase);
  const displayName =
    user.user_metadata?.full_name || user.email || "User";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        {role && (
          <Badge variant="secondary">{ROLE_LABELS[role]}</Badge>
        )}
      </div>

      {role === "admin" && (
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Welcome, {displayName}. You have admin access.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <QuickLinkCard
              title="Manage Users"
              description="Create and manage user accounts"
              href="/admin/users"
            />
            <QuickLinkCard
              title="All Inspections"
              description="View all inspection reports"
              href="/inspections"
            />
            <QuickLinkCard
              title="New Inspection"
              description="Start a new inspection"
              href="/inspections/new"
            />
          </div>
        </div>
      )}

      {role === "field_tech" && (
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Welcome back, {displayName}. Start a new inspection or view
            your recent inspections.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <QuickLinkCard
              title="New Inspection"
              description="Start a new field inspection"
              href="/inspections/new"
            />
            <QuickLinkCard
              title="My Inspections"
              description="View your recent inspections"
              href="/inspections"
            />
          </div>
        </div>
      )}

      {role === "office_staff" && (
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Welcome, {displayName}. Review pending inspections.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <QuickLinkCard
              title="Review Queue"
              description="Review submitted inspection reports"
              href="/review"
            />
            <QuickLinkCard
              title="All Inspections"
              description="View all inspection reports"
              href="/inspections"
            />
          </div>
        </div>
      )}

      {!role && (
        <p className="text-muted-foreground">
          Welcome, {displayName}. Your account does not have a role
          assigned. Please contact an administrator.
        </p>
      )}
    </div>
  );
}

function QuickLinkCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:bg-accent/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <CardDescription>{description}</CardDescription>
        </CardContent>
      </Card>
    </Link>
  );
}
