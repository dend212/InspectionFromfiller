"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface ReviewSectionProps {
  title: string;
  /** Uncontrolled initial state (ignored when `open` is provided) */
  defaultOpen?: boolean;
  /** Controlled open state — the review shell drives this for jump-to-field */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Status pill rendered at the right of the header (see review-pill.tsx) */
  pill?: React.ReactNode;
  children: React.ReactNode;
}

export function ReviewSection({
  title,
  defaultOpen = false,
  open,
  onOpenChange,
  pill,
  children,
}: ReviewSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  const handleOpenChange = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none transition-colors hover:bg-accent/50">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">{title}</CardTitle>
              <div className="flex items-center gap-3">
                {pill}
                {isOpen ? (
                  <ChevronDown className="size-5 text-muted-foreground transition-transform" />
                ) : (
                  <ChevronRight className="size-5 text-muted-foreground transition-transform" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
