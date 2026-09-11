"use client";

import * as React from "react";
import type { FieldPath, UseFormReturn } from "react-hook-form";
import { getPath, normalizeFieldPath, valuesEqual } from "@/lib/prefill/merge";
import type { FieldProvenance, ProvenanceEntry } from "@/lib/prefill/types";
import type { InspectionFormData } from "@/types/inspection";

export interface ProvenanceContextValue {
  provenance: FieldProvenance;
  /** True on non-draft inspections and outside a provider: badges render, nothing is persisted or editable */
  readOnly: boolean;
  get(fieldPath: string): ProvenanceEntry | undefined;
  verify(fieldPath: string): void;
  clear(fieldPath: string): void;
  /** Writes the suggested value into the form and marks the entry prefilled (warnings are just removed) */
  acceptSuggestion(fieldPath: string): void;
  dismissSuggestion(fieldPath: string): void;
  /** Merge entries in — used by the prefill hook, the APN lookup and the scan flow */
  setMany(entries: FieldProvenance): void;
}

const noop = (): void => {};

/** Default context when no provider is mounted (tests, pages that have not adopted provenance yet) */
export const NOOP_PROVENANCE: ProvenanceContextValue = {
  provenance: {},
  readOnly: true,
  get: () => undefined,
  verify: noop,
  clear: noop,
  acceptSuggestion: noop,
  dismissSuggestion: noop,
  setMany: noop,
};

const ProvenanceContext = React.createContext<ProvenanceContextValue>(NOOP_PROVENANCE);

export const PROVENANCE_SAVE_DEBOUNCE_MS = 1000;

interface ProvenanceProviderProps {
  form: UseFormReturn<InspectionFormData>;
  inspectionId: string;
  initial: FieldProvenance;
  readOnly?: boolean;
  children: React.ReactNode;
}

export function ProvenanceProvider({
  form,
  inspectionId,
  initial,
  readOnly = false,
  children,
}: ProvenanceProviderProps) {
  const [provenance, setProvenance] = React.useState<FieldProvenance>(initial);
  const provenanceRef = React.useRef(provenance);
  provenanceRef.current = provenance;
  const dirtyRef = React.useRef(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = React.useCallback((): void => {
    if (readOnly) return;
    fetch(`/api/inspections/${inspectionId}/provenance`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldProvenance: provenanceRef.current }),
    }).catch(() => {
      // Provenance is a sidecar — never block the form; the next change retries
    });
  }, [inspectionId, readOnly]);

  // Debounced persistence: mutations mark the map dirty, 1 s after the last change we PATCH the whole map
  React.useEffect(() => {
    if (readOnly || !dirtyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      dirtyRef.current = false;
      persist();
    }, PROVENANCE_SAVE_DEBOUNCE_MS);
  }, [provenance, readOnly, persist]);

  // Flush a pending save on unmount
  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (dirtyRef.current) {
        dirtyRef.current = false;
        persist();
      }
    };
  }, [persist]);

  const update = React.useCallback((fn: (prev: FieldProvenance) => FieldProvenance): void => {
    dirtyRef.current = true;
    setProvenance((prev) => fn(prev));
  }, []);

  const get = React.useCallback(
    (fieldPath: string) => provenance[normalizeFieldPath(fieldPath)],
    [provenance],
  );

  const verify = React.useCallback(
    (fieldPath: string) => {
      const key = normalizeFieldPath(fieldPath);
      update((prev) => {
        const current = prev[key];
        if (!current) return prev;
        return { ...prev, [key]: { ...current, state: "verified", at: new Date().toISOString() } };
      });
    },
    [update],
  );

  const clear = React.useCallback(
    (fieldPath: string) => {
      const key = normalizeFieldPath(fieldPath);
      update((prev) => {
        if (!(key in prev)) return prev;
        const { [key]: _removed, ...rest } = prev;
        return rest;
      });
    },
    [update],
  );

  const acceptSuggestion = React.useCallback(
    (fieldPath: string) => {
      const key = normalizeFieldPath(fieldPath);
      const current = provenanceRef.current[key];
      if (!current || current.state !== "suggested") return;
      if (current.kind === "warning") {
        clear(key);
        return;
      }
      form.setValue(key as FieldPath<InspectionFormData>, current.value as never, {
        shouldDirty: true,
        shouldValidate: true,
      });
      update((prev) => {
        const latest = prev[key];
        if (!latest) return prev;
        return { ...prev, [key]: { ...latest, state: "prefilled", at: new Date().toISOString() } };
      });
    },
    [form, update, clear],
  );

  const setMany = React.useCallback(
    (entries: FieldProvenance) => {
      update((prev) => {
        const next = { ...prev };
        for (const [path, value] of Object.entries(entries)) {
          next[normalizeFieldPath(path)] = value;
        }
        return next;
      });
    },
    [update],
  );

  // prefilled → edited when the form value diverges from what we proposed.
  // Also checks entries nested under the changed path (the scan flow replaces whole tank arrays).
  React.useEffect(() => {
    const subscription = form.watch((values, { name }) => {
      if (!name) return;
      const changed = normalizeFieldPath(name);
      const diverged = Object.keys(provenanceRef.current).filter((key) => {
        if (key !== changed && !key.startsWith(`${changed}.`)) return false;
        const current = provenanceRef.current[key];
        return current.state === "prefilled" && !valuesEqual(getPath(values, key), current.value);
      });
      if (diverged.length === 0) return;
      update((prev) => {
        const next = { ...prev };
        const at = new Date().toISOString();
        for (const key of diverged) {
          const current = next[key];
          if (current?.state === "prefilled") next[key] = { ...current, state: "edited", at };
        }
        return next;
      });
    });
    return () => subscription.unsubscribe();
  }, [form, update]);

  const value = React.useMemo<ProvenanceContextValue>(
    () => ({
      provenance,
      readOnly,
      get,
      verify,
      clear,
      acceptSuggestion,
      dismissSuggestion: clear,
      setMany,
    }),
    [provenance, readOnly, get, verify, clear, acceptSuggestion, setMany],
  );

  return <ProvenanceContext.Provider value={value}>{children}</ProvenanceContext.Provider>;
}

export function useProvenance(
  fieldPath?: string,
): ProvenanceContextValue & { entry?: ProvenanceEntry } {
  const ctx = React.useContext(ProvenanceContext);
  const entry = fieldPath ? ctx.get(fieldPath) : undefined;
  return { ...ctx, entry };
}
