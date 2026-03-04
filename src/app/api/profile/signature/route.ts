import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

const MAX_SIGNATURE_SIZE = 100_000; // ~100KB data URL limit

/**
 * GET /api/profile/signature
 * Returns the current user's stored signature data URL.
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
    .select({ signatureDataUrl: profiles.signatureDataUrl })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  return NextResponse.json({ signatureDataUrl: profile?.signatureDataUrl ?? null });
}

/**
 * PUT /api/profile/signature
 * Saves a new signature data URL to the current user's profile.
 */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const signatureDataUrl = body?.signatureDataUrl;

  if (typeof signatureDataUrl !== "string" || !signatureDataUrl.startsWith("data:image/png;base64,")) {
    return NextResponse.json({ error: "Invalid signature format" }, { status: 400 });
  }

  if (signatureDataUrl.length > MAX_SIGNATURE_SIZE) {
    return NextResponse.json({ error: "Signature too large" }, { status: 400 });
  }

  await db
    .update(profiles)
    .set({ signatureDataUrl, updatedAt: new Date() })
    .where(eq(profiles.id, user.id));

  return NextResponse.json({ success: true });
}
