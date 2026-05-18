/**
 * Canonical origin (scheme + host, no trailing slash) for building customer-facing
 * URLs that go into emails, webhook responses, magic links, share tokens, etc.
 *
 * Precedence:
 *   1. NEXT_PUBLIC_APP_URL  (preferred — explicit production app URL)
 *   2. NEXT_PUBLIC_SITE_URL (legacy alias; same value)
 *   3. request origin header (last-resort fallback for server routes)
 *
 * Set BOTH env vars to the production domain in Vercel so links never leak
 * preview/vercel.app/localhost URLs into customer emails.
 */
export function getAppUrl(request?: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return stripTrailingSlash(fromEnv);

  const fromOrigin = request?.headers.get("origin");
  if (fromOrigin) return stripTrailingSlash(fromOrigin);

  return "";
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
