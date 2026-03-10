import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** In-memory rate limiter: userId → timestamps of recent lookups */
const lookupTimestamps = new Map<string, number[]>();
const MAX_LOOKUPS_PER_HOUR = 30;
const ONE_HOUR_MS = 60 * 60 * 1000;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = lookupTimestamps.get(userId) ?? [];
  const recent = timestamps.filter((t) => now - t < ONE_HOUR_MS);
  if (recent.length >= MAX_LOOKUPS_PER_HOUR) return false;
  recent.push(now);
  lookupTimestamps.set(userId, recent);
  return true;
}

const ARCGIS_URL =
  "https://gis.mcassessor.maricopa.gov/arcgis/rest/services/Parcels/MapServer/0/query";

const OUT_FIELDS = [
  "OWNER_NAME",
  "PHYSICAL_ADDRESS",
  "PHYSICAL_CITY",
  "PHYSICAL_ZIP",
  "JURISDICTION",
  "APN_DASH",
  "LAND_SIZE",
  "CONST_YEAR",
  "SUBNAME",
  "LOT_NUM",
  "BLOCK",
  "STR",
].join(",");

/**
 * GET /api/apn-lookup?apn=123-45-678
 * Looks up property data from Maricopa County Assessor by APN.
 */
export async function GET(request: Request) {
  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkRateLimit(user.id)) {
    return NextResponse.json({ error: "Too many lookups — try again later" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const apn = searchParams.get("apn")?.trim();

  if (!apn) {
    return NextResponse.json({ error: "APN parameter is required" }, { status: 400 });
  }

  // Validate APN format — digits, letters, dashes, spaces; must contain a digit; max 20 chars
  if (apn.length > 20 || !/^[\dA-Za-z -]+$/.test(apn) || !/\d/.test(apn)) {
    return NextResponse.json({ error: "Invalid APN format" }, { status: 400 });
  }

  try {
    const params = new URLSearchParams({
      where: `APN_DASH='${apn}'`,
      outFields: OUT_FIELDS,
      f: "json",
      returnGeometry: "false",
    });

    const response = await fetch(`${ARCGIS_URL}?${params}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Assessor service unavailable" },
        { status: 502 },
      );
    }

    const data = await response.json();
    const feature = data.features?.[0]?.attributes;

    if (!feature) {
      return NextResponse.json(
        { error: "No property found for this APN" },
        { status: 404 },
      );
    }

    const legalParts = [
      feature.SUBNAME || "",
      feature.LOT_NUM ? `Lot ${feature.LOT_NUM}` : "",
      feature.BLOCK ? `Block ${feature.BLOCK}` : "",
      feature.STR ? `STR ${feature.STR}` : "",
    ].filter(Boolean);

    return NextResponse.json({
      assessor: {
        ownerName: feature.OWNER_NAME || "",
        physicalAddress: feature.PHYSICAL_ADDRESS || "",
        city: feature.PHYSICAL_CITY || "",
        zip: feature.PHYSICAL_ZIP || "",
        county: feature.JURISDICTION || "",
        apnFormatted: feature.APN_DASH || "",
        legalDescription: legalParts.join(", "),
        lotSize: String(feature.LAND_SIZE || ""),
        yearBuilt: feature.CONST_YEAR || "",
      },
    });
  } catch (err) {
    console.error("APN lookup failed:", err);
    return NextResponse.json(
      { error: "APN lookup failed" },
      { status: 500 },
    );
  }
}
