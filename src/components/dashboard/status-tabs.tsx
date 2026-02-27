"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusTabsProps {
  activeStatus: string;
  counts?: {
    all: number;
    draft: number;
    in_review: number;
    completed: number;
  };
}

const TABS = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "In Review", value: "in_review" },
  { label: "Complete", value: "completed" },
] as const;

export function StatusTabs({ activeStatus, counts }: StatusTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  function handleTabClick(status: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (status === "all") {
      params.delete("status");
    } else {
      params.set("status", status);
    }
    // Reset to page 1 on filter change
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-1">
      {TABS.map((tab) => {
        const isActive = activeStatus === tab.value;
        const count = counts?.[tab.value as keyof typeof counts];

        return (
          <Button
            key={tab.value}
            type="button"
            variant={isActive ? "default" : "ghost"}
            size="sm"
            onClick={() => handleTabClick(tab.value)}
            className={cn(
              "gap-1.5",
              !isActive && "text-muted-foreground"
            )}
          >
            {tab.label}
            {count !== undefined && (
              <Badge
                variant={isActive ? "secondary" : "outline"}
                className="ml-0.5 px-1.5 py-0 text-[10px]"
              >
                {count}
              </Badge>
            )}
          </Button>
        );
      })}
    </div>
  );
}
