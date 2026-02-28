import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUserSchema } from "@/lib/validators/auth";

export async function POST(request: Request) {
  try {
    // Verify caller is authenticated
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify caller is admin by checking JWT claims
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Decode the access token to get the user_role claim
    const tokenPayload = JSON.parse(
      Buffer.from(session.access_token.split(".")[1], "base64").toString(),
    );

    if (tokenPayload.user_role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden: admin access required" },
        { status: 403 },
      );
    }

    // Parse and validate the request body
    const body = await request.json();
    const parsed = createUserSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { email, password, fullName, role } = parsed.data;

    // Create user with admin client (bypasses RLS, uses service role key)
    const adminClient = createAdminClient();
    const { data: newUser, error: createError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

    if (createError) {
      return NextResponse.json(
        { error: createError.message },
        { status: 400 },
      );
    }

    const newUserId = newUser.user.id;

    // Insert profile row — clean up auth user on failure
    const { error: profileError } = await adminClient
      .from("profiles")
      .insert({
        id: newUserId,
        full_name: fullName,
        email,
      });

    if (profileError) {
      // Rollback: delete the auth user we just created
      await adminClient.auth.admin.deleteUser(newUserId);
      return NextResponse.json(
        { error: `Profile creation failed: ${profileError.message}` },
        { status: 400 },
      );
    }

    // Insert role in user_roles table — clean up auth user + profile on failure
    const { error: roleError } = await adminClient
      .from("user_roles")
      .insert({
        user_id: newUserId,
        role,
      });

    if (roleError) {
      // Rollback: delete profile, then auth user
      await adminClient.from("profiles").delete().eq("id", newUserId);
      await adminClient.auth.admin.deleteUser(newUserId);
      return NextResponse.json(
        { error: `Role assignment failed: ${roleError.message}` },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        user: {
          id: newUserId,
          email: newUser.user.email,
          fullName,
          role,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Admin user creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
