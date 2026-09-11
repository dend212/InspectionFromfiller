"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";
import { toast } from "sonner";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseAutoSaveOptions {
  /** Debounce window in ms (default 1000) */
  debounceMs?: number;
  /** When false the hook never saves (read-only review) and flush() resolves true immediately */
  enabled?: boolean;
}

export interface UseAutoSaveReturn {
  /** True while a PATCH is in flight (kept for WizardNavigation) */
  saving: boolean;
  lastSaved: Date | null;
  status: AutoSaveStatus;
  /**
   * Cancel the pending debounce and save now. Resolves true when the form is
   * persisted (or nothing changed), false when the PATCH failed. If a save is
   * already in flight, waits for it and then saves any newer changes.
   */
  flush: () => Promise<boolean>;
}

/**
 * Debounced auto-save hook for the inspection wizard and the review page.
 * Uses useWatch to observe form changes in an isolated context,
 * preventing full-form re-renders on every keystroke.
 *
 * The third argument accepts a bare debounce number for backwards compatibility.
 */
export function useAutoSave(
  form: UseFormReturn<any>,
  inspectionId: string,
  options: number | UseAutoSaveOptions = {},
): UseAutoSaveReturn {
  const { debounceMs = 1000, enabled = true } =
    typeof options === "number" ? { debounceMs: options } : options;

  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const lastSavedRef = useRef<string>("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const isMountedRef = useRef(true);

  // Observe form changes via useWatch to trigger debounced saves.
  // We use useWatch as a change trigger, but always send the complete
  // form via form.getValues() to avoid partial data from unmounted steps.
  const watchedValues = useWatch({ control: form.control });

  const performSave = useCallback(async (): Promise<boolean> => {
    const json = JSON.stringify(form.getValues());
    if (json === lastSavedRef.current) return true;

    if (isMountedRef.current) setStatus("saving");
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
        setStatus("saved");
      }
      return true;
    } catch {
      if (isMountedRef.current) {
        setStatus("error");
        toast.error("Auto-save failed");
      }
      return false;
    }
  }, [form, inspectionId]);

  const flush = useCallback((): Promise<boolean> => {
    if (!enabled) return Promise.resolve(true);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    // Serialise behind any in-flight save so two flushes never race; the
    // chained performSave is a no-op when nothing changed in the meantime.
    const run: Promise<boolean> = inFlightRef.current
      ? inFlightRef.current.then(() => performSave())
      : performSave();
    inFlightRef.current = run;
    run.finally(() => {
      if (inFlightRef.current === run) inFlightRef.current = null;
    });
    return run;
  }, [enabled, performSave]);

  // Debounce saves on form value changes
  useEffect(() => {
    if (!enabled) return;
    const json = JSON.stringify(watchedValues);
    if (json === lastSavedRef.current) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      flush();
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [watchedValues, debounceMs, enabled, flush]);

  // Flush pending save on unmount
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (!enabled) return;
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
  }, [form, inspectionId, enabled]);

  // Warn on browser close if there are unsaved changes
  useEffect(() => {
    if (!enabled) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const currentJson = JSON.stringify(form.getValues());
      if (currentJson !== lastSavedRef.current) {
        e.preventDefault();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [form, enabled]);

  return { saving: status === "saving", lastSaved, status, flush };
}
