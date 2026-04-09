import crypto from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Shared Bearer-token verification for the /api/webhooks/jobs/* routes.
 *
 * Returns a NextResponse on failure (401 / 500) that the caller should
 * return immediately, or `null` if the request is authorized.
 *
 * Uses timing-safe comparison to avoid leaking secret-length or timing
 * side channels.
 */
export function verifyJobsWebhookAuth(request: Request): NextResponse | null {
  const secret = process.env.JOBS_WEBHOOK_SECRET;
  if (!secret) {
    console.error("JOBS_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(secret);
  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
