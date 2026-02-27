"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserRole } from "@/hooks/use-user-role";
import { NAV_ITEMS } from "@/types/roles";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
      <SheetContent side="left" className="w-64 p-0">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="flex items-center">
            <img
              src="/sewertime-logo.png"
              alt="SewerTime"
              className="h-7 w-auto"
            />
          </SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1 p-3">
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
                onClick={() => onOpenChange(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {Icon && <Icon className="size-4 shrink-0" />}
                {item.label}
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
