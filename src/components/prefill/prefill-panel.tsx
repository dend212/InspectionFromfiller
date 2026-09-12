"use client";

import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { ApnLookupInput } from "@/components/inspection/apn-lookup-input";
import { ScanFormButton } from "@/components/inspection/scan-form-button";
import { buildPrefillInput, isValidApn } from "@/lib/prefill/input";
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

/** Shown inline (no request) when neither the toolbar box nor the form can yield an APN/address */
export const PREFILL_NO_INPUT_MESSAGE =
  "Enter an APN in the box above or a street address in the form first";

/**
 * Draft-only toolbar (APN lookup + scan) and the Prefill sources tile.
 * Owns the prefill run via usePrefill, so it must render inside ProvenanceProvider.
 */
export function PrefillPanel({ inspectionId, form, initialRun }: PrefillPanelProps) {
  const prefill = usePrefill({ inspectionId, form, enabled: true, initialRun });
  const [toolbarApn, setToolbarApn] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const findRecords = (): void => {
    // The form's Tax Parcel Number wins; the toolbar box is the fallback. Whichever
    // resolves is sent explicitly: the route derives APN/address from the *persisted*
    // formData, which trails the live form by the autosave debounce, so an APN typed
    // moments before Find records would otherwise be missing server-side and 400.
    // The same buildPrefillInput the server runs decides whether anything at all can
    // be derived — an empty result would only come back as a 400, so say so inline.
    const boxApn = toolbarApn.trim();
    const formApn = (form.getValues("facilityInfo.taxParcelNumber") ?? "").trim();
    const apn = formApn || (isValidApn(boxApn) ? boxApn : "");
    const body = { trigger: "manual" as const, ...(apn ? { apn } : {}) };
    const input = buildPrefillInput(form.getValues(), body);
    if (!input.apn && !input.address) {
      setInputError(PREFILL_NO_INPUT_MESSAGE);
      return;
    }
    setInputError(null);
    void prefill.start(body);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <ApnLookupInput
          form={form}
          value={toolbarApn}
          onValueChange={setToolbarApn}
          onLookupSuccess={({ apn }) => {
            setInputError(null);
            void prefill.start({ apn, trigger: "apn_lookup" });
          }}
        />
        <ScanFormButton inspectionId={inspectionId} form={form} />
      </div>
      <PrefillSourcesTile
        run={prefill.run}
        isRunning={prefill.isRunning}
        canRun
        error={inputError ?? prefill.error}
        onFindRecords={findRecords}
        onSelectCandidates={(keys) => prefill.selectCandidates(keys)}
      />
    </div>
  );
}
