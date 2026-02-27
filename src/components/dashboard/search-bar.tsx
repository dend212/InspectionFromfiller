"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SearchBarProps {
  defaultValue?: string;
}

export function SearchBar({ defaultValue = "" }: SearchBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [value, setValue] = useState(defaultValue);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  function updateSearch(term: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (term.trim()) {
      params.set("q", term.trim());
    } else {
      params.delete("q");
    }
    // Reset to page 1 on new search
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newValue = e.target.value;
    setValue(newValue);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      updateSearch(newValue);
    }, 300);
  }

  function handleClear() {
    setValue("");
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    updateSearch("");
  }

  return (
    <div className="relative w-full sm:max-w-sm">
      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        placeholder="Search by address, name, or date..."
        value={value}
        onChange={handleChange}
        className="pl-8 pr-8"
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={handleClear}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
          <span className="sr-only">Clear search</span>
        </Button>
      )}
    </div>
  );
}
