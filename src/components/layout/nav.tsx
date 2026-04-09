"use client";

import type { LucideIcon } from "lucide-react";
import {
  Briefcase,
  CheckSquare,
  ClipboardList,
  FilePlus,
  LayoutDashboard,
  ListChecks,
  Map as MapIcon,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserRole } from "@/hooks/use-user-role";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/types/roles";

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  FilePlus,
  ClipboardList,
  CheckSquare,
  Users,
  Settings,
  Briefcase,
  ListChecks,
  Map: MapIcon,
};

export function Nav() {
  const { role, loading } = useUserRole();
  const pathname = usePathname();

  if (loading) {
    return (
      <nav className="hidden lg:flex w-60 flex-col gap-2 bg-sidebar p-5 pt-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={`skeleton-${i}`}
            className="h-10 rounded-lg bg-sidebar-accent/50 animate-pulse"
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
    <nav className="hidden lg:flex w-60 flex-col gap-1 bg-sidebar p-4 pt-6">
      <div className="mb-2 px-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
          Navigation
        </p>
      </div>
      {visibleItems.map((item) => {
        const Icon = item.icon ? ICON_MAP[item.icon] : null;
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href ||
              (pathname.startsWith(`${item.href}/`) &&
                !visibleItems.some(
                  (other) =>
                    other !== item &&
                    other.href !== "/" &&
                    other.href.length > item.href.length &&
                    pathname.startsWith(other.href),
                ));

        return (
          <Link
            key={`${item.label}-${item.href}`}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
              isActive
                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            {Icon && <Icon className="size-[18px] shrink-0" />}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
