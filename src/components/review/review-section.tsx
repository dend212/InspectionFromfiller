"use client";

import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronRight } from "lucide-react";

interface ReviewSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function ReviewSection({
  title,
  defaultOpen = false,
  children,
}: ReviewSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none transition-colors hover:bg-accent/50">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{title}</CardTitle>
              {isOpen ? (
                <ChevronDown className="size-5 text-muted-foreground transition-transform" />
              ) : (
                <ChevronRight className="size-5 text-muted-foreground transition-transform" />
              )}
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
