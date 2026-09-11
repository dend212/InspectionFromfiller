"use client";

import type { UseFormReturn } from "react-hook-form";
import { ApnLookupInput } from "@/components/inspection/apn-lookup-input";
import { ScanFormButton } from "@/components/inspection/scan-form-button";
import type { PrefillRunDTO } from "@/lib/prefill/types";
import type { InspectionFormData } from "@/types/inspection";
import { PrefillSourcesTile } from "./prefill-sources-tile";
import { usePrefill } from "./use-prefill";

interface PrefillPanelProps {
  inspectionId: string;
  form: UseFormReturn<InspectionFormData>;
  /** Server-loaded latest run (null when none) */
  initialRun?: PrefillRunDTO | null;
}

/**
 * Draft-only toolbar (APN lookup + scan) and the Prefill sources tile.
 * Owns the prefill run via usePrefill, so it must render inside ProvenanceProvider.
 */
export function PrefillPanel({ inspectionId, form, initialRun }: PrefillPanelProps) {
  const prefill = usePrefill({ inspectionId, form, enabled: true, initialRun });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <ApnLookupInput
          form={form}
          onLookupSuccess={({ apn }) => {
            void prefill.start({ apn, trigger: "apn_lookup" });
          }}
        />
        <ScanFormButton inspectionId={inspectionId} form={form} />
      </div>
      <PrefillSourcesTile
        run={prefill.run}
        isRunning={prefill.isRunning}
        canRun
        error={prefill.error}
        onFindRecords={() => {
          void prefill.start({ trigger: "manual" });
        }}
        onSelectCandidates={(keys) => prefill.selectCandidates(keys)}
      />
    </div>
  );
}
