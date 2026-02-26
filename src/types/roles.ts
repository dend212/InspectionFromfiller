export type AppRole = "admin" | "field_tech" | "office_staff";

export interface NavItem {
  label: string;
  href: string;
  icon?: string;
  roles: AppRole[];
}

export const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: "/",
    icon: "LayoutDashboard",
    roles: ["admin", "field_tech", "office_staff"],
  },
  {
    label: "New Inspection",
    href: "/inspections/new",
    icon: "FilePlus",
    roles: ["admin", "field_tech"],
  },
  {
    label: "My Inspections",
    href: "/inspections",
    icon: "ClipboardList",
    roles: ["field_tech"],
  },
  {
    label: "All Inspections",
    href: "/inspections",
    icon: "ClipboardList",
    roles: ["admin", "office_staff"],
  },
  {
    label: "Review Queue",
    href: "/review",
    icon: "CheckSquare",
    roles: ["admin", "office_staff"],
  },
  {
    label: "Manage Users",
    href: "/admin/users",
    icon: "Users",
    roles: ["admin"],
  },
];

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  field_tech: "Field Tech",
  office_staff: "Office Staff",
};
