import crypto from "crypto";
import { eq, ilike } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inspections, profiles } from "@/lib/db/schema";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import { workizWebhookSchema } from "@/lib/validators/workiz-webhook";

/**
 * POST /api/webhooks/workiz
 * Receives job data from Workiz (via n8n), creates a pre-filled draft
 * inspection assigned to the matching tech.
 *
 * When n8n enriches the payload with Maricopa County Assessor data (via APN lookup),
 * the assessor's property owner and address override the Workiz client/address fields
 * for the form. The Workiz customer name is preserved separately for reference.
 *
 * Auth: Bearer token matching WORKIZ_WEBHOOK_SECRET env var.
 */
export async function POST(request: Request) {
  // 1. API key authentication
  const secret = process.env.WORKIZ_WEBHOOK_SECRET;
  if (!secret) {
    console.error("WORKIZ_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Timing-safe comparison to prevent timing attacks
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(secret);
  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse and validate payload
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = workizWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { client, address, job, tech, apn, assessor } = parsed.data;

  // 3. Only create inspections for "ADEQ Inspection" jobs
  const jobType = (job.jobType || job.serviceType || "").trim();
  const isAdeqInspection = jobType.toLowerCase().includes("adeq");
  if (!isAdeqInspection) {
    return NextResponse.json(
      { skipped: true, reason: `Job type "${jobType}" is not an ADEQ inspection` },
      { status: 200 },
    );
  }

  // 4. Idempotency check — if this Workiz job already created an inspection, return it
  if (job.jobId) {
    const [existing] = await db
      .select({ id: inspections.id, status: inspections.status })
      .from(inspections)
      .where(eq(inspections.workizJobId, job.jobId))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { inspectionId: existing.id, status: existing.status, duplicate: true },
        { status: 200 },
      );
    }
  }

  // 5. Look up tech — try email first, fall back to name match
  let techProfile: { id: string; fullName: string } | undefined;

  if (tech.email) {
    const [byEmail] = await db
      .select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(eq(profiles.email, tech.email.toLowerCase()))
      .limit(1);
    techProfile = byEmail;
  }

  if (!techProfile && tech.name) {
    const [byName] = await db
      .select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(ilike(profiles.fullName, tech.name.trim()))
      .limit(1);
    techProfile = byName;
  }

  if (!techProfile) {
    return NextResponse.json(
      { error: `No user found matching tech: ${tech.email || tech.name}` },
      { status: 404 },
    );
  }

  // 6. Build pre-filled form data using existing defaults
  const workizCustomerName = `${client.firstName} ${client.lastName}`.trim();
  const hasAssessor = assessor && assessor.ownerName;
  const formData = getDefaultFormValues(techProfile.fullName);

  if (hasAssessor) {
    // Assessor data available — use property owner as facility name, Workiz customer as seller
    formData.facilityInfo.facilityName = assessor.ownerName;
    formData.facilityInfo.sellerName = assessor.ownerName;
    formData.facilityInfo.facilityAddress = assessor.physicalAddress || address.street;
    formData.facilityInfo.facilityCity = assessor.city || address.city;
    formData.facilityInfo.facilityState = address.state || "AZ";
    formData.facilityInfo.facilityZip = assessor.zip || address.zip;
    formData.facilityInfo.facilityCounty = assessor.county || address.county;
    formData.facilityInfo.taxParcelNumber = assessor.apnFormatted || apn || "";
  } else {
    // No assessor data — use Workiz client/address as before
    formData.facilityInfo.facilityName = workizCustomerName;
    formData.facilityInfo.sellerName = workizCustomerName;
    formData.facilityInfo.facilityAddress = address.street;
    formData.facilityInfo.facilityCity = address.city;
    formData.facilityInfo.facilityState = address.state || "AZ";
    formData.facilityInfo.facilityZip = address.zip;
    formData.facilityInfo.facilityCounty = address.county;
    if (apn) {
      formData.facilityInfo.taxParcelNumber = apn;
    }
  }

  if (job.scheduledDate) {
    formData.facilityInfo.dateOfInspection = job.scheduledDate;
  }

  // Use assessor address for denormalized columns when available
  const displayAddress = hasAssessor
    ? assessor.physicalAddress || address.street
    : address.street;
  const displayCity = hasAssessor ? assessor.city || address.city : address.city;
  const displayCounty = hasAssessor ? assessor.county || address.county : address.county;
  const displayZip = hasAssessor ? assessor.zip || address.zip : address.zip;
  const displayFacilityName = hasAssessor ? assessor.ownerName : workizCustomerName;

  // 7. Insert inspection assigned to the tech
  const [newInspection] = await db
    .insert(inspections)
    .values({
      inspectorId: techProfile.id,
      status: "draft",
      formData,
      // Denormalized columns for dashboard display
      facilityName: displayFacilityName,
      facilityAddress: displayAddress,
      facilityCity: displayCity,
      facilityCounty: displayCounty,
      facilityZip: displayZip,
      customerEmail: client.email || null,
      customerName: workizCustomerName,
      // External integration references
      workizJobId: job.jobId || null,
      apn: apn || null,
    })
    .returning({ id: inspections.id, status: inspections.status });

  return NextResponse.json(
    { inspectionId: newInspection.id, status: newInspection.status },
    { status: 201 },
  );
}
