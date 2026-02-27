import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/notifications/settings
 * Return the current user's notification settings.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [profile] = await db
    .select({ notificationSettings: profiles.notificationSettings })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  return NextResponse.json(
    profile?.notificationSettings ?? { emailOnSubmission: false }
  );
}

/**
 * PUT /api/notifications/settings
 * Update the current user's notification settings.
 */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await request.json();

  await db
    .update(profiles)
    .set({
      notificationSettings: settings,
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, user.id));

  return NextResponse.json(settings);
}
