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
    // The Custom Access Token Hook injects user_role into the JWT
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
        email_confirm: true, // Skip email confirmation since admin is creating
        user_metadata: { full_name: fullName },
      });

    if (createError) {
      return NextResponse.json(
        { error: createError.message },
        { status: 400 },
      );
    }

    // Insert profile row
    const { error: profileError } = await adminClient
      .from("profiles")
      .insert({
        id: newUser.user.id,
        full_name: fullName,
        email,
      });

    if (profileError) {
      return NextResponse.json(
        { error: `Profile creation failed: ${profileError.message}` },
        { status: 400 },
      );
    }

    // Insert role in user_roles table
    const { error: roleError } = await adminClient
      .from("user_roles")
      .insert({
        user_id: newUser.user.id,
        role,
      });

    if (roleError) {
      return NextResponse.json(
        { error: `Role assignment failed: ${roleError.message}` },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        user: {
          id: newUser.user.id,
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
