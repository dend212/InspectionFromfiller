"use client";

import { AlertCircle, CheckCircle2, Loader2, ScanLine } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { UseFormScanReturn } from "@/hooks/use-form-scan";
import type { ExtractedField } from "@/lib/ai/scan-types";
import { STEP_LABELS } from "@/lib/constants/inspection";
import type { InspectionFormData } from "@/types/inspection";
import { ScanUploadZone } from "./scan-upload-zone";

/** Human-readable labels for common field paths */
const FIELD_LABELS: Record<string, string> = {
  "facilityInfo.facilityName": "Property Name",
  "facilityInfo.facilityAddress": "Address",
  "facilityInfo.facilityCity": "City",
  "facilityInfo.facilityCounty": "County",
  "facilityInfo.facilityZip": "ZIP Code",
  "facilityInfo.taxParcelNumber": "Tax Parcel Number",
  "facilityInfo.dateOfInspection": "Date of Inspection",
  "facilityInfo.sellerName": "Seller Name",
  "facilityInfo.sellerAddress": "Seller Address",
  "facilityInfo.sellerCity": "Seller City",
  "facilityInfo.sellerState": "Seller State",
  "facilityInfo.sellerZip": "Seller ZIP",
  "facilityInfo.inspectorName": "Inspector Name",
  "facilityInfo.company": "Company",
  "facilityInfo.certificationNumber": "Certification #",
  "facilityInfo.registrationNumber": "Registration #",
  "facilityInfo.truckNumber": "Truck #",
  "facilityInfo.recordsAvailable": "Records Available",
  "facilityInfo.isCesspool": "Is Cesspool",
  "facilityInfo.waterSource": "Water Source",
  "facilityInfo.wellDistance": "Well Distance",
  "facilityInfo.wastewaterSource": "Wastewater Source",
  "facilityInfo.occupancyType": "Occupancy Type",
  "facilityInfo.facilityType": "Facility Type",
  "facilityInfo.facilitySystemTypes": "System Types",
  "facilityInfo.numberOfSystems": "Number of Systems",
  "facilityInfo.facilityAge": "Facility Age",
  "facilityInfo.septicTankCondition": "Septic Tank Condition",
  "facilityInfo.disposalWorksCondition": "Disposal Works Condition",
  "facilityInfo.alternativeSystemCondition": "Alt System Condition",
  "facilityInfo.alternativeDisposalCondition": "Alt Disposal Condition",
  "generalTreatment.systemTypes": "System Types (GP 4.02+)",
  "generalTreatment.hasPerformanceAssurancePlan": "Performance Assurance Plan",
  "generalTreatment.alternativeSystem": "Alternative System",
  "generalTreatment.altSystemManufacturer": "Alt Manufacturer",
  "generalTreatment.altSystemModel": "Alt Model",
  "generalTreatment.altSystemCapacity": "Alt Capacity",
  "designFlow.estimatedDesignFlow": "Design Flow (GPD)",
  "designFlow.designFlowBasis": "Design Flow Basis",
  "designFlow.numberOfBedrooms": "Bedrooms",
  "designFlow.fixtureCount": "Fixture Count",
  "designFlow.nonDwellingGpd": "Non-Dwelling GPD",
  "designFlow.actualFlowEvaluation": "Actual Flow Evaluation",
  "designFlow.designFlowComments": "Design Flow Comments",
  "septicTank.numberOfTanks": "Number of Tanks",
  "septicTank.tanksPumped": "Tanks Pumped",
  "septicTank.haulerCompany": "Hauler Company",
  "septicTank.haulerLicense": "Hauler License",
  "septicTank.tankInspectionDate": "Tank Inspection Date",
  "septicTank.septicTankComments": "Tank Comments",
  "disposalWorks.disposalWorksLocationDetermined": "Location Determined",
  "disposalWorks.disposalType": "Disposal Type",
  "disposalWorks.distributionMethod": "Distribution Method",
  "disposalWorks.supplyLineMaterial": "Supply Line Material",
  "disposalWorks.distributionComponentInspected": "Distribution Inspected",
  "disposalWorks.inspectionPortsPresent": "Inspection Ports",
  "disposalWorks.numberOfPorts": "Number of Ports",
  "disposalWorks.hydraulicLoadTestPerformed": "Hydraulic Load Test",
  "disposalWorks.hasDisposalDeficiency": "Has Deficiency",
  "disposalWorks.repairsRecommended": "Repairs Recommended",
  "disposalWorks.disposalWorksComments": "Disposal Works Comments",
  "disposalWorks.signatureDate": "Signature Date",
  "disposalWorks.printedName": "Printed Name",
};

/** Get human-readable label for a field path */
function getFieldLabel(fieldPath: string): string {
  if (FIELD_LABELS[fieldPath]) return FIELD_LABELS[fieldPath];

  // Handle tank array fields
  const tankMatch = fieldPath.match(/^septicTank\.tanks\[(\d+)\]\.(\w+)$/);
  if (tankMatch) {
    const tankNum = Number.parseInt(tankMatch[1], 10) + 1;
    const field = tankMatch[2];
    // Convert camelCase to Title Case
    const label = field.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
    return `Tank ${tankNum}: ${label}`;
  }

  // Fallback: last segment in title case
  const last = fieldPath.split(".").pop() ?? fieldPath;
  return last.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
}

/** Get the step index for a field path */
function getStepIndex(fieldPath: string): number {
  if (fieldPath.startsWith("facilityInfo.")) return 0;
  if (fieldPath.startsWith("generalTreatment.")) return 1;
  if (fieldPath.startsWith("designFlow.")) return 2;
  if (fieldPath.startsWith("septicTank.")) return 3;
  if (fieldPath.startsWith("disposalWorks.")) return 4;
  return -1;
}

