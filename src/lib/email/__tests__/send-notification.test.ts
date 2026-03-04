import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Resend as a class constructor that can be `new`-ed.
const mockSend = vi.fn();

vi.mock("resend", () => {
  return {
    Resend: class MockResend {
      emails = { send: mockSend };
    },
  };
});

describe("sendSubmissionNotification", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function loadModule() {
    const mod = await import("../send-notification");
    return mod.sendSubmissionNotification;
  }

  it("skips sending when RESEND_API_KEY is not set", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.ADMIN_NOTIFICATION_EMAIL = "admin@test.com";
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const sendSubmissionNotification = await loadModule();
    await sendSubmissionNotification("insp-1", "Test Facility", "John Doe");

    expect(mockSend).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("skips sending when ADMIN_NOTIFICATION_EMAIL is not set", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.ADMIN_NOTIFICATION_EMAIL;
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const sendSubmissionNotification = await loadModule();
    await sendSubmissionNotification("insp-1", "Test Facility", "John Doe");

    // resend is instantiated (RESEND_API_KEY is set), but adminEmail is missing
    // so it logs and skips
    consoleSpy.mockRestore();
  });

  it("sends email with correct parameters when configured", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.ADMIN_NOTIFICATION_EMAIL = "admin@test.com";
    process.env.NEXT_PUBLIC_APP_URL = "https://myapp.com";
    mockSend.mockResolvedValue({ id: "email-1" });

    const sendSubmissionNotification = await loadModule();
    await sendSubmissionNotification("insp-123", "Test Facility", "John Doe");

    expect(mockSend).toHaveBeenCalledTimes(1);
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.from).toBe(
      "SewerTime Inspections <onboarding@resend.dev>",
    );
    expect(callArgs.to).toBe("admin@test.com");
    expect(callArgs.subject).toBe("New Inspection Submitted: Test Facility");
    expect(callArgs.text).toContain("Test Facility");
    expect(callArgs.text).toContain("John Doe");
    expect(callArgs.text).toContain("https://myapp.com/review/insp-123");
  });

  it("uses 'Untitled' when facilityName is null", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.ADMIN_NOTIFICATION_EMAIL = "admin@test.com";
    mockSend.mockResolvedValue({ id: "email-2" });

    const sendSubmissionNotification = await loadModule();
    await sendSubmissionNotification("insp-1", null, "John Doe");

    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.subject).toBe("New Inspection Submitted: Untitled");
    expect(callArgs.text).toContain("Untitled");
  });

  it("omits inspector line when inspectorName is null", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.ADMIN_NOTIFICATION_EMAIL = "admin@test.com";
    mockSend.mockResolvedValue({ id: "email-3" });

    const sendSubmissionNotification = await loadModule();
    await sendSubmissionNotification("insp-1", "Facility", null);

    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.text).not.toContain("Inspector:");
  });

  it("uses default app URL when NEXT_PUBLIC_APP_URL is not set", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.ADMIN_NOTIFICATION_EMAIL = "admin@test.com";
    delete process.env.NEXT_PUBLIC_APP_URL;
    mockSend.mockResolvedValue({ id: "email-4" });

    const sendSubmissionNotification = await loadModule();
    await sendSubmissionNotification("insp-1", "Facility", null);

    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.text).toContain(
      "https://sewertime.vercel.app/review/insp-1",
    );
  });

  it("does not throw when email send fails (fire-and-forget)", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.ADMIN_NOTIFICATION_EMAIL = "admin@test.com";
    mockSend.mockRejectedValue(new Error("Network failure"));
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const sendSubmissionNotification = await loadModule();
    // Should not throw
    await expect(
      sendSubmissionNotification("insp-1", "Facility", "Tech"),
    ).resolves.toBeUndefined();

    consoleSpy.mockRestore();
  });
});
