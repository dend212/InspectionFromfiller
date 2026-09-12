"use client";

import { Badge } from "@/components/ui/badge";
import type { InspectionRecordDTO } from "@/lib/prefill/types";

type Status = InspectionRecordDTO["extractionStatus"];

const LABELS: Record<Status, { text: string; variant: "outline" | "success" | "warning" | "destructive" }> = {
  pending: { text: "Queued", variant: "outline" },
  done: { text: "Read", variant: "success" },
  skipped: { text: "Not read", variant: "outline" },
  failed: { text: "Read failed", variant: "destructive" },
};

/** True when the permits stage summary ("Reading OW-17-00474…") names this pending record */
export function isRecordBeingRead(
  record: Pick<InspectionRecordDTO, "permitNumber" | "extractionStatus">,
  summary: string | undefined,
): boolean {
  return (
    record.extractionStatus === "pending" &&
    !!summary &&
    summary.startsWith("Reading ") &&
    summary.includes(record.permitNumber)
  );
}

export function RecordExtractionBadge({
  record,
  reading = false,
}: {
  record: Pick<InspectionRecordDTO, "extractionStatus" | "extractionError">;
  reading?: boolean;
}) {
  if (reading && record.extractionStatus === "pending") {
    return (
      <Badge variant="warning" aria-label="Reading document">
        Reading…
      </Badge>
    );
  }
  const { text, variant } = LABELS[record.extractionStatus];
  const reason = record.extractionError ?? undefined;
  return (
    <Badge variant={variant} title={reason} aria-label={reason ? `${text}: ${reason}` : text}>
      {text}
    </Badge>
  );
}
