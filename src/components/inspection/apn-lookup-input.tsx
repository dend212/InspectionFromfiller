"use client";

import { Search, Loader2 } from "lucide-react";
import { useState } from "react";
import type { FieldPath, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { useProvenance } from "@/components/prefill/provenance-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type AssessorSummary, assessorProposals } from "@/lib/prefill/assessor-fields";
import type { FieldProvenance } from "@/lib/prefill/types";
import type { InspectionFormData } from "@/types/inspection";

interface ApnLookupInputProps {
  form: UseFormReturn<InspectionFormData>;
  /** Fired after the form has been filled — the prefill panel starts a run from here */
  onLookupSuccess?: (result: { apn: string; assessor: AssessorSummary }) => void;
  /** Controlled box text (the prefill panel reads it for Find records); omit for an uncontrolled box */
  value?: string;
  onValueChange?: (value: string) => void;
}

export function ApnLookupInput({ form, onLookupSuccess, value, onValueChange }: ApnLookupInputProps) {
  const [internalApn, setInternalApn] = useState("");
  const apn = value ?? internalApn;
  const setApn = (next: string): void => {
    setInternalApn(next);
    onValueChange?.(next);
  };
  const [loading, setLoading] = useState(false);
  const { setMany } = useProvenance();

  const handleLookup = async () => {
    if (loading) return;
    const trimmed = apn.trim();
    if (!trimmed) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/apn-lookup?apn=${encodeURIComponent(trimmed)}`);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "APN lookup failed");
        return;
      }

      const { assessor: a } = (await res.json()) as { assessor: AssessorSummary };
      const apnUsed = a.apnFormatted || trimmed;

      // The same seven fields the assessor prefill stage proposes — an explicit
      // lookup overwrites, and every written field gets an assessor badge.
      const at = new Date().toISOString();
      const entries: FieldProvenance = {};
      for (const proposal of assessorProposals(a, apnUsed)) {
        form.setValue(proposal.fieldPath as FieldPath<InspectionFormData>, proposal.value as never, {
          shouldDirty: true,
        });
        entries[proposal.fieldPath] = {
          ...proposal.provenance,
          kind: proposal.kind,
          state: "prefilled",
          value: proposal.value,
          at,
        };
      }
      setMany(entries);

      toast.success("Property data loaded from APN");
      onLookupSuccess?.({ apn: apnUsed, assessor: a });
    } catch {
      toast.error("APN lookup failed — try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        type="text"
        aria-label="Assessor Parcel Number"
        placeholder="APN (e.g. 123-45-678)"
        value={apn}
        onChange={(e) => setApn(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleLookup();
          }
        }}
        className="w-44 h-9 text-sm"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleLookup}
        disabled={loading || !apn.trim()}
        className="gap-2"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Search className="h-4 w-4" />
        )}
        APN Lookup
      </Button>
    </div>
  );
}
