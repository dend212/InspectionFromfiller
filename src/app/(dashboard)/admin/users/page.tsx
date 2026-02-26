import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { profiles, userRoles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { CreateUserForm } from "@/components/admin/create-user-form";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ROLE_LABELS } from "@/types/roles";
import type { AppRole } from "@/types/roles";

async function getAdminRole(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(session.access_token.split(".")[1], "base64").toString()
    );
    return payload.user_role === "admin";
  } catch {
    return false;
  }
}

async function getUsers() {
  const users = await db
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      email: profiles.email,
      role: userRoles.role,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .leftJoin(userRoles, eq(profiles.id, userRoles.userId))
    .orderBy(profiles.createdAt);

  return users;
}

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const isAdmin = await getAdminRole(supabase);
  if (!isAdmin) {
    redirect("/");
  }

  const users = await getUsers();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Manage Users</h1>
        <p className="text-muted-foreground mt-1">
          Create new user accounts and manage existing users.
        </p>
      </div>

      {/* Create User Section */}
      <div className="max-w-md">
        <h2 className="text-lg font-semibold mb-4">Create New User</h2>
        <CreateUserForm />
      </div>

      {/* Users List Section */}
      <div>
        <h2 className="text-lg font-semibold mb-4">
          Existing Users ({users.length})
        </h2>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-muted-foreground py-6"
                  >
                    No users found.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.fullName}
                    </TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      {u.role ? (
                        <Badge variant="secondary">
                          {ROLE_LABELS[u.role as AppRole]}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          No role
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.createdAt
                        ? new Date(u.createdAt).toLocaleDateString()
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
