import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
  }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/components/layout/header", () => ({ Header: () => <header>header</header> }));
vi.mock("@/components/layout/nav", () => ({ Nav: () => <nav>nav</nav> }));

import DashboardLayout from "../layout";

beforeAll(() => {
  // sonner reads prefers-color-scheme; jsdom has no matchMedia
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe("DashboardLayout", () => {
  it("mounts the sonner toaster so toast() calls are visible on every dashboard page", async () => {
    const { container } = render(await DashboardLayout({ children: <p>page</p> }));
    // sonner 2.x always renders <section aria-label="Notifications alt+T" aria-live="polite">
    expect(container.querySelector('section[aria-label^="Notifications"]')).not.toBeNull();
  });
});
