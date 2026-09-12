"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface ReviewSectionProps {
  title: string;
  /** Applied to the header button so callers can scroll/focus the section (jump-to fallback) */
  id?: string;
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
  id,
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
        {/* The trigger is a real <button> so the header is focusable and Enter/Space toggle it;
            the header's own padding moves onto the button so the whole strip stays clickable */}
        <CardHeader className="p-0">
          <CollapsibleTrigger asChild>
            <button
              id={id}
              type="button"
              className="flex w-full cursor-pointer select-none items-center justify-between gap-3 px-6 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="text-base leading-none font-semibold">{title}</span>
              <span className="flex items-center gap-3">
                {pill}
                {isOpen ? (
                  <ChevronDown className="size-5 text-muted-foreground transition-transform" />
                ) : (
                  <ChevronRight className="size-5 text-muted-foreground transition-transform" />
                )}
              </span>
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="pt-0">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
