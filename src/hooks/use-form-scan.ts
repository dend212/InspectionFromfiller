"use client";

import { useCallback, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import type { ScanResult } from "@/lib/ai/scan-types";
import { AUTO_SELECT_CONFIDENCE } from "@/lib/ai/scan-types";
import type { InspectionFormData } from "@/types/inspection";

export type ScanState = "idle" | "uploading" | "scanning" | "reviewing" | "done";

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
  applyFields: (form: UseFormReturn<InspectionFormData>) => void;
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
    (form: UseFormReturn<InspectionFormData>) => {
      if (!scanResult) return;

      let appliedCount = 0;

      for (const field of scanResult.fields) {
        if (!selectedFields.has(field.fieldPath)) continue;

        // Handle tank array fields: septicTank.tanks[0].fieldName
        const tankMatch = field.fieldPath.match(/^septicTank\.tanks\[(\d+)\]\.(\w+)$/);
        if (tankMatch) {
          const tankIndex = Number.parseInt(tankMatch[1], 10);
          const tankField = tankMatch[2];
          const currentTanks = form.getValues("septicTank.tanks") ?? [];

          // Ensure the tanks array is long enough
          while (currentTanks.length <= tankIndex) {
            currentTanks.push({} as (typeof currentTanks)[0]);
          }

          // Set the field value on the tank object
          // biome-ignore lint/suspicious/noExplicitAny: Dynamic form path
          (currentTanks[tankIndex] as any)[tankField] = field.value;
          form.setValue("septicTank.tanks", currentTanks, {
            shouldDirty: true,
          });
          appliedCount++;
          continue;
        }

        // Standard dotted path (e.g., "facilityInfo.facilityName")
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic form path
        form.setValue(field.fieldPath as any, field.value as any, {
          shouldDirty: true,
          shouldValidate: true,
        });
        appliedCount++;
      }

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
