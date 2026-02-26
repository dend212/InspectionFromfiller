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
import { Textarea } from "@/components/ui/textarea";
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
  DISPOSAL_TYPES,
  DISTRIBUTION_METHODS,
  SUPPLY_LINE_MATERIALS,
} from "@/lib/constants/inspection";
import type { InspectionFormData } from "@/types/inspection";

/** Disposal works deficiency items matching the schema boolean fields */
const DISPOSAL_DEFICIENCY_ITEMS = [
  { field: "defCrushedOutletPipe" as const, label: "Crushed Outlet Pipe" },
  { field: "defRootInvasion" as const, label: "Root Invasion" },
  { field: "defHighWaterLines" as const, label: "High Water Lines" },
  { field: "defDboxNotFunctioning" as const, label: "D-box Not Functioning" },
  { field: "defSurfacing" as const, label: "Surfacing" },
  { field: "defLushVegetation" as const, label: "Lush Vegetation" },
  { field: "defErosion" as const, label: "Erosion" },
  { field: "defPondingWater" as const, label: "Ponding Water" },
  { field: "defAnimalIntrusion" as const, label: "Animal Intrusion" },
  { field: "defLoadTestFailure" as const, label: "Load Test Failure" },
  { field: "defCouldNotDetermine" as const, label: "Could Not Determine" },
];

export function StepDisposalWorks() {
  const form = useFormContext<InspectionFormData>();

  return (
    <div className="space-y-8">
      {/* Disposal Works Location */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Disposal Works Location</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="disposalWorks.disposalWorksLocationDetermined"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Location Determined?</FormLabel>
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

          <FormField
            control={form.control}
            name="disposalWorks.disposalWorksLocationNotDeterminedReason"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">If No, Reason</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" placeholder="Why location could not be determined" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <Separator />

      {/* Disposal Type & Distribution */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Type & Distribution</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="disposalWorks.disposalType"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Disposal Type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="min-h-[48px] w-full">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {DISPOSAL_TYPES.map((t) => (
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
            name="disposalWorks.disposalTypeOther"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Disposal Type (Other)</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" placeholder="If Other, specify" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="disposalWorks.distributionMethod"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Distribution Method</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="min-h-[48px] w-full">
                      <SelectValue placeholder="Select method" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {DISTRIBUTION_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
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
            name="disposalWorks.supplyLineMaterial"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Supply Line Material</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="min-h-[48px] w-full">
                      <SelectValue placeholder="Select material" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {SUPPLY_LINE_MATERIALS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
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
            name="disposalWorks.supplyLineMaterialOther"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Supply Line (Other)</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" placeholder="If Other, specify" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="disposalWorks.distributionComponentInspected"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Distribution Component Inspected?</FormLabel>
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

      {/* Inspection Ports */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Inspection Ports</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="disposalWorks.inspectionPortsPresent"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Inspection Ports Present?</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="min-h-[48px] w-full">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="present">Present</SelectItem>
                    <SelectItem value="not_present">Not Present</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="disposalWorks.numberOfPorts"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Number of Ports</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" type="number" min="0" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="disposalWorks.hydraulicLoadTestPerformed"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Hydraulic Load Test Performed?</FormLabel>
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

      {/* Deficiencies -- Large tap-friendly toggle rows */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Disposal Works Deficiencies</h3>

        <FormField
          control={form.control}
          name="disposalWorks.hasDisposalDeficiency"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Deficiencies Found?</FormLabel>
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

        <FormDescription>
          Tap each row to toggle deficiency found during inspection.
        </FormDescription>
        <div className="space-y-2">
          {DISPOSAL_DEFICIENCY_ITEMS.map((item) => (
            <FormField
              key={item.field}
              control={form.control}
              name={`disposalWorks.${item.field}`}
              render={({ field }) => (
                <FormItem>
                  <label className="flex min-h-[56px] cursor-pointer items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent/50">
                    <span className="text-base font-medium">{item.label}</span>
                    <FormControl>
                      <Checkbox
                        checked={field.value as boolean}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </label>
                </FormItem>
              )}
            />
          ))}
        </div>
      </section>

      <Separator />

      {/* Repairs Recommended */}
      <section className="space-y-4">
        <FormField
          control={form.control}
          name="disposalWorks.repairsRecommended"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Repairs Recommended?</FormLabel>
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
      </section>

      <Separator />

      {/* Inspector Comments & Summary */}
      <section className="space-y-6">
        <h3 className="text-lg font-medium">Inspector Summary & Recommendations</h3>

        <FormField
          control={form.control}
          name="disposalWorks.disposalWorksComments"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Comments & Findings</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={6}
                  className="min-h-[48px]"
                  placeholder="Detailed findings, observations, and recommendations for the disposal works inspection"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </section>

      <Separator />

      {/* Signature Section */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Signature</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="disposalWorks.printedName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Printed Name</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="disposalWorks.signatureDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Date</FormLabel>
                <FormControl>
                  <Input {...field} type="date" className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>
    </div>
  );
}
