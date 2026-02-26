"use client";

import { useFormContext } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AZ_COUNTIES,
  FACILITY_TYPES,
  WATER_SOURCES,
  WASTEWATER_SOURCES,
  OCCUPANCY_TYPES,
  FACILITY_SYSTEM_TYPES,
  CONDITION_OPTIONS,
} from "@/lib/constants/inspection";
import type { InspectionFormData } from "@/types/inspection";

export function StepFacilityInfo() {
  const form = useFormContext<InspectionFormData>();

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
        <h3 className="text-lg font-medium">Seller / Transferor Information</h3>
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
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="min-h-[48px] w-full">
                      <SelectValue placeholder="Select source" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {WATER_SOURCES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
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
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="min-h-[48px] w-full">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {WASTEWATER_SOURCES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
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
            name="facilityInfo.occupancyType"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Occupancy / Use</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="min-h-[48px] w-full">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {OCCUPANCY_TYPES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
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
            name="facilityInfo.facilityType"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Facility Type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="min-h-[48px] w-full">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {FACILITY_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
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

          <FormField
            control={form.control}
            name="facilityInfo.isCesspool"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Cesspool?</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="min-h-[48px] w-full">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
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
                                : current.filter((v: string) => v !== type.value)
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
                  <Input {...field} className="min-h-[48px]" placeholder="How was the age estimated?" />
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
              { name: "facilityInfo.alternativeSystemCondition" as const, label: "Alternative System" },
              { name: "facilityInfo.alternativeDisposalCondition" as const, label: "Alternative Disposal" },
            ] as const
          ).map((item) => (
            <FormField
              key={item.name}
              control={form.control}
              name={item.name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">{item.label}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="min-h-[48px] w-full">
                        <SelectValue placeholder="Select condition" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CONDITION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
        <h3 className="text-lg font-medium">Inspector Credentials</h3>
        <FormDescription>Pre-filled from company defaults. Edit if needed.</FormDescription>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="facilityInfo.inspectorName"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel className="text-base">Inspector Name *</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" />
                </FormControl>
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
            name="facilityInfo.employeeName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Employee Name</FormLabel>
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
      </section>

      <Separator />

      {/* Inspector Qualifications */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Inspector Qualifications</h3>
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
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </label>
              </FormItem>
            )}
          />

          {form.watch("facilityInfo.hasAdeqCourse") && (
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
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </label>
              </FormItem>
            )}
          />

          {form.watch("facilityInfo.isProfessionalEngineer") && (
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
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </label>
              </FormItem>
            )}
          />

          {form.watch("facilityInfo.isRegisteredSanitarian") && (
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
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </label>
              </FormItem>
            )}
          />

          {form.watch("facilityInfo.isWastewaterOperator") && (
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
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </label>
              </FormItem>
            )}
          />

          {form.watch("facilityInfo.isLicensedContractor") && (
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
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </label>
              </FormItem>
            )}
          />

          {form.watch("facilityInfo.hasPumperTruck") && (
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
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="min-h-[48px] w-full">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
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
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <span className="text-base">Authorization to Discharge / Permit No.</span>
                </label>
              </FormItem>
            )}
          />

          {form.watch("facilityInfo.hasDischargeAuth") && (
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
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <span className="text-base">Approval of Construction</span>
                </label>
              </FormItem>
            )}
          />

          {form.watch("facilityInfo.hasApprovalOfConstruction") && (
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
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
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
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
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
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <span className="text-base">Other Records</span>
                </label>
              </FormItem>
            )}
          />

          {form.watch("facilityInfo.hasOtherRecords") && (
            <div className="border-l-2 border-primary/20 pl-4">
              <FormField
                control={form.control}
                name="facilityInfo.otherRecordsDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Description</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" placeholder="Describe other records" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
