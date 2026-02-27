"use client";

import { useState, useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { inspectionFormSchema } from "@/lib/validators/inspection";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import { STEP_LABELS } from "@/lib/constants/inspection";
import type { InspectionFormData } from "@/types/inspection";
import type { MediaRecord } from "@/components/inspection/media-gallery";
import { usePdfGeneration } from "@/hooks/use-pdf-generation";
import { PdfPreview } from "@/components/inspection/pdf-preview";
import { ReviewSection } from "./review-section";
import { ReviewActions } from "./review-actions";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  RefreshCw,
  Save,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

interface ReviewEditorProps {
  inspection: {
    id: string;
    status: string;
    formData: InspectionFormData | null;
    facilityName: string | null;
    facilityAddress: string | null;
    facilityCity: string | null;
    facilityCounty: string | null;
    createdAt: string;
    reviewNotes: string | null;
    customerEmail: string | null;
  };
  media: MediaRecord[];
}

export function ReviewEditor({ inspection, media }: ReviewEditorProps) {
  const [status, setStatus] = useState(inspection.status);
  const [saving, setSaving] = useState(false);
  const [showAllFields, setShowAllFields] = useState<Record<number, boolean>>(
    {}
  );

  const isReadOnly = status === "completed";

  const form = useForm<InspectionFormData>({
    resolver: zodResolver(inspectionFormSchema) as any,
    defaultValues: inspection.formData ?? getDefaultFormValues(""),
  });

  const { generatePdf, pdfData, isGenerating, error, clearPdf } =
    usePdfGeneration();

  const isDirty = form.formState.isDirty;

  // Clear PDF when form is dirty so user knows to regenerate
  useEffect(() => {
    if (isDirty && pdfData) {
      clearPdf();
    }
  }, [isDirty, pdfData, clearPdf]);

  const handleRegenerate = useCallback(async () => {
    clearPdf();
    await generatePdf(form.getValues(), null, media);
  }, [form, media, generatePdf, clearPdf]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = form.getValues();
      const res = await fetch(`/api/inspections/${inspection.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      form.reset(data);
      toast.success("Changes saved");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save changes"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = (newStatus: string) => {
    setStatus(newStatus);
  };

  const toggleShowAll = (section: number) => {
    setShowAllFields((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Helper to render a text input field
  const renderTextField = (
    name: string,
    label: string,
    options?: { textarea?: boolean; disabled?: boolean }
  ) => (
    <FormField
      control={form.control}
      name={name as any}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="text-xs font-medium text-muted-foreground">
            {label}
          </FormLabel>
          <FormControl>
            {options?.textarea ? (
              <Textarea
                {...field}
                value={(field.value as string) ?? ""}
                disabled={isReadOnly || options?.disabled}
                rows={4}
                className="resize-none text-sm"
              />
            ) : (
              <Input
                {...field}
                value={(field.value as string) ?? ""}
                disabled={isReadOnly || options?.disabled}
                className="text-sm"
              />
            )}
          </FormControl>
        </FormItem>
      )}
    />
  );

  // Helper to render a checkbox field
  const renderCheckbox = (
    name: string,
    label: string,
    options?: { disabled?: boolean }
  ) => (
    <FormField
      control={form.control}
      name={name as any}
      render={({ field }) => (
        <FormItem className="flex items-center gap-2 space-y-0">
          <FormControl>
            <Checkbox
              checked={field.value as boolean}
              onCheckedChange={field.onChange}
              disabled={isReadOnly || options?.disabled}
            />
          </FormControl>
          <FormLabel className="text-xs font-normal">{label}</FormLabel>
        </FormItem>
      )}
    />
  );

  // Helper to render a read-only display value
  const renderReadOnly = (label: string, value: string | undefined | null) => (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{value || "-"}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Navigation */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/review">
            <ArrowLeft className="size-4" />
            Back to Queue
          </Link>
        </Button>
        <h1 className="text-lg font-semibold truncate">
          {inspection.facilityName || "Untitled Inspection"}
        </h1>
      </div>

      <Form {...form}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left panel: scrollable form sections */}
          <div className="space-y-4">
            {/* Action bar */}
            <ReviewActions
              inspectionId={inspection.id}
              status={status}
              facilityAddress={inspection.facilityAddress}
              customerEmail={inspection.customerEmail}
              onStatusChange={handleStatusChange}
            />

            {/* Dirty indicator */}
            {isDirty && !isReadOnly && (
              <p className="text-xs text-amber-600">
                Form data changed -- regenerate PDF to see updates
              </p>
            )}

            {/* Section 1: Facility Information */}
            <ReviewSection title={STEP_LABELS[0]} defaultOpen>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {renderTextField(
                  "facilityInfo.facilityName",
                  "Facility / Property Name"
                )}
                {renderTextField("facilityInfo.facilityAddress", "Address")}
                {renderTextField("facilityInfo.facilityCity", "City")}
                {renderTextField("facilityInfo.facilityCounty", "County")}
                {renderTextField("facilityInfo.facilityState", "State")}
                {renderTextField("facilityInfo.facilityZip", "Zip")}
                {renderTextField(
                  "facilityInfo.taxParcelNumber",
                  "Tax Parcel Number"
                )}
                {renderTextField(
                  "facilityInfo.dateOfInspection",
                  "Date of Inspection"
                )}
              </div>

              <div className="mt-4 border-t pt-4">
                <p className="mb-3 text-xs font-semibold uppercase text-muted-foreground">
                  Seller / Transferor
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {renderTextField("facilityInfo.sellerName", "Seller Name")}
                  {renderTextField(
                    "facilityInfo.sellerAddress",
                    "Seller Address"
                  )}
                  {renderTextField("facilityInfo.sellerCity", "Seller City")}
                  {renderTextField("facilityInfo.sellerState", "Seller State")}
                  {renderTextField("facilityInfo.sellerZip", "Seller Zip")}
                </div>
              </div>

              <div className="mt-4 border-t pt-4">
                <p className="mb-3 text-xs font-semibold uppercase text-muted-foreground">
                  Inspector
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {renderTextField(
                    "facilityInfo.inspectorName",
                    "Inspector Name"
                  )}
                  {renderTextField("facilityInfo.company", "Company")}
                  {renderTextField(
                    "facilityInfo.certificationNumber",
                    "Certification #"
                  )}
                  {renderTextField(
                    "facilityInfo.registrationNumber",
                    "Registration #"
                  )}
                  {renderTextField("facilityInfo.truckNumber", "Truck #")}
                  {renderTextField("facilityInfo.employeeName", "Employee Name")}
                </div>
              </div>

              {/* Show All toggle for less common fields */}
              <button
                type="button"
                className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => toggleShowAll(0)}
              >
                {showAllFields[0] ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                {showAllFields[0] ? "Hide" : "Show"} qualification &amp; records
                fields
              </button>
              {showAllFields[0] && (
                <div className="mt-3 space-y-4 border-t pt-4">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    Inspector Qualifications
                  </p>
                  <div className="space-y-2">
                    {renderCheckbox(
                      "facilityInfo.hasAdeqCourse",
                      "Completed ADEQ Course"
                    )}
                    {renderTextField(
                      "facilityInfo.adeqCourseDetails",
                      "ADEQ Course Details"
                    )}
                    {renderCheckbox(
                      "facilityInfo.isProfessionalEngineer",
                      "Professional Engineer"
                    )}
                    {renderCheckbox(
                      "facilityInfo.isRegisteredSanitarian",
                      "Registered Sanitarian"
                    )}
                    {renderCheckbox(
                      "facilityInfo.isWastewaterOperator",
                      "Wastewater Operator"
                    )}
                    {renderCheckbox(
                      "facilityInfo.isLicensedContractor",
                      "Licensed Contractor"
                    )}
                    {renderCheckbox(
                      "facilityInfo.hasPumperTruck",
                      "Has Pumper Truck"
                    )}
                  </div>

                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    Records
                  </p>
                  <div className="space-y-2">
                    {renderCheckbox(
                      "facilityInfo.hasDischargeAuth",
                      "Discharge Authorization"
                    )}
                    {renderTextField(
                      "facilityInfo.dischargeAuthPermitNo",
                      "Discharge Auth Permit #"
                    )}
                    {renderCheckbox(
                      "facilityInfo.hasApprovalOfConstruction",
                      "Approval of Construction"
                    )}
                    {renderTextField(
                      "facilityInfo.approvalPermitNo",
                      "Approval Permit #"
                    )}
                    {renderCheckbox(
                      "facilityInfo.hasSitePlan",
                      "Site Plan Available"
                    )}
                    {renderCheckbox(
                      "facilityInfo.hasOperationDocs",
                      "Operation Docs Available"
                    )}
                    {renderCheckbox(
                      "facilityInfo.hasOtherRecords",
                      "Other Records"
                    )}
                    {renderTextField(
                      "facilityInfo.otherRecordsDescription",
                      "Other Records Description"
                    )}
                  </div>

                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    Facility Details
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {renderTextField(
                      "facilityInfo.waterSource",
                      "Water Source"
                    )}
                    {renderTextField(
                      "facilityInfo.wellDistance",
                      "Well Distance"
                    )}
                    {renderTextField(
                      "facilityInfo.wastewaterSource",
                      "Wastewater Source"
                    )}
                    {renderTextField(
                      "facilityInfo.occupancyType",
                      "Occupancy Type"
                    )}
                    {renderTextField(
                      "facilityInfo.facilityType",
                      "Facility Type"
                    )}
                    {renderTextField(
                      "facilityInfo.numberOfSystems",
                      "# of Systems"
                    )}
                    {renderTextField("facilityInfo.facilityAge", "Facility Age")}
                  </div>

                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    Overall Condition Ratings
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {renderTextField(
                      "facilityInfo.septicTankCondition",
                      "Septic Tank Condition"
                    )}
                    {renderTextField(
                      "facilityInfo.disposalWorksCondition",
                      "Disposal Works Condition"
                    )}
                    {renderTextField(
                      "facilityInfo.alternativeSystemCondition",
                      "Alternative System Condition"
                    )}
                    {renderTextField(
                      "facilityInfo.alternativeDisposalCondition",
                      "Alternative Disposal Condition"
                    )}
                  </div>
                </div>
              )}
            </ReviewSection>

            {/* Section 2: General Treatment */}
            <ReviewSection title={STEP_LABELS[1]}>
              <div className="space-y-4">
                {renderReadOnly(
                  "System Types",
                  (
                    form.getValues("generalTreatment.systemTypes") ?? []
                  ).join(", ") || "None selected"
                )}
                {renderTextField(
                  "generalTreatment.hasPerformanceAssurancePlan",
                  "Performance Assurance Plan"
                )}
                {renderCheckbox(
                  "generalTreatment.alternativeSystem",
                  "Alternative System"
                )}

                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => toggleShowAll(1)}
                >
                  {showAllFields[1] ? (
                    <ChevronDown className="size-3" />
                  ) : (
                    <ChevronRight className="size-3" />
                  )}
                  {showAllFields[1] ? "Hide" : "Show"} alternative system
                  details
                </button>
                {showAllFields[1] && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t pt-4">
                    {renderTextField(
                      "generalTreatment.altSystemManufacturer",
                      "Manufacturer"
                    )}
                    {renderTextField(
                      "generalTreatment.altSystemModel",
                      "Model"
                    )}
                    {renderTextField(
                      "generalTreatment.altSystemCapacity",
                      "Capacity"
                    )}
                    {renderTextField(
                      "generalTreatment.altSystemDateInstalled",
                      "Date Installed"
                    )}
                    {renderTextField(
                      "generalTreatment.altSystemCondition",
                      "Condition"
                    )}
                    {renderTextField(
                      "generalTreatment.altSystemNotes",
                      "Notes",
                      { textarea: true }
                    )}
                  </div>
                )}
              </div>
            </ReviewSection>

            {/* Section 3: Design Flow */}
            <ReviewSection title={STEP_LABELS[2]}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {renderTextField(
                  "designFlow.estimatedDesignFlow",
                  "Estimated Design Flow"
                )}
                {renderTextField(
                  "designFlow.designFlowBasis",
                  "Design Flow Basis"
                )}
                {renderTextField(
                  "designFlow.numberOfBedrooms",
                  "Number of Bedrooms"
                )}
                {renderTextField(
                  "designFlow.fixtureCount",
                  "Fixture Count"
                )}
                {renderTextField(
                  "designFlow.nonDwellingGpd",
                  "Non-Dwelling GPD"
                )}
                {renderTextField(
                  "designFlow.actualFlowEvaluation",
                  "Actual Flow Evaluation"
                )}
              </div>
              <div className="mt-4">
                {renderTextField(
                  "designFlow.designFlowComments",
                  "Design Flow Comments",
                  { textarea: true }
                )}
              </div>
            </ReviewSection>

            {/* Section 4: Septic Tank */}
            <ReviewSection title={STEP_LABELS[3]}>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {renderTextField(
                    "septicTank.numberOfTanks",
                    "Number of Tanks"
                  )}
                  {renderTextField("septicTank.tanksPumped", "Tanks Pumped")}
                  {renderTextField(
                    "septicTank.haulerCompany",
                    "Hauler Company"
                  )}
                  {renderTextField(
                    "septicTank.haulerLicense",
                    "Hauler License"
                  )}
                  {renderTextField(
                    "septicTank.tankInspectionDate",
                    "Tank Inspection Date"
                  )}
                </div>

                {/* Per-tank data */}
                {(form.getValues("septicTank.tanks") ?? []).map(
                  (_tank: any, index: number) => (
                    <div
                      key={index}
                      className="rounded-lg border p-4 space-y-4"
                    >
                      <p className="text-sm font-semibold">
                        Tank {index + 1}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {renderTextField(
                          `septicTank.tanks.${index}.liquidLevel`,
                          "Liquid Level"
                        )}
                        {renderTextField(
                          `septicTank.tanks.${index}.tankCapacity`,
                          "Tank Capacity"
                        )}
                        {renderTextField(
                          `septicTank.tanks.${index}.tankMaterial`,
                          "Tank Material"
                        )}
                        {renderTextField(
                          `septicTank.tanks.${index}.tankDimensions`,
                          "Tank Dimensions"
                        )}
                        {renderTextField(
                          `septicTank.tanks.${index}.numberOfCompartments`,
                          "Compartments"
                        )}
                        {renderTextField(
                          `septicTank.tanks.${index}.primaryScumThickness`,
                          "Scum Thickness"
                        )}
                        {renderTextField(
                          `septicTank.tanks.${index}.primarySludgeThickness`,
                          "Sludge Thickness"
                        )}
                      </div>

                      <p className="text-xs font-semibold uppercase text-muted-foreground">
                        Deficiencies
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {renderCheckbox(
                          `septicTank.tanks.${index}.deficiencyRootInvasion`,
                          "Root Invasion"
                        )}
                        {renderCheckbox(
                          `septicTank.tanks.${index}.deficiencyExposedRebar`,
                          "Exposed Rebar"
                        )}
                        {renderCheckbox(
                          `septicTank.tanks.${index}.deficiencyCracks`,
                          "Cracks"
                        )}
                        {renderCheckbox(
                          `septicTank.tanks.${index}.deficiencyDamagedInlet`,
                          "Damaged Inlet"
                        )}
                        {renderCheckbox(
                          `septicTank.tanks.${index}.deficiencyDamagedOutlet`,
                          "Damaged Outlet"
                        )}
                        {renderCheckbox(
                          `septicTank.tanks.${index}.deficiencyDamagedLids`,
                          "Damaged Lids"
                        )}
                        {renderCheckbox(
                          `septicTank.tanks.${index}.deficiencyDeterioratingConcrete`,
                          "Deteriorating Concrete"
                        )}
                        {renderCheckbox(
                          `septicTank.tanks.${index}.deficiencyOther`,
                          "Other"
                        )}
                      </div>

                      <button
                        type="button"
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          toggleShowAll(30 + index)
                        }
                      >
                        {showAllFields[30 + index] ? (
                          <ChevronDown className="size-3" />
                        ) : (
                          <ChevronRight className="size-3" />
                        )}
                        {showAllFields[30 + index] ? "Hide" : "Show"} all tank
                        fields
                      </button>
                      {showAllFields[30 + index] && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t pt-4">
                          {renderTextField(
                            `septicTank.tanks.${index}.capacityBasis`,
                            "Capacity Basis"
                          )}
                          {renderTextField(
                            `septicTank.tanks.${index}.accessOpenings`,
                            "Access Openings"
                          )}
                          {renderTextField(
                            `septicTank.tanks.${index}.lidsRisersPresent`,
                            "Lids/Risers Present"
                          )}
                          {renderTextField(
                            `septicTank.tanks.${index}.lidsSecurelyFastened`,
                            "Lids Securely Fastened"
                          )}
                          {renderTextField(
                            `septicTank.tanks.${index}.compromisedTank`,
                            "Compromised Tank"
                          )}
                          {renderTextField(
                            `septicTank.tanks.${index}.baffleMaterial`,
                            "Baffle Material"
                          )}
                          {renderTextField(
                            `septicTank.tanks.${index}.inletBaffleCondition`,
                            "Inlet Baffle Condition"
                          )}
                          {renderTextField(
                            `septicTank.tanks.${index}.outletBaffleCondition`,
                            "Outlet Baffle Condition"
                          )}
                          {renderTextField(
                            `septicTank.tanks.${index}.effluentFilterPresent`,
                            "Effluent Filter Present"
                          )}
                          {renderTextField(
                            `septicTank.tanks.${index}.effluentFilterServiced`,
                            "Effluent Filter Serviced"
                          )}
                          {renderTextField(
                            `septicTank.tanks.${index}.secondaryScumThickness`,
                            "Secondary Scum Thickness"
                          )}
                          {renderTextField(
                            `septicTank.tanks.${index}.secondarySludgeThickness`,
                            "Secondary Sludge Thickness"
                          )}
                        </div>
                      )}
                    </div>
                  )
                )}

                {renderTextField(
                  "septicTank.septicTankComments",
                  "Inspector Comments",
                  { textarea: true }
                )}
              </div>
            </ReviewSection>

            {/* Section 5: Disposal Works -- PRIMARY editing section for Dan */}
            <ReviewSection title={STEP_LABELS[4]}>
              <div className="space-y-4">
                {/* Key summary fields -- prominent */}
                <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 space-y-4">
                  <p className="text-xs font-semibold uppercase text-primary">
                    Inspector Summary &amp; Recommendations
                  </p>
                  {renderTextField(
                    "disposalWorks.disposalWorksComments",
                    "Inspector Summary / Comments",
                    { textarea: true }
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {renderTextField(
                    "disposalWorks.disposalWorksLocationDetermined",
                    "Location Determined"
                  )}
                  {renderTextField(
                    "disposalWorks.disposalType",
                    "Disposal Type"
                  )}
                  {renderTextField(
                    "disposalWorks.distributionMethod",
                    "Distribution Method"
                  )}
                  {renderTextField(
                    "disposalWorks.supplyLineMaterial",
                    "Supply Line Material"
                  )}
                  {renderTextField(
                    "disposalWorks.distributionComponentInspected",
                    "Distribution Component Inspected"
                  )}
                  {renderTextField(
                    "disposalWorks.inspectionPortsPresent",
                    "Inspection Ports Present"
                  )}
                  {renderTextField(
                    "disposalWorks.numberOfPorts",
                    "Number of Ports"
                  )}
                  {renderTextField(
                    "disposalWorks.hydraulicLoadTestPerformed",
                    "Hydraulic Load Test"
                  )}
                  {renderTextField(
                    "disposalWorks.hasDisposalDeficiency",
                    "Has Deficiency"
                  )}
                  {renderTextField(
                    "disposalWorks.repairsRecommended",
                    "Repairs Recommended"
                  )}
                </div>

                {/* Disposal Works Deficiencies */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                    Disposal Works Deficiencies
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {renderCheckbox(
                      "disposalWorks.defCrushedOutletPipe",
                      "Crushed Outlet Pipe"
                    )}
                    {renderCheckbox(
                      "disposalWorks.defRootInvasion",
                      "Root Invasion"
                    )}
                    {renderCheckbox(
                      "disposalWorks.defHighWaterLines",
                      "High Water Lines"
                    )}
                    {renderCheckbox(
                      "disposalWorks.defDboxNotFunctioning",
                      "D-box Not Functioning"
                    )}
                    {renderCheckbox(
                      "disposalWorks.defSurfacing",
                      "Surfacing"
                    )}
                    {renderCheckbox(
                      "disposalWorks.defLushVegetation",
                      "Lush Vegetation"
                    )}
                    {renderCheckbox(
                      "disposalWorks.defErosion",
                      "Erosion"
                    )}
                    {renderCheckbox(
                      "disposalWorks.defPondingWater",
                      "Ponding Water"
                    )}
                    {renderCheckbox(
                      "disposalWorks.defAnimalIntrusion",
                      "Animal Intrusion"
                    )}
                    {renderCheckbox(
                      "disposalWorks.defLoadTestFailure",
                      "Load Test Failure"
                    )}
                    {renderCheckbox(
                      "disposalWorks.defCouldNotDetermine",
                      "Could Not Determine"
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {renderTextField(
                    "disposalWorks.signatureDate",
                    "Signature Date"
                  )}
                  {renderTextField(
                    "disposalWorks.printedName",
                    "Printed Name"
                  )}
                </div>
              </div>
            </ReviewSection>

            {/* Save button */}
            {!isReadOnly && (
              <Button
                onClick={handleSave}
                disabled={saving}
                className="w-full"
                size="lg"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save Changes
              </Button>
            )}
          </div>

          {/* Right panel: sticky PDF preview */}
          <div className="lg:sticky lg:top-20 lg:self-start space-y-4">
            <Card>
              <CardContent className="pt-6 space-y-4">
                {!isReadOnly && (
                  <Button
                    onClick={handleRegenerate}
                    disabled={isGenerating}
                    className="w-full"
                  >
                    {isGenerating ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    Regenerate PDF
                  </Button>
                )}

                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}

                {isDirty && !isReadOnly && (
                  <p className="text-xs text-amber-600">
                    Form data changed -- click &quot;Regenerate PDF&quot; to see
                    updates
                  </p>
                )}

                {pdfData ? (
                  <PdfPreview
                    pdfData={pdfData}
                    facilityName={
                      form.watch("facilityInfo.facilityName") || undefined
                    }
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <RefreshCw className="size-8 mb-2 opacity-30" />
                    <p className="text-sm">
                      Click &quot;Regenerate PDF&quot; to preview
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </Form>
    </div>
  );
}
