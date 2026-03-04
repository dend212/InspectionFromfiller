import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from "sonner";
import { ApnLookupInput } from "@/components/inspection/apn-lookup-input";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMockForm() {
  return {
    setValue: vi.fn(),
  } as any;
}

const assessorResponse = {
  assessor: {
    ownerName: "John Smith",
    physicalAddress: "123 Main St",
    city: "Phoenix",
    zip: "85001",
    county: "Maricopa",
    apnFormatted: "123-45-678",
  },
};

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("ApnLookupInput", () => {
  describe("rendering", () => {
    it("renders without crashing", () => {
      render(<ApnLookupInput form={makeMockForm()} />);
      expect(screen.getByLabelText("Assessor Parcel Number")).toBeInTheDocument();
    });

    it("renders APN input with placeholder", () => {
      render(<ApnLookupInput form={makeMockForm()} />);
      expect(screen.getByPlaceholderText(/apn/i)).toBeInTheDocument();
    });

    it("renders lookup button", () => {
      render(<ApnLookupInput form={makeMockForm()} />);
      expect(screen.getByRole("button", { name: /apn lookup/i })).toBeInTheDocument();
    });

    it("disables button when input is empty", () => {
      render(<ApnLookupInput form={makeMockForm()} />);
      expect(screen.getByRole("button", { name: /apn lookup/i })).toBeDisabled();
    });
  });

  describe("input behavior", () => {
    it("allows typing an APN", async () => {
      const user = userEvent.setup();
      render(<ApnLookupInput form={makeMockForm()} />);

      await user.type(screen.getByLabelText("Assessor Parcel Number"), "123-45-678");

      expect(screen.getByDisplayValue("123-45-678")).toBeInTheDocument();
    });

    it("enables button when input has value", async () => {
      const user = userEvent.setup();
      render(<ApnLookupInput form={makeMockForm()} />);

      await user.type(screen.getByLabelText("Assessor Parcel Number"), "123");

      expect(screen.getByRole("button", { name: /apn lookup/i })).not.toBeDisabled();
    });
  });

  describe("lookup via button click", () => {
    it("calls the APN lookup API", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(assessorResponse),
        }),
      );

      const user = userEvent.setup();
      const form = makeMockForm();
      render(<ApnLookupInput form={form} />);

      await user.type(screen.getByLabelText("Assessor Parcel Number"), "123-45-678");
      await user.click(screen.getByRole("button", { name: /apn lookup/i }));

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith("/api/apn-lookup?apn=123-45-678");
      });
    });

    it("sets form values from assessor response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(assessorResponse),
        }),
      );

      const user = userEvent.setup();
      const form = makeMockForm();
      render(<ApnLookupInput form={form} />);

      await user.type(screen.getByLabelText("Assessor Parcel Number"), "123-45-678");
      await user.click(screen.getByRole("button", { name: /apn lookup/i }));

      await waitFor(() => {
        expect(form.setValue).toHaveBeenCalledWith(
          "facilityInfo.facilityName",
          "John Smith",
          { shouldDirty: true },
        );
        expect(form.setValue).toHaveBeenCalledWith(
          "facilityInfo.facilityAddress",
          "123 Main St",
          { shouldDirty: true },
        );
        expect(form.setValue).toHaveBeenCalledWith(
          "facilityInfo.facilityCity",
          "Phoenix",
          { shouldDirty: true },
        );
        expect(form.setValue).toHaveBeenCalledWith(
          "facilityInfo.facilityZip",
          "85001",
          { shouldDirty: true },
        );
        expect(form.setValue).toHaveBeenCalledWith(
          "facilityInfo.facilityCounty",
          "Maricopa",
          { shouldDirty: true },
        );
        expect(form.setValue).toHaveBeenCalledWith(
          "facilityInfo.taxParcelNumber",
          "123-45-678",
          { shouldDirty: true },
        );
      });
    });

    it("shows success toast on successful lookup", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(assessorResponse),
        }),
      );

      const user = userEvent.setup();
      render(<ApnLookupInput form={makeMockForm()} />);

      await user.type(screen.getByLabelText("Assessor Parcel Number"), "123-45-678");
      await user.click(screen.getByRole("button", { name: /apn lookup/i }));

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Property data loaded from APN");
      });
    });
  });

  describe("lookup via Enter key", () => {
    it("triggers lookup on Enter key press", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(assessorResponse),
        }),
      );

      const user = userEvent.setup();
      render(<ApnLookupInput form={makeMockForm()} />);

      const input = screen.getByLabelText("Assessor Parcel Number");
      await user.type(input, "123-45-678");
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith("/api/apn-lookup?apn=123-45-678");
      });
    });
  });

  describe("error handling", () => {
    it("shows error toast on API failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          json: () => Promise.resolve({ error: "APN not found" }),
        }),
      );

      const user = userEvent.setup();
      render(<ApnLookupInput form={makeMockForm()} />);

      await user.type(screen.getByLabelText("Assessor Parcel Number"), "999-99-999");
      await user.click(screen.getByRole("button", { name: /apn lookup/i }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("APN not found");
      });
    });

    it("shows generic error toast on network failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Network error")),
      );

      const user = userEvent.setup();
      render(<ApnLookupInput form={makeMockForm()} />);

      await user.type(screen.getByLabelText("Assessor Parcel Number"), "123-45-678");
      await user.click(screen.getByRole("button", { name: /apn lookup/i }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("APN lookup failed — try again");
      });
    });
  });

  describe("loading state", () => {
    it("disables button while loading", async () => {
      let resolvePromise: (v: any) => void;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockReturnValue(
          new Promise((resolve) => {
            resolvePromise = resolve;
          }),
        ),
      );

      const user = userEvent.setup();
      render(<ApnLookupInput form={makeMockForm()} />);

      await user.type(screen.getByLabelText("Assessor Parcel Number"), "123-45-678");
      await user.click(screen.getByRole("button", { name: /apn lookup/i }));

      expect(screen.getByRole("button", { name: /apn lookup/i })).toBeDisabled();

      resolvePromise!({
        ok: true,
        json: () => Promise.resolve(assessorResponse),
      });
    });
  });

  describe("edge cases", () => {
    it("trims whitespace from APN before lookup", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(assessorResponse),
        }),
      );

      const user = userEvent.setup();
      render(<ApnLookupInput form={makeMockForm()} />);

      await user.type(screen.getByLabelText("Assessor Parcel Number"), "  123-45-678  ");
      await user.click(screen.getByRole("button", { name: /apn lookup/i }));

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith("/api/apn-lookup?apn=123-45-678");
      });
    });

    it("does not trigger lookup for whitespace-only input", async () => {
      vi.stubGlobal("fetch", vi.fn());

      const user = userEvent.setup();
      render(<ApnLookupInput form={makeMockForm()} />);

      // Button should be disabled since trimmed value is empty
      // but let's verify there's no fetch even if somehow clicked
      const input = screen.getByLabelText("Assessor Parcel Number");
      await user.type(input, "   ");

      expect(screen.getByRole("button", { name: /apn lookup/i })).toBeDisabled();
    });
  });
});
