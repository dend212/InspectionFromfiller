"use client";

import * as React from "react";
import type { FieldPath, UseFormReturn } from "react-hook-form";
import { getPath, normalizeFieldPath, valuesEqual } from "@/lib/prefill/merge";
import { ensureTankArrayCapacity } from "@/lib/prefill/tank-capacity";
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
  /** Removes the chip; a suggestion that replaced an edited entry restores that entry instead */
  dismissSuggestion(fieldPath: string): void;
  /** Removes only the warning line attached to an entry (audit 5.1); the entry itself stays */
  dismissWarning(fieldPath: string): void;
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
  dismissWarning: noop,
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
  // Guards the one-shot auto-retry below so a second failure in a row doesn't keep rescheduling.
  const retriedRef = React.useRef(false);
  // The unmount flush can fail after we're gone — never schedule a retry timer then.
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const persist = React.useCallback((): void => {
    if (readOnly) return;

    // Provenance is a sidecar — never block the form. Re-arm dirty so the next
    // edit (or the unmount flush) resends the map, and schedule one retry in
    // case nothing else changes the form. Callers log before calling this.
    const onFailure = (): void => {
      dirtyRef.current = true;
      if (retriedRef.current || !mountedRef.current) return;
      retriedRef.current = true;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (dirtyRef.current) {
          dirtyRef.current = false;
          persist();
        }
      }, PROVENANCE_SAVE_DEBOUNCE_MS);
    };

    fetch(`/api/inspections/${inspectionId}/provenance`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldProvenance: provenanceRef.current }),
    })
      .then(async (res) => {
        if (res.ok) {
          retriedRef.current = false;
          return;
        }
        // A 400/403/500 is a lost save just like a network error — a whole-map
        // replace means one rejected entry drops everything, so it must be loud.
        const body = await res.text().catch(() => "");
        console.error("[provenance] save failed", res.status, body);
        onFailure();
      })
      .catch((err) => {
        console.error("[provenance] save failed", err);
        onFailure();
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
        const { prior: _prior, ...rest } = current;
        return { ...prev, [key]: { ...rest, state: "verified", at: new Date().toISOString() } };
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
      // A suggested tanks.<i>.* field may point past the current array (phase 3 permit proposals)
      ensureTankArrayCapacity(form, [key]);
      form.setValue(key as FieldPath<InspectionFormData>, current.value as never, {
        shouldDirty: true,
        shouldValidate: true,
      });
      update((prev) => {
        const latest = prev[key];
        if (!latest) return prev;
        const { prior: _prior, ...rest } = latest;
        return { ...prev, [key]: { ...rest, state: "prefilled", at: new Date().toISOString() } };
      });
    },
    [form, update, clear],
  );

  const dismissSuggestion = React.useCallback(
    (fieldPath: string) => {
      const key = normalizeFieldPath(fieldPath);
      update((prev) => {
        const current = prev[key];
        if (!current) return prev;
        // The user's edited entry was only parked behind the chip — bring it back as it was
        if (current.state === "suggested" && current.prior) {
          return { ...prev, [key]: current.prior };
        }
        const { [key]: _removed, ...rest } = prev;
        return rest;
      });
    },
    [update],
  );

  const dismissWarning = React.useCallback(
    (fieldPath: string) => {
      const key = normalizeFieldPath(fieldPath);
      // Nothing to drop → don't mark the map dirty
      if (provenanceRef.current[key]?.warning === undefined) return;
      update((prev) => {
        const current = prev[key];
        if (!current || current.warning === undefined) return prev;
        const { warning: _warning, ...rest } = current;
        return { ...prev, [key]: rest };
      });
    },
    [update],
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
      dismissSuggestion,
      dismissWarning,
      setMany,
    }),
    [provenance, readOnly, get, verify, clear, acceptSuggestion, dismissSuggestion, dismissWarning, setMany],
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
