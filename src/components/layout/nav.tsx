"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserRole } from "@/hooks/use-user-role";
import { NAV_ITEMS } from "@/types/roles";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  FilePlus,
  ClipboardList,
  CheckSquare,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  FilePlus,
  ClipboardList,
  CheckSquare,
  Users,
};

export function Nav() {
  const { role, loading } = useUserRole();
  const pathname = usePathname();

  if (loading) {
    return (
      <nav className="hidden lg:flex w-60 flex-col gap-1 bg-sidebar p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={`skeleton-${i}`}
            className="h-9 rounded-md bg-sidebar-accent animate-pulse"
          />
        ))}
      </nav>
    );
  }

  if (!role) {
    return null;
  }

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(role));

  return (
    <nav className="hidden lg:flex w-60 flex-col gap-1 bg-sidebar p-4">
      <div className="mb-4 px-3">
        <img
          src="/sewertime-logo.png"
          alt="SewerTime"
          className="h-8 w-auto brightness-0 invert"
        />
      </div>
      {visibleItems.map((item) => {
        const Icon = item.icon ? ICON_MAP[item.icon] : null;
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={`${item.label}-${item.href}`}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            {Icon && <Icon className="size-4 shrink-0" />}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
