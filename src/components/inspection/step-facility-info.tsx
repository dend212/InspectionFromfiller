"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { MediaGallery, type MediaRecord } from "@/components/inspection/media-gallery";
import { PhotoCapture } from "@/components/inspection/photo-capture";
import { ButtonGroup } from "@/components/ui/button-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ChevronDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  AZ_COUNTIES,
  CONDITION_OPTIONS,
  FACILITY_SYSTEM_TYPES,
  FACILITY_TYPES,
  OCCUPANCY_TYPES,
  WASTEWATER_SOURCES,
  WATER_SOURCES,
} from "@/lib/constants/inspection";
import type { InspectionFormData } from "@/types/inspection";

const SECTION_NAME = "facility-info";

interface StepFacilityInfoProps {
  inspectionId: string;
}

export function StepFacilityInfo({ inspectionId }: StepFacilityInfoProps) {
  const form = useFormContext<InspectionFormData>();
  const [media, setMedia] = useState<MediaRecord[]>([]);

  // Auto-set "Records Available?" to "yes" when any record checkbox is checked
  const hasDischargeAuth = useWatch({ control: form.control, name: "facilityInfo.hasDischargeAuth" });
  const hasApprovalOfConstruction = useWatch({ control: form.control, name: "facilityInfo.hasApprovalOfConstruction" });
  const hasSitePlan = useWatch({ control: form.control, name: "facilityInfo.hasSitePlan" });
  const hasOperationDocs = useWatch({ control: form.control, name: "facilityInfo.hasOperationDocs" });
  const hasOtherRecords = useWatch({ control: form.control, name: "facilityInfo.hasOtherRecords" });
  const facilityAddress = useWatch({ control: form.control, name: "facilityInfo.facilityAddress" });
  const facilityCity = useWatch({ control: form.control, name: "facilityInfo.facilityCity" });
  const sellerAddress = useWatch({ control: form.control, name: "facilityInfo.sellerAddress" });
  const sellerCity = useWatch({ control: form.control, name: "facilityInfo.sellerCity" });
  const facilityType = useWatch({ control: form.control, name: "facilityInfo.facilityType" });
  const hasAdeqCourse = useWatch({ control: form.control, name: "facilityInfo.hasAdeqCourse" });
  const isProfessionalEngineer = useWatch({ control: form.control, name: "facilityInfo.isProfessionalEngineer" });
  const isRegisteredSanitarian = useWatch({ control: form.control, name: "facilityInfo.isRegisteredSanitarian" });
  const isWastewaterOperator = useWatch({ control: form.control, name: "facilityInfo.isWastewaterOperator" });
  const isLicensedContractor = useWatch({ control: form.control, name: "facilityInfo.isLicensedContractor" });
  const hasPumperTruck = useWatch({ control: form.control, name: "facilityInfo.hasPumperTruck" });

  useEffect(() => {
    const anyChecked = hasDischargeAuth || hasApprovalOfConstruction || hasSitePlan || hasOperationDocs || hasOtherRecords;
    if (anyChecked && form.getValues("facilityInfo.recordsAvailable") !== "yes") {
      form.setValue("facilityInfo.recordsAvailable", "yes");
    }
  }, [hasDischargeAuth, hasApprovalOfConstruction, hasSitePlan, hasOperationDocs, hasOtherRecords]);

  useEffect(() => {
    async function loadMedia() {
      try {
        const res = await fetch(`/api/inspections/${inspectionId}/media`);
        if (res.ok) {
          const data = (await res.json()) as MediaRecord[];
          setMedia(data);
        }
      } catch {
        // Silently fail -- media will show empty
      }
    }
    loadMedia();
  }, [inspectionId]);

  const handleDeleteMedia = useCallback(
    async (mediaId: string) => {
      await fetch(`/api/inspections/${inspectionId}/media`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId }),
      });
      setMedia((prev) => prev.filter((m) => m.id !== mediaId));
    },
    [inspectionId],
  );

  const handleLabelUpdate = useCallback((mediaId: string, newLabel: string) => {
    setMedia((prev) => prev.map((m) => (m.id === mediaId ? { ...m, label: newLabel } : m)));
  }, []);

  const handleDescriptionUpdate = useCallback((mediaId: string, newDescription: string) => {
    setMedia((prev) => prev.map((m) => (m.id === mediaId ? { ...m, description: newDescription } : m)));
  }, []);

  return (
    <div className="space-y-8">
      {/* Property Information */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Property Information</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="facilityInfo.facilityName"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel className="text-base">Facility / Property Name *</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" placeholder="Enter property name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.facilityAddress"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel className="text-base">Address</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" placeholder="Street address" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.facilityCity"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">City</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.facilityCounty"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">County</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="min-h-[48px] w-full">
                      <SelectValue placeholder="Select county" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {AZ_COUNTIES.map((county) => (
                      <SelectItem key={county.value} value={county.value}>
                        {county.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.facilityState"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">State</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" readOnly />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.facilityZip"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">ZIP Code</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" placeholder="85000" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.taxParcelNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Tax Parcel Number</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.dateOfInspection"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Date of Inspection</FormLabel>
                <FormControl>
                  <Input {...field} type="date" className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <Separator />

      {/* Seller / Transferor */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Seller / Transferor Information</h3>
        </div>
        <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg border bg-muted/50 p-3">
          <Checkbox
            checked={
              sellerAddress === facilityAddress &&
              sellerCity === facilityCity &&
              !!facilityAddress
            }
            onCheckedChange={(checked) => {
              if (checked) {
                form.setValue(
                  "facilityInfo.sellerAddress",
                  form.getValues("facilityInfo.facilityAddress"),
                  { shouldDirty: true },
                );
                form.setValue(
                  "facilityInfo.sellerCity",
                  form.getValues("facilityInfo.facilityCity"),
                  { shouldDirty: true },
                );
                form.setValue(
                  "facilityInfo.sellerState",
                  form.getValues("facilityInfo.facilityState") || "AZ",
                  { shouldDirty: true },
                );
                form.setValue(
                  "facilityInfo.sellerZip",
                  form.getValues("facilityInfo.facilityZip"),
                  { shouldDirty: true },
                );
              } else {
                form.setValue("facilityInfo.sellerAddress", "", { shouldDirty: true });
                form.setValue("facilityInfo.sellerCity", "", { shouldDirty: true });
                form.setValue("facilityInfo.sellerState", "", { shouldDirty: true });
                form.setValue("facilityInfo.sellerZip", "", { shouldDirty: true });
              }
            }}
          />
          <span className="text-base">Same as facility address</span>
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="facilityInfo.sellerName"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel className="text-base">Name</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.sellerAddress"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel className="text-base">Address</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.sellerCity"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">City</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.sellerState"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">State</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.sellerZip"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">ZIP Code</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <Separator />

      {/* Facility Details */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Facility Details</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="facilityInfo.waterSource"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Domestic Water Source</FormLabel>
                <FormControl>
                  <ButtonGroup
                    options={WATER_SOURCES}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.wellDistance"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Well Distance (ft)</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" placeholder="Distance in feet" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.wastewaterSource"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Wastewater Source</FormLabel>
                <FormControl>
                  <ButtonGroup
                    options={WASTEWATER_SOURCES}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.occupancyType"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Occupancy / Use</FormLabel>
                <FormControl>
                  <ButtonGroup
                    options={OCCUPANCY_TYPES}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.facilityType"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Facility Type</FormLabel>
                <FormControl>
                  <ButtonGroup
                    options={FACILITY_TYPES}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {facilityType === "other" && (
            <div className="border-l-2 border-primary/20 pl-4">
              <FormField
                control={form.control}
                name="facilityInfo.facilityTypeOther"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Facility Type (Other)</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" placeholder="If Other, specify" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          <FormField
            control={form.control}
            name="facilityInfo.isCesspool"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Cesspool?</FormLabel>
                <FormControl>
                  <ButtonGroup
                    options={[
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                    ]}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <Separator />

      {/* Summary of Inspection -- System Types */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Summary of Inspection</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 space-y-3">
            <FormLabel className="text-base">System Type</FormLabel>
            {FACILITY_SYSTEM_TYPES.map((type) => (
              <FormField
                key={type.value}
                control={form.control}
                name="facilityInfo.facilitySystemTypes"
                render={({ field }) => (
                  <FormItem>
                    <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg border p-3">
                      <FormControl>
                        <Checkbox
                          checked={field.value?.includes(type.value)}
                          onCheckedChange={(checked) => {
                            const current = field.value ?? [];
                            field.onChange(
                              checked
                                ? [...current, type.value]
                                : current.filter((v: string) => v !== type.value),
                            );
                          }}
                        />
                      </FormControl>
                      <span className="text-base">{type.label}</span>
                    </label>
                  </FormItem>
                )}
              />
            ))}
          </div>

          <FormField
            control={form.control}
            name="facilityInfo.numberOfSystems"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Number of Systems</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" type="number" min="0" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.facilityAge"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Estimated Age of System</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" placeholder="e.g. 15 years" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.facilityAgeEstimateExplanation"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel className="text-base">Age Estimate Basis</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="min-h-[48px]"
                    placeholder="How was the age estimated?"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Separator />

        <h4 className="text-base font-medium">Overall Condition Ratings</h4>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(
            [
              { name: "facilityInfo.septicTankCondition" as const, label: "Septic Tank" },
              { name: "facilityInfo.disposalWorksCondition" as const, label: "Disposal Works" },
              {
                name: "facilityInfo.alternativeSystemCondition" as const,
                label: "Alternative System",
              },
              {
                name: "facilityInfo.alternativeDisposalCondition" as const,
                label: "Alternative Disposal",
              },
            ] as const
          ).map((item) => (
            <FormField
              key={item.name}
              control={form.control}
              name={item.name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">{item.label}</FormLabel>
                  <FormControl>
                    <ButtonGroup
                      options={CONDITION_OPTIONS}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </div>
      </section>

      <Separator />

      {/* Inspector Credentials */}
      <section className="space-y-4">
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center justify-between">
            <div className="text-left">
              <h3 className="text-lg font-medium">Inspector Credentials</h3>
              <p className="text-sm text-muted-foreground">Pre-filled from company defaults. Edit if needed.</p>
            </div>
            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="facilityInfo.inspectorName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Inspector / Certifier</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px] bg-muted" readOnly tabIndex={-1} />
                    </FormControl>
                    <FormDescription>Company certifier — not editable</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="facilityInfo.employeeName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Field Technician</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        className="min-h-[48px]"
                        placeholder="Tech performing inspection"
                      />
                    </FormControl>
                    <FormDescription>Will be auto-filled from Workiz</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="facilityInfo.company"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Company</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="facilityInfo.companyAddress"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel className="text-base">Company Address</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="facilityInfo.companyCity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Company City</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="facilityInfo.companyState"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Company State</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="facilityInfo.companyZip"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Company ZIP</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="facilityInfo.certificationNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Certification #</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="facilityInfo.registrationNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Registration #</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="facilityInfo.truckNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Truck #</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>

      <Separator />

      {/* Inspector Qualifications */}
      <section className="space-y-4">
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center justify-between">
            <h3 className="text-lg font-medium">Inspector Qualifications</h3>
            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
        <div className="space-y-3">
          {/* ADEQ Course */}
          <FormField
            control={form.control}
            name="facilityInfo.hasAdeqCourse"
            render={({ field }) => (
              <FormItem>
                <label className="flex min-h-[56px] cursor-pointer items-center justify-between gap-3 rounded-lg border p-4">
                  <span className="text-base">Completed ADEQ-Approved Course</span>
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </label>
              </FormItem>
            )}
          />

          {hasAdeqCourse && (
            <div className="grid grid-cols-1 gap-4 border-l-2 border-primary/20 pl-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="facilityInfo.adeqCourseDetails"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Course Details</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="facilityInfo.adeqCourseDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Course Date</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          {/* Professional Engineer */}
          <FormField
            control={form.control}
            name="facilityInfo.isProfessionalEngineer"
            render={({ field }) => (
              <FormItem>
                <label className="flex min-h-[56px] cursor-pointer items-center justify-between gap-3 rounded-lg border p-4">
                  <span className="text-base">Professional Engineer</span>
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </label>
              </FormItem>
            )}
          />

          {isProfessionalEngineer && (
            <div className="border-l-2 border-primary/20 pl-4">
              <FormField
                control={form.control}
                name="facilityInfo.peExpirationDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">PE Expiration Date</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          {/* Registered Sanitarian */}
          <FormField
            control={form.control}
            name="facilityInfo.isRegisteredSanitarian"
            render={({ field }) => (
              <FormItem>
                <label className="flex min-h-[56px] cursor-pointer items-center justify-between gap-3 rounded-lg border p-4">
                  <span className="text-base">Registered Sanitarian</span>
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </label>
              </FormItem>
            )}
          />

          {isRegisteredSanitarian && (
            <div className="border-l-2 border-primary/20 pl-4">
              <FormField
                control={form.control}
                name="facilityInfo.rsExpirationDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">RS Expiration Date</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          {/* Wastewater Operator */}
          <FormField
            control={form.control}
            name="facilityInfo.isWastewaterOperator"
            render={({ field }) => (
              <FormItem>
                <label className="flex min-h-[56px] cursor-pointer items-center justify-between gap-3 rounded-lg border p-4">
                  <span className="text-base">Wastewater Treatment Plant Operator</span>
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </label>
              </FormItem>
            )}
          />

          {isWastewaterOperator && (
            <div className="border-l-2 border-primary/20 pl-4">
              <FormField
                control={form.control}
                name="facilityInfo.operatorGrade"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Grade</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          {/* Licensed Contractor */}
          <FormField
            control={form.control}
            name="facilityInfo.isLicensedContractor"
            render={({ field }) => (
              <FormItem>
                <label className="flex min-h-[56px] cursor-pointer items-center justify-between gap-3 rounded-lg border p-4">
                  <span className="text-base">Licensed Contractor (A, B, K-37, CR-37)</span>
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </label>
              </FormItem>
            )}
          />

          {isLicensedContractor && (
            <div className="border-l-2 border-primary/20 pl-4">
              <FormField
                control={form.control}
                name="facilityInfo.contractorLicenseCategory"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">License Category</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          {/* Pumper Truck */}
          <FormField
            control={form.control}
            name="facilityInfo.hasPumperTruck"
            render={({ field }) => (
              <FormItem>
                <label className="flex min-h-[56px] cursor-pointer items-center justify-between gap-3 rounded-lg border p-4">
                  <span className="text-base">Pumper Truck</span>
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </label>
              </FormItem>
            )}
          />

          {hasPumperTruck && (
            <div className="border-l-2 border-primary/20 pl-4">
              <FormField
                control={form.control}
                name="facilityInfo.pumperTruckRegistration"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Registration #</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}
        </div>
          </CollapsibleContent>
        </Collapsible>
      </section>

      <Separator />

      {/* Records Obtained */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Records Obtained by Inspector</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="facilityInfo.recordsAvailable"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel className="text-base">Records Available?</FormLabel>
                <FormControl>
                  <ButtonGroup
                    options={[
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                    ]}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="space-y-3">
          <FormField
            control={form.control}
            name="facilityInfo.hasDischargeAuth"
            render={({ field }) => (
              <FormItem>
                <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg border p-3">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <span className="text-base">Authorization to Discharge / Permit No.</span>
                </label>
              </FormItem>
            )}
          />

          {hasDischargeAuth && (
            <div className="border-l-2 border-primary/20 pl-4">
              <FormField
                control={form.control}
                name="facilityInfo.dischargeAuthPermitNo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Permit Number</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          <FormField
            control={form.control}
            name="facilityInfo.hasApprovalOfConstruction"
            render={({ field }) => (
              <FormItem>
                <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg border p-3">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <span className="text-base">Approval of Construction</span>
                </label>
              </FormItem>
            )}
          />

          {hasApprovalOfConstruction && (
            <div className="border-l-2 border-primary/20 pl-4">
              <FormField
                control={form.control}
                name="facilityInfo.approvalPermitNo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Permit Number</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          <FormField
            control={form.control}
            name="facilityInfo.hasSitePlan"
            render={({ field }) => (
              <FormItem>
                <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg border p-3">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <span className="text-base">Site Plan / As-Built Drawings</span>
                </label>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.hasOperationDocs"
            render={({ field }) => (
              <FormItem>
                <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg border p-3">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <span className="text-base">Operation & Maintenance Documentation</span>
                </label>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="facilityInfo.hasOtherRecords"
            render={({ field }) => (
              <FormItem>
                <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg border p-3">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <span className="text-base">Other Records</span>
                </label>
              </FormItem>
            )}
          />

          {hasOtherRecords && (
            <div className="border-l-2 border-primary/20 pl-4">
              <FormField
                control={form.control}
                name="facilityInfo.otherRecordsDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Description</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        className="min-h-[48px]"
                        placeholder="Describe other records"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}
        </div>
      </section>

      <Separator className="my-6" />

      {/* Per-section photo attachment */}
      <div className="space-y-4">
        <h3 className="text-base font-medium">Photos</h3>
        <MediaGallery
          inspectionId={inspectionId}
          section={SECTION_NAME}
          media={media.filter((m) => m.label === SECTION_NAME && m.type === "photo")}
          onDelete={handleDeleteMedia}
          onLabelUpdate={handleLabelUpdate}
          onDescriptionUpdate={handleDescriptionUpdate}
        />
        <PhotoCapture
          inspectionId={inspectionId}
          section={SECTION_NAME}
          onUploadComplete={(newMedia) => setMedia((prev) => [...prev, newMedia])}
        />
      </div>
    </div>
  );
}
