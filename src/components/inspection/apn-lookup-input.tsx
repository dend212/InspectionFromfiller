"use client";

import { Search, Loader2 } from "lucide-react";
import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { InspectionFormData } from "@/types/inspection";

interface ApnLookupInputProps {
  form: UseFormReturn<InspectionFormData>;
}

export function ApnLookupInput({ form }: ApnLookupInputProps) {
  const [apn, setApn] = useState("");
  const [loading, setLoading] = useState(false);

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

      const { assessor: a } = await res.json();
      const fields: Array<[keyof InspectionFormData["facilityInfo"], string]> = [
        ["facilityName", a.ownerName],
        ["sellerName", a.ownerName],
        ["facilityAddress", a.physicalAddress],
        ["facilityCity", a.city],
        ["facilityZip", a.zip],
        ["facilityCounty", a.county],
        ["taxParcelNumber", a.apnFormatted || trimmed],
      ];

      for (const [field, value] of fields) {
        if (value) {
          form.setValue(`facilityInfo.${field}`, value, { shouldDirty: true });
        }
      }

      toast.success("Property data loaded from APN");
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
