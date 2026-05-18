import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAppUrl } from "@/lib/app-url";

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;
const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
  process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE_URL;
});

function makeRequest(origin?: string): Request {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return new Request("https://example.com/", { headers });
}

describe("getAppUrl", () => {
  it("prefers NEXT_PUBLIC_APP_URL over NEXT_PUBLIC_SITE_URL and request origin", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://inspections.sewertime.com";
    process.env.NEXT_PUBLIC_SITE_URL = "https://old-site.example.com";
    expect(getAppUrl(makeRequest("https://preview.vercel.app"))).toBe(
      "https://inspections.sewertime.com",
    );
  });

  it("falls back to NEXT_PUBLIC_SITE_URL when NEXT_PUBLIC_APP_URL is missing", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://inspections.sewertime.com";
    expect(getAppUrl(makeRequest("https://preview.vercel.app"))).toBe(
      "https://inspections.sewertime.com",
    );
  });

  it("falls back to request origin when both env vars are missing", () => {
    expect(getAppUrl(makeRequest("https://request-origin.example.com"))).toBe(
      "https://request-origin.example.com",
    );
  });

  it("returns empty string when no env var and no request is provided", () => {
    expect(getAppUrl()).toBe("");
  });

  it("strips trailing slash from env value", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://inspections.sewertime.com/";
    expect(getAppUrl()).toBe("https://inspections.sewertime.com");
  });

  it("strips trailing slash from request origin fallback", () => {
    expect(getAppUrl(makeRequest("https://example.com/"))).toBe("https://example.com");
  });

  it("does not leak preview/vercel.app domain when env is correctly set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://inspections.sewertime.com";
    expect(getAppUrl(makeRequest("https://my-branch.vercel.app"))).not.toContain("vercel.app");
  });
});
