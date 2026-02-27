"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";

interface ReviewNoteBannerProps {
  note: string | null;
}

export function ReviewNoteBanner({ note }: ReviewNoteBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!note || dismissed) {
    return null;
  }

  return (
    <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 flex items-start gap-3">
      <AlertTriangle className="size-5 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">Review Note</p>
        <p className="text-sm mt-1">{note}</p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 p-1 rounded-md hover:bg-amber-100 transition-colors"
        aria-label="Dismiss"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
