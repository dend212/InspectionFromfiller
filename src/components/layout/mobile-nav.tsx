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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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

interface MobileNavProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MobileNav({ open, onOpenChange }: MobileNavProps) {
  const { role, loading } = useUserRole();
  const pathname = usePathname();

  if (loading || !role) {
    return null;
  }

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(role));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <SheetTitle className="flex items-center">
            <img src="/sewertime-logo.png" alt="SewerTime" className="h-8 w-auto" />
          </SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1 p-4">
          <div className="mb-2 px-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
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
                onClick={() => onOpenChange(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {Icon && <Icon className="size-[18px] shrink-0" />}
                {item.label}
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
