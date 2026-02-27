"use client";

import { cn } from "@/lib/utils";

interface ButtonGroupOption {
  value: string;
  label: string;
}

interface ButtonGroupProps {
  options: readonly ButtonGroupOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ButtonGroup({ options, value, onChange, className }: ButtonGroupProps) {
  const count = options.length;

  // 2 options: full-width 2-column grid
  // 3-4 options: 2-column grid on mobile, flex-wrap on desktop
  const layoutClass =
    count === 2
      ? "grid grid-cols-2 gap-2"
      : "grid grid-cols-2 gap-2 sm:flex sm:flex-wrap";

  return (
    <div className={cn(layoutClass, className)} role="group">
      {options.map((option) => {
        const isSelected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="button"
            aria-pressed={isSelected}
            className={cn(
              "min-h-[48px] rounded-lg px-4 py-2.5 text-base font-medium transition-all",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isSelected
                ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                : "border border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground hover:border-primary/30"
            )}
            onClick={() => onChange(isSelected ? "" : option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
