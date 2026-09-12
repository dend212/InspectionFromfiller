"use client";

import { useCallback, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import type { ScanResult } from "@/lib/ai/scan-types";
import { AUTO_SELECT_CONFIDENCE } from "@/lib/ai/scan-types";
import type { ExtractedField } from "@/lib/ai/scan-types";
import { normalizeFieldPath } from "@/lib/prefill/merge";
import { fieldProvenanceSchema } from "@/lib/prefill/provenance-schema";
import { ensureTankArrayCapacity } from "@/lib/prefill/tank-capacity";
import type { FieldProvenance, ProvenanceEntry, ProvenanceValue } from "@/lib/prefill/types";
import type { InspectionFormData } from "@/types/inspection";

export type ScanState = "idle" | "uploading" | "scanning" | "reviewing" | "done";

/** Scan values are blind-cast from the model; coerce to what provenanceValueSchema accepts */
function toProvenanceValue(value: unknown): ProvenanceValue {
  if (typeof value === "string") return value.slice(0, 5000);
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => String(v ?? "").slice(0, 500));
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value).slice(0, 5000);
  return String(value);
}

/**
 * Builds the source=scan provenance entry for an applied field, or null when it can't be
 * made valid. The provenance PATCH is a whole-map replace, so one non-conforming entry
 * (confidence 1.4, a numeric value, an unbounded explanation, an odd key) would reject
 * every other entry — everything is clamped here and the result is checked against the
 * same schema the route uses.
 */
function toScanProvenanceEntry(
  field: ExtractedField,
  at: string,
): { key: string; entry: ProvenanceEntry } | null {
  const key = normalizeFieldPath(field.fieldPath);
  const confidence = Number.isFinite(field.confidence)
    ? Math.min(1, Math.max(0, field.confidence))
    : 0;
  const entry: ProvenanceEntry = {
    source: "scan",
    state: "prefilled",
    kind: "fill",
    value: toProvenanceValue(field.value),
    confidence,
    explanation: `Scanned form · ${String(field.source ?? "")}`.slice(0, 500),
    at,
  };
  return fieldProvenanceSchema.safeParse({ [key]: entry }).success ? { key, entry } : null;
}

interface UploadedImage {
  storagePath: string;
  previewUrl: string;
  fileName: string;
}

export interface UseFormScanReturn {
  state: ScanState;
  setState: (state: ScanState) => void;
  uploadedImages: UploadedImage[];
  scanResult: ScanResult | null;
  selectedFields: Set<string>;
  error: string | null;
  addUploadedImage: (image: UploadedImage) => void;
  removeUploadedImage: (storagePath: string) => void;
  startScan: (inspectionId: string) => Promise<void>;
  toggleField: (fieldPath: string) => void;
  selectAllHighConfidence: () => void;
  clearAllSelections: () => void;
  applyFields: (
    form: UseFormReturn<InspectionFormData>,
    onProvenance?: (entries: FieldProvenance) => void,
  ) => void;
  reset: () => void;
}

export function useFormScan(): UseFormScanReturn {
  const [state, setState] = useState<ScanState>("idle");
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const addUploadedImage = useCallback((image: UploadedImage) => {
    setUploadedImages((prev) => [...prev, image]);
  }, []);

  const removeUploadedImage = useCallback((storagePath: string) => {
    setUploadedImages((prev) => prev.filter((img) => img.storagePath !== storagePath));
  }, []);

  const startScan = useCallback(
    async (inspectionId: string) => {
      if (uploadedImages.length === 0) {
        setError("Upload at least one image to scan");
        return;
      }

      setState("scanning");
      setError(null);

      try {
        const res = await fetch(`/api/inspections/${inspectionId}/scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storagePaths: uploadedImages.map((img) => img.storagePath),
          }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ error: "Scan failed" }));
          throw new Error(errBody.error || `Scan failed (${res.status})`);
        }

        const result: ScanResult = await res.json();
        setScanResult(result);

        // Auto-select fields with confidence >= threshold
        const autoSelected = new Set<string>();
        for (const field of result.fields) {
          if (field.confidence >= AUTO_SELECT_CONFIDENCE) {
            autoSelected.add(field.fieldPath);
          }
        }
        setSelectedFields(autoSelected);
        setState("reviewing");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Scan failed";
        setError(message);
        setState("uploading");
      }
    },
    [uploadedImages],
  );

  const toggleField = useCallback((fieldPath: string) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldPath)) {
        next.delete(fieldPath);
      } else {
        next.add(fieldPath);
      }
      return next;
    });
  }, []);

  const selectAllHighConfidence = useCallback(() => {
    if (!scanResult) return;
    const selected = new Set<string>();
    for (const field of scanResult.fields) {
      if (field.confidence >= AUTO_SELECT_CONFIDENCE) {
        selected.add(field.fieldPath);
      }
    }
    setSelectedFields(selected);
  }, [scanResult]);

  const clearAllSelections = useCallback(() => {
    setSelectedFields(new Set());
  }, []);

  const applyFields = useCallback(
    (form: UseFormReturn<InspectionFormData>, onProvenance?: (entries: FieldProvenance) => void) => {
      if (!scanResult) return;

      let appliedCount = 0;
      const entries: FieldProvenance = {};
      const at = new Date().toISOString();

      for (const field of scanResult.fields) {
        if (!selectedFields.has(field.fieldPath)) continue;

        // Handle tank array fields: septicTank.tanks[0].fieldName
        const tankMatch = field.fieldPath.match(/^septicTank\.tanks\[(\d+)\]\.(\w+)$/);
        if (tankMatch) {
          const tankIndex = Number.parseInt(tankMatch[1], 10);
          const tankField = tankMatch[2];

          // Grow the array (and numberOfTanks) the same way prefill and acceptSuggestion do
          ensureTankArrayCapacity(form, [field.fieldPath]);

          // Replace the whole array so the provenance watcher sees one nested change
          const currentTanks = [...(form.getValues("septicTank.tanks") ?? [])];
          currentTanks[tankIndex] = { ...currentTanks[tankIndex], [tankField]: field.value };
          form.setValue("septicTank.tanks", currentTanks, {
            shouldDirty: true,
          });
        } else {
          // Standard dotted path (e.g., "facilityInfo.facilityName")
          // biome-ignore lint/suspicious/noExplicitAny: Dynamic form path
          form.setValue(field.fieldPath as any, field.value as any, {
            shouldDirty: true,
            shouldValidate: true,
          });
        }

        appliedCount++;
        // Scanned values join the provenance system as source "scan" (green badge)
        const scanEntry = toScanProvenanceEntry(field, at);
        if (scanEntry) entries[scanEntry.key] = scanEntry.entry;
      }

      onProvenance?.(entries);
      toast.success(`${appliedCount} field${appliedCount === 1 ? "" : "s"} applied from scan`);
      setState("done");
    },
    [scanResult, selectedFields],
  );

  const reset = useCallback(() => {
    setState("idle");
    setUploadedImages([]);
    setScanResult(null);
    setSelectedFields(new Set());
    setError(null);
  }, []);

  return {
    state,
    setState,
    uploadedImages,
    scanResult,
    selectedFields,
    error,
    addUploadedImage,
    removeUploadedImage,
    startScan,
    toggleField,
    selectAllHighConfidence,
    clearAllSelections,
    applyFields,
    reset,
  };
}
