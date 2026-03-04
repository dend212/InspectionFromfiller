import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Tests for loadPublicFile
// ---------------------------------------------------------------------------

describe("loadPublicFile", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("browser environment (window defined in jsdom)", () => {
    it("uses fetch() with relative URL in browser", async () => {
      const mockArrayBuffer = new ArrayBuffer(10);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      });

      const { loadPublicFile } = await import("@/lib/pdf/load-public-file");
      const result = await loadPublicFile("/test-file.pdf");

      expect(globalThis.fetch).toHaveBeenCalledWith("/test-file.pdf");
      expect(result).toBe(mockArrayBuffer);
    });

    it("throws on HTTP error response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const { loadPublicFile } = await import("@/lib/pdf/load-public-file");
      await expect(loadPublicFile("/missing-file.pdf")).rejects.toThrow(
        "Failed to load /missing-file.pdf: 404 Not Found",
      );
    });

    it("throws on HTTP 500 error", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const { loadPublicFile } = await import("@/lib/pdf/load-public-file");
      await expect(loadPublicFile("/test.pdf")).rejects.toThrow(
        "Failed to load /test.pdf: 500 Internal Server Error",
      );
    });

    it("throws on network error", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const { loadPublicFile } = await import("@/lib/pdf/load-public-file");
      await expect(loadPublicFile("/test.pdf")).rejects.toThrow("Network error");
    });

    it("passes through the relative path unchanged", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });

      const { loadPublicFile } = await import("@/lib/pdf/load-public-file");
      await loadPublicFile("/fonts/LiberationSans-Regular.ttf");

      expect(globalThis.fetch).toHaveBeenCalledWith("/fonts/LiberationSans-Regular.ttf");
    });

    it("returns an ArrayBuffer", async () => {
      const mockArrayBuffer = new ArrayBuffer(10);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      });

      const { loadPublicFile } = await import("@/lib/pdf/load-public-file");
      const result = await loadPublicFile("/test.pdf");

      expect(result).toBeInstanceOf(ArrayBuffer);
    });

    it("handles various file paths", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });

      const { loadPublicFile } = await import("@/lib/pdf/load-public-file");

      // PDF template
      await loadPublicFile("/septic_system_insp_form_v2.pdf");
      expect(globalThis.fetch).toHaveBeenCalledWith("/septic_system_insp_form_v2.pdf");

      // Logo
      await loadPublicFile("/sewertime-logo.png");
      expect(globalThis.fetch).toHaveBeenCalledWith("/sewertime-logo.png");

      // Font
      await loadPublicFile("/fonts/LiberationSans-Bold.ttf");
      expect(globalThis.fetch).toHaveBeenCalledWith("/fonts/LiberationSans-Bold.ttf");
    });
  });

  describe("function signature", () => {
    it("exports loadPublicFile as a named export", async () => {
      const mod = await import("@/lib/pdf/load-public-file");
      expect(typeof mod.loadPublicFile).toBe("function");
    });

    it("returns a Promise<ArrayBuffer>", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(5)),
      });

      const { loadPublicFile } = await import("@/lib/pdf/load-public-file");
      const promise = loadPublicFile("/test.pdf");

      expect(promise).toBeInstanceOf(Promise);
      const result = await promise;
      expect(result).toBeInstanceOf(ArrayBuffer);
    });
  });
});