/** Get confidence badge color class */
function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.9)
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400";
  if (confidence >= 0.8) return "bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-400";
  if (confidence >= 0.7)
    return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
  return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
}

/** Format a field value for display */
function formatValue(value: string | boolean | string[]): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  if (value.length > 80) return `${value.slice(0, 80)}...`;
  return value;
}

/** Group fields by step */
function groupFieldsByStep(fields: ExtractedField[]): Map<number, ExtractedField[]> {
  const groups = new Map<number, ExtractedField[]>();
  for (const field of fields) {
    const step = getStepIndex(field.fieldPath);
    if (!groups.has(step)) groups.set(step, []);
    groups.get(step)!.push(field);
  }
  return groups;
}

interface ScanReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inspectionId: string;
  form: UseFormReturn<InspectionFormData>;
  scan: UseFormScanReturn;
}

export function ScanReviewModal({
  open,
  onOpenChange,
  inspectionId,
  form,
  scan,
}: ScanReviewModalProps) {
  const {
    state,
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
  } = scan;

  const handleClose = () => {
    if (state === "scanning") return; // Don't close while scanning
    onOpenChange(false);
    // Reset after animation completes
    setTimeout(reset, 300);
  };

  const handleApply = () => {
    applyFields(form);
    onOpenChange(false);
    setTimeout(reset, 300);
  };

  const selectedCount = selectedFields.size;
  const totalFields = scanResult?.fields.length ?? 0;

  return (
    <Sheet open={open} onOpenChange={state === "scanning" ? undefined : onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg overflow-y-auto"
        showCloseButton={state !== "scanning"}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5" />
            Scan Paper Form
          </SheetTitle>
          <SheetDescription>
            {state === "idle" || state === "uploading"
              ? "Upload photos of your completed paper form to auto-fill fields."
              : state === "scanning"
                ? "Analyzing your form..."
                : state === "reviewing"
                  ? `${totalFields} fields extracted. Review and select which to apply.`
                  : "Fields applied successfully."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 px-4 pb-4">
          {/* Upload state */}
          {(state === "idle" || state === "uploading") && (
            <div className="space-y-4">
              <ScanUploadZone
                inspectionId={inspectionId}
                uploadedImages={uploadedImages}
                onUploadComplete={addUploadedImage}
                onRemoveImage={removeUploadedImage}
              />

              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  className="flex-1"
                  onClick={() => startScan(inspectionId)}
                  disabled={uploadedImages.length === 0}
                >
                  <ScanLine className="mr-2 h-4 w-4" />
                  Start Scan ({uploadedImages.length} page{uploadedImages.length !== 1 ? "s" : ""})
                </Button>
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Scanning state */}
          {state === "scanning" && (
            <div className="flex flex-col items-center gap-4 py-16">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <div className="text-center">
                <p className="font-medium">
                  Analyzing {uploadedImages.length} page{uploadedImages.length !== 1 ? "s" : ""}...
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  This usually takes 10-30 seconds
                </p>
              </div>
            </div>
          )}

          {/* Review state */}
          {state === "reviewing" && scanResult && (
            <div className="space-y-4">
              {/* Summary bar */}
              <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                <span className="text-sm font-medium">
                  {selectedCount} of {totalFields} selected
                </span>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={selectAllHighConfidence}>
                    Select High Confidence
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={clearAllSelections}>
                    Clear All
                  </Button>
                </div>
              </div>

              {/* Fields grouped by step */}
              {Array.from(groupFieldsByStep(scanResult.fields).entries())
                .sort(([a], [b]) => a - b)
                .map(([stepIndex, fields]) => (
                  <div key={stepIndex} className="space-y-1">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-2">
                      {STEP_LABELS[stepIndex] ?? "Other"}
                      <span className="ml-2 text-xs font-normal">
                        ({fields.length} field{fields.length !== 1 ? "s" : ""})
                      </span>
                    </h3>

                    <div className="rounded-lg border divide-y">
                      {fields.map((field) => (
                        <button
                          type="button"
                          key={field.fieldPath}
                          className="flex w-full items-start gap-3 p-3 text-left cursor-pointer hover:bg-muted/30 transition-colors"
                          onClick={() => toggleField(field.fieldPath)}
                        >
                          <Checkbox
                            checked={selectedFields.has(field.fieldPath)}
                            onCheckedChange={() => toggleField(field.fieldPath)}
                            className="mt-0.5"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">
                                {getFieldLabel(field.fieldPath)}
                              </span>
                              <span
                                className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${getConfidenceColor(field.confidence)}`}
                              >
                                {Math.round(field.confidence * 100)}%
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground truncate mt-0.5">
                              {formatValue(field.value)}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

              {/* Processing info */}
              <p className="text-xs text-muted-foreground text-center pt-2">
                Processed {scanResult.metadata.pagesProcessed} page
                {scanResult.metadata.pagesProcessed !== 1 ? "s" : ""} in{" "}
                {(scanResult.metadata.processingTimeMs / 1000).toFixed(1)}s
              </p>

              {/* Action buttons */}
              <div className="flex gap-2 pt-2 sticky bottom-0 bg-background pb-2">
                <Button
                  type="button"
                  className="flex-1"
                  onClick={handleApply}
                  disabled={selectedCount === 0}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Apply {selectedCount} Field{selectedCount !== 1 ? "s" : ""}
                </Button>
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
