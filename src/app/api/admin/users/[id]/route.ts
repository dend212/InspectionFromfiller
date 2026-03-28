import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: targetUserId } = await params;

    // Verify caller is authenticated
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Prevent self-deletion
    if (user.id === targetUserId) {
      return NextResponse.json(
        { error: "You cannot delete your own account" },
        { status: 400 },
      );
    }

    // Verify caller is admin by checking JWT claims
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tokenPayload = JSON.parse(
      Buffer.from(session.access_token.split(".")[1], "base64").toString(),
    );

    if (tokenPayload.user_role !== "admin") {
      return NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 });
    }

    // Delete using admin client — profile + user_roles cascade from auth user deletion
    const adminClient = createAdminClient();

    // Delete profile first (user_roles cascades via FK)
    const { error: profileError } = await adminClient
      .from("profiles")
      .delete()
      .eq("id", targetUserId);

    if (profileError) {
      return NextResponse.json(
        { error: `Failed to delete profile: ${profileError.message}` },
        { status: 400 },
      );
    }

    // Delete auth user
    const { error: authError } = await adminClient.auth.admin.deleteUser(targetUserId);

    if (authError) {
      return NextResponse.json(
        { error: `Failed to delete auth user: ${authError.message}` },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Admin user deletion error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
