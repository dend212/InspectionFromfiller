"use client";

import { ScanLine } from "lucide-react";
import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { useFormScan } from "@/hooks/use-form-scan";
import type { InspectionFormData } from "@/types/inspection";
import { ScanReviewModal } from "./scan-review-modal";

interface ScanFormButtonProps {
  inspectionId: string;
  form: UseFormReturn<InspectionFormData>;
}

export function ScanFormButton({ inspectionId, form }: ScanFormButtonProps) {
  const [open, setOpen] = useState(false);
  const scan = useFormScan();

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      // Reset scan state when closing
      setTimeout(() => scan.reset(), 300);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          scan.setState("uploading");
          setOpen(true);
        }}
        className="gap-2"
      >
        <ScanLine className="h-4 w-4" />
        Scan Paper Form
      </Button>

      <ScanReviewModal
        open={open}
        onOpenChange={handleOpenChange}
        inspectionId={inspectionId}
        form={form}
        scan={scan}
      />
    </>
  );
}
