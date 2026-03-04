import { describe, it, expect } from "vitest";
import { NAV_ITEMS, ROLE_LABELS } from "../roles";
import type { AppRole, NavItem } from "../roles";

// ============================================================================
// AppRole type (compile-time check expressed as runtime assertions)
// ============================================================================

describe("AppRole type", () => {
  it("allows admin, field_tech, office_staff", () => {
    const roles: AppRole[] = ["admin", "field_tech", "office_staff"];
    expect(roles).toHaveLength(3);
  });
});

// ============================================================================
// NAV_ITEMS
// ============================================================================

describe("NAV_ITEMS", () => {
  it("is a non-empty array", () => {
    expect(NAV_ITEMS.length).toBeGreaterThan(0);
  });

  it("has correct NavItem shape for each item", () => {
    for (const item of NAV_ITEMS) {
      expect(typeof item.label).toBe("string");
      expect(item.label.length).toBeGreaterThan(0);
      expect(typeof item.href).toBe("string");
      expect(item.href.startsWith("/")).toBe(true);
      expect(Array.isArray(item.roles)).toBe(true);
      expect(item.roles.length).toBeGreaterThan(0);
    }
  });

  it("each item has only valid roles", () => {
    const validRoles: AppRole[] = ["admin", "field_tech", "office_staff"];
    for (const item of NAV_ITEMS) {
      for (const role of item.roles) {
        expect(validRoles).toContain(role);
      }
    }
  });

  it("includes Dashboard accessible to all roles", () => {
    const dashboard = NAV_ITEMS.find((item) => item.label === "Dashboard");
    expect(dashboard).toBeDefined();
    expect(dashboard?.href).toBe("/");
    expect(dashboard?.roles).toContain("admin");
    expect(dashboard?.roles).toContain("field_tech");
    expect(dashboard?.roles).toContain("office_staff");
  });

  it("includes New Inspection for admin and field_tech only", () => {
    const newInspection = NAV_ITEMS.find(
      (item) => item.label === "New Inspection",
    );
    expect(newInspection).toBeDefined();
    expect(newInspection?.href).toBe("/inspections/new");
    expect(newInspection?.roles).toContain("admin");
    expect(newInspection?.roles).toContain("field_tech");
    expect(newInspection?.roles).not.toContain("office_staff");
  });

  it("includes My Inspections for field_tech only", () => {
    const myInspections = NAV_ITEMS.find(
      (item) => item.label === "My Inspections",
    );
    expect(myInspections).toBeDefined();
    expect(myInspections?.roles).toEqual(["field_tech"]);
  });

  it("includes All Inspections for admin and office_staff", () => {
    const allInspections = NAV_ITEMS.find(
      (item) => item.label === "All Inspections",
    );
    expect(allInspections).toBeDefined();
    expect(allInspections?.roles).toContain("admin");
    expect(allInspections?.roles).toContain("office_staff");
    expect(allInspections?.roles).not.toContain("field_tech");
  });

  it("includes Review Queue for admin and office_staff", () => {
    const reviewQueue = NAV_ITEMS.find(
      (item) => item.label === "Review Queue",
    );
    expect(reviewQueue).toBeDefined();
    expect(reviewQueue?.roles).toContain("admin");
    expect(reviewQueue?.roles).toContain("office_staff");
    expect(reviewQueue?.roles).not.toContain("field_tech");
  });

  it("includes Manage Users for admin only", () => {
    const manageUsers = NAV_ITEMS.find(
      (item) => item.label === "Manage Users",
    );
    expect(manageUsers).toBeDefined();
    expect(manageUsers?.roles).toEqual(["admin"]);
  });

  it("includes Settings for all roles", () => {
    const settings = NAV_ITEMS.find((item) => item.label === "Settings");
    expect(settings).toBeDefined();
    expect(settings?.roles).toContain("admin");
    expect(settings?.roles).toContain("field_tech");
    expect(settings?.roles).toContain("office_staff");
  });

  it("icon is optional but present on all items", () => {
    for (const item of NAV_ITEMS) {
      // All current items have icons defined
      expect(typeof item.icon).toBe("string");
    }
  });
});

// ============================================================================
// ROLE_LABELS
// ============================================================================

describe("ROLE_LABELS", () => {
  it("has labels for all three roles", () => {
    expect(Object.keys(ROLE_LABELS)).toHaveLength(3);
    expect(ROLE_LABELS.admin).toBeDefined();
    expect(ROLE_LABELS.field_tech).toBeDefined();
    expect(ROLE_LABELS.office_staff).toBeDefined();
  });

  it("has correct human-readable labels", () => {
    expect(ROLE_LABELS.admin).toBe("Admin");
    expect(ROLE_LABELS.field_tech).toBe("Field Tech");
    expect(ROLE_LABELS.office_staff).toBe("Office Staff");
  });

  it("all labels are non-empty strings", () => {
    for (const label of Object.values(ROLE_LABELS)) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
