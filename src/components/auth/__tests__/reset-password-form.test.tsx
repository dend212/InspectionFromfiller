import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let getSessionResult: any = { data: { session: null } };
let onAuthChangeCallback: ((event: string) => void) | null = null;
const mockResetPasswordForEmail = vi.fn();
const mockUpdateUser = vi.fn();
const mockUnsubscribe = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: () => Promise.resolve(getSessionResult),
      onAuthStateChange: (callback: (event: string) => void) => {
        onAuthChangeCallback = callback;
        return {
          data: {
            subscription: {
              unsubscribe: mockUnsubscribe,
            },
          },
        };
      },
      resetPasswordForEmail: mockResetPasswordForEmail,
      updateUser: mockUpdateUser,
    },
  }),
}));

import { ResetPasswordForm } from "@/components/auth/reset-password-form";

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  mockPush.mockClear();
  mockResetPasswordForEmail.mockClear();
  mockUpdateUser.mockClear();
  mockUnsubscribe.mockClear();
  getSessionResult = { data: { session: null } };
  onAuthChangeCallback = null;
});

describe("ResetPasswordForm", () => {
  describe("request mode rendering", () => {
    it("renders request reset form by default", async () => {
      render(<ResetPasswordForm />);

      await waitFor(() => {
        expect(screen.getByText("Reset Password")).toBeInTheDocument();
      });
      expect(screen.getByLabelText("Email")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /send reset link/i }),
      ).toBeInTheDocument();
    });

    it("renders back to login link", async () => {
      render(<ResetPasswordForm />);

      await waitFor(() => {
        const link = screen.getByText(/back to login/i);
        expect(link).toHaveAttribute("href", "/login");
      });
    });

    it("renders the logo", async () => {
      render(<ResetPasswordForm />);

      await waitFor(() => {
        expect(screen.getAllByAltText("SewerTime Septic").length).toBeGreaterThan(0);
      });
    });
  });

  describe("request reset submission", () => {
    it("sends reset email on valid submission", async () => {
      mockResetPasswordForEmail.mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      await waitFor(() => {
        expect(screen.getByLabelText("Email")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email"), "test@example.com");
      await user.click(screen.getByRole("button", { name: /send reset link/i }));

      await waitFor(() => {
        expect(mockResetPasswordForEmail).toHaveBeenCalledWith("test@example.com", {
          redirectTo: expect.stringContaining("/auth/confirm?next=/reset-password"),
        });
      });
    });

    it("shows success message after sending", async () => {
      mockResetPasswordForEmail.mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      await waitFor(() => {
        expect(screen.getByLabelText("Email")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email"), "test@example.com");
      await user.click(screen.getByRole("button", { name: /send reset link/i }));

      await waitFor(() => {
        expect(screen.getByText(/check your email/i)).toBeInTheDocument();
      });
    });

    it("shows error on reset failure", async () => {
      mockResetPasswordForEmail.mockResolvedValue({
        error: { message: "Rate limit exceeded" },
      });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      await waitFor(() => {
        expect(screen.getByLabelText("Email")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email"), "test@example.com");
      await user.click(screen.getByRole("button", { name: /send reset link/i }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("Rate limit exceeded");
      });
    });
  });

  describe("update mode", () => {
    it("switches to update mode when session exists", async () => {
      getSessionResult = { data: { session: { access_token: "token" } } };
      render(<ResetPasswordForm />);

      await waitFor(() => {
        expect(screen.getByText("Set New Password")).toBeInTheDocument();
      });

      expect(screen.getByLabelText("New Password")).toBeInTheDocument();
      expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
    });

    it("switches to update mode on PASSWORD_RECOVERY event", async () => {
      render(<ResetPasswordForm />);

      // Wait for initial render
      await waitFor(() => {
        expect(screen.getByText("Reset Password")).toBeInTheDocument();
      });

      // Simulate PASSWORD_RECOVERY auth event
      onAuthChangeCallback?.("PASSWORD_RECOVERY");

      await waitFor(() => {
        expect(screen.getByText("Set New Password")).toBeInTheDocument();
      });
    });
  });

  describe("password update", () => {
    beforeEach(() => {
      getSessionResult = { data: { session: { access_token: "token" } } };
    });

    it("shows error when password is too short", async () => {
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      await waitFor(() => {
        expect(screen.getByLabelText("New Password")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("New Password"), "short");
      await user.type(screen.getByLabelText("Confirm Password"), "short");
      await user.click(screen.getByRole("button", { name: /update password/i }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Password must be at least 8 characters",
        );
      });
    });

    it("shows error when passwords do not match", async () => {
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      await waitFor(() => {
        expect(screen.getByLabelText("New Password")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("New Password"), "password123");
      await user.type(screen.getByLabelText("Confirm Password"), "different123");
      await user.click(screen.getByRole("button", { name: /update password/i }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match");
      });
    });

    it("calls updateUser on valid password update", async () => {
      mockUpdateUser.mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      await waitFor(() => {
        expect(screen.getByLabelText("New Password")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("New Password"), "newpassword123");
      await user.type(screen.getByLabelText("Confirm Password"), "newpassword123");
      await user.click(screen.getByRole("button", { name: /update password/i }));

      await waitFor(() => {
        expect(mockUpdateUser).toHaveBeenCalledWith({ password: "newpassword123" });
      });
    });

    it("shows success message after password update", async () => {
      mockUpdateUser.mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      await waitFor(() => {
        expect(screen.getByLabelText("New Password")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("New Password"), "newpassword123");
      await user.type(screen.getByLabelText("Confirm Password"), "newpassword123");
      await user.click(screen.getByRole("button", { name: /update password/i }));

      await waitFor(() => {
        expect(screen.getByText(/password updated/i)).toBeInTheDocument();
      });
    });

    it("shows error on update failure", async () => {
      mockUpdateUser.mockResolvedValue({
        error: { message: "Token expired" },
      });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      await waitFor(() => {
        expect(screen.getByLabelText("New Password")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("New Password"), "newpassword123");
      await user.type(screen.getByLabelText("Confirm Password"), "newpassword123");
      await user.click(screen.getByRole("button", { name: /update password/i }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("Token expired");
      });
    });
  });

  describe("cleanup", () => {
    it("unsubscribes on unmount", async () => {
      const { unmount } = render(<ResetPasswordForm />);
      unmount();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });
});
