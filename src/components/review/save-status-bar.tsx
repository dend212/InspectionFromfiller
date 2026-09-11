"use client";

import { AlertTriangle, Check, Loader2, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AutoSaveStatus } from "@/hooks/use-auto-save";

interface SaveStatusBarProps {
  status: AutoSaveStatus;
  lastSaved: Date | null;
  /** Re-run the save (wired to useAutoSave.flush) */
  onRetry: () => void;
  readOnly: boolean;
}

function relativeTime(from: Date, now: number): string {
  const s = Math.max(0, Math.round((now - from.getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return from.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Sticky bottom bar: `Saved · 2 s ago` · `Saving…` · `Save failed — Retry` · read-only notice */
export function SaveStatusBar({ status, lastSaved, onRetry, readOnly }: SaveStatusBarProps) {
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second so "N s ago" stays honest
  useEffect(() => {
    if (readOnly || !lastSaved) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [readOnly, lastSaved]);

  let content: React.ReactNode;
  if (readOnly) {
    content = (
      <span className="flex items-center gap-2 text-muted-foreground">
        <Lock className="size-4" />
        Read-only — reopen the inspection to edit
      </span>
    );
  } else if (status === "saving") {
    content = (
      <span className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Saving…
      </span>
    );
  } else if (status === "error") {
    content = (
      <span className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="size-4" />
        Save failed
        <Button type="button" variant="outline" size="sm" className="h-7" onClick={onRetry}>
          Retry
        </Button>
      </span>
    );
  } else if (lastSaved) {
    content = (
      <span className="flex items-center gap-2 text-muted-foreground">
        <Check className="size-4 text-emerald-600" />
        Saved · {relativeTime(lastSaved, now)}
      </span>
    );
  } else {
    content = <span className="text-muted-foreground">Changes save automatically</span>;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky bottom-0 z-20 -mx-4 mt-6 border-t bg-background/95 px-4 py-2 text-sm backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:mx-0 sm:rounded-t-lg"
    >
      {content}
    </div>
  );
}
