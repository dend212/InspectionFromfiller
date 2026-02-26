"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";
import { toast } from "sonner";

/**
 * Debounced auto-save hook for the inspection wizard.
 * Uses useWatch to observe form changes in an isolated context,
 * preventing full-form re-renders on every keystroke.
 */
export function useAutoSave(
  form: UseFormReturn<any>,
  inspectionId: string,
  debounceMs = 1000
) {
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const lastSavedRef = useRef<string>("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Observe all form values via useWatch (isolated from parent re-renders)
  const watchedValues = useWatch({ control: form.control });

  const saveData = useCallback(
    async (data: unknown) => {
      const json = JSON.stringify(data);
      if (json === lastSavedRef.current) return;

      setSaving(true);
      try {
        const response = await fetch(`/api/inspections/${inspectionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: json,
        });

        if (!response.ok) {
          throw new Error(`Save failed: ${response.status}`);
        }

        lastSavedRef.current = json;
        if (isMountedRef.current) {
          setLastSaved(new Date());
        }
      } catch (error) {
        if (isMountedRef.current) {
          toast.error("Auto-save failed");
        }
      } finally {
        if (isMountedRef.current) {
          setSaving(false);
        }
      }
    },
    [inspectionId]
  );

  // Debounce saves on form value changes
  useEffect(() => {
    const json = JSON.stringify(watchedValues);
    if (json === lastSavedRef.current) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      saveData(watchedValues);
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [watchedValues, debounceMs, saveData]);

  // Flush pending save on unmount
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        // Fire-and-forget save of current values
        const currentValues = form.getValues();
        const json = JSON.stringify(currentValues);
        if (json !== lastSavedRef.current) {
          fetch(`/api/inspections/${inspectionId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: json,
          }).catch(() => {
            // Unmount save failed silently
          });
        }
      }
    };
  }, [form, inspectionId]);

  // Warn on browser close if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const currentJson = JSON.stringify(form.getValues());
      if (currentJson !== lastSavedRef.current) {
        e.preventDefault();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [form]);

  return { saving, lastSaved };
}
