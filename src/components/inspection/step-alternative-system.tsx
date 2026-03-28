"use client";

import { useFormContext, useWatch } from "react-hook-form";
import { ButtonGroup } from "@/components/ui/button-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  ALT_DISPOSAL_TYPES,
  ALT_DISTRIBUTION_METHODS,
  ALT_SUPPLY_LINE_MATERIALS,
  CONDITION_OPTIONS,
} from "@/lib/constants/inspection";
import type { InspectionFormData } from "@/types/inspection";

const YES_NO_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const YES_NO_NA_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "na", label: "N/A" },
];

const ALT_DEFICIENCY_ITEMS = [
  { field: "altDefCrushedOutletPipe" as const, label: "Crushed Outlet Pipe" },
  { field: "altDefRootInvasion" as const, label: "Root Invasion" },
  { field: "altDefHighWaterLines" as const, label: "High Water Lines" },
  { field: "altDefDboxNotFunctioning" as const, label: "D-box Not Functioning" },
  { field: "altDefSurfacing" as const, label: "Surfacing" },
  { field: "altDefLushVegetation" as const, label: "Lush Vegetation" },
  { field: "altDefErosion" as const, label: "Erosion" },
  { field: "altDefPondingWater" as const, label: "Ponding Water" },
  { field: "altDefAnimalIntrusion" as const, label: "Animal Intrusion" },
  { field: "altDefLoadTestFailure" as const, label: "Load Test Failure" },
  { field: "altDefOtherProblems" as const, label: "Other Problems" },
  { field: "altDefCouldNotDetermine" as const, label: "Could Not Determine" },
];

const PUMP_CHECKLIST_ITEMS = [
  { field: "pumpOperating" as const, label: "Is pump operating properly?" },
  { field: "highLevelAlarm" as const, label: "High Level Alarm works?" },
  { field: "alarmsSeparateCircuits" as const, label: "Alarms and pumps on separate circuits?" },
  { field: "wiringProtected" as const, label: "Is pump wiring protected?" },
  { field: "audibleVisualAlarm" as const, label: "Both audible and visual alarm present?" },
  { field: "pumpCycleDesigned" as const, label: "Pump cycle operating as designed?" },
  { field: "riserToGrade" as const, label: "Is there a riser to grade with secure lid?" },
  { field: "tankWatertight" as const, label: "Is tank watertight and structurally sound?" },
  { field: "checkValveVent" as const, label: "Is there a check valve & purge/vent hole?" },
] as const;

interface StepAlternativeSystemProps {
  inspectionId: string;
}

export function StepAlternativeSystem({ inspectionId: _inspectionId }: StepAlternativeSystemProps) {
  const form = useFormContext<InspectionFormData>();

  const pumpSystems = useWatch({ control: form.control, name: "alternativeSystem.pumpSystems" });
  const portsPresent = useWatch({ control: form.control, name: "alternativeSystem.altInspectionPortsPresent" });
  const numberOfPorts = useWatch({ control: form.control, name: "alternativeSystem.altNumberOfPorts" });
  const portCount = Math.min(Math.max(Number.parseInt(numberOfPorts || "0", 10) || 0, 0), 8);
  const altDistMethods = useWatch({ control: form.control, name: "alternativeSystem.altDistributionMethods" });
  const altSupplyMaterials = useWatch({ control: form.control, name: "alternativeSystem.altSupplyLineMaterials" });
  const altDisposalTypes = useWatch({ control: form.control, name: "alternativeSystem.altDisposalTypes" });
  const altDistCompInspected = useWatch({ control: form.control, name: "alternativeSystem.altDistCompInspected" });
  const altHasDeficiency = useWatch({ control: form.control, name: "alternativeSystem.altHasDeficiency" });
  const altDefOtherProblems = useWatch({ control: form.control, name: "alternativeSystem.altDefOtherProblems" });
  const altDefCouldNotDetermine = useWatch({ control: form.control, name: "alternativeSystem.altDefCouldNotDetermine" });

  return (
    <div className="space-y-6">

      {/* ------------------------------------------------------------------ */}
      {/* Section 5: Alternative System Info                                  */}
      {/* ------------------------------------------------------------------ */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Section 5 — Alternative System</h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="alternativeSystem.qualifiedInspector"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel className="text-base">Qualified Inspector</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="alternativeSystem.manufacturer"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Name of Manufacturer</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="alternativeSystem.modelCapacity"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Model / Capacity</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} className="min-h-[48px]" placeholder="e.g. AeroFlo 500 GPD" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="alternativeSystem.treatmentEquipmentType"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel className="text-base">Type of Treatment Equipment Present</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="alternativeSystem.aeratorWorking"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Aerator is working properly?</FormLabel>
              <FormControl>
                <ButtonGroup
                  options={YES_NO_NA_OPTIONS}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="alternativeSystem.systemMaintained"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">System appears to have been properly maintained?</FormLabel>
              <FormControl>
                <ButtonGroup
                  options={YES_NO_OPTIONS}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </section>

      <Separator />

      {/* ------------------------------------------------------------------ */}
      {/* Pump Systems                                                         */}
      {/* ------------------------------------------------------------------ */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Pump Systems</h3>

        <FormField
          control={form.control}
          name="alternativeSystem.pumpSystems"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Pump Systems present?</FormLabel>
              <FormControl>
                <ButtonGroup
                  options={YES_NO_OPTIONS}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {pumpSystems === "yes" && (
          <div className="space-y-2">
            <FormDescription>Tap each row to toggle Yes / No.</FormDescription>
            {PUMP_CHECKLIST_ITEMS.map((item) => (
              <FormField
                key={item.field}
                control={form.control}
                name={`alternativeSystem.${item.field}`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">{item.label}</FormLabel>
                    <FormControl>
                      <ButtonGroup
                        options={YES_NO_OPTIONS}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          </div>
        )}
      </section>

      <Separator />

      {/* Inspector Comments */}
      <FormField
        control={form.control}
        name="alternativeSystem.altSystemComments"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-base">Inspector Comments (Section 5)</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                value={field.value ?? ""}
                rows={4}
                className="min-h-[48px]"
                placeholder="Observations and findings for the alternative system"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <Separator />

      {/* ------------------------------------------------------------------ */}
      {/* Section 5.1: Alternative System Disposal Works                      */}
      {/* ------------------------------------------------------------------ */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Section 5.1 — Alternative System Disposal Works</h3>

        <FormField
          control={form.control}
          name="alternativeSystem.altDisposalLocationDetermined"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Was the location of the disposal works determined?</FormLabel>
              <FormControl>
                <ButtonGroup
                  options={YES_NO_OPTIONS}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {form.watch("alternativeSystem.altDisposalLocationDetermined") === "no" && (
          <FormField
            control={form.control}
            name="alternativeSystem.altDisposalLocationExplanation"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Explanation</FormLabel>
                <FormControl>
                  <Textarea {...field} value={field.value ?? ""} rows={2} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </section>

      {/* Disposal Works Type */}
      <section className="space-y-3">
        <h4 className="text-base font-medium">Disposal Works Type</h4>
        <FormDescription>Select all that apply.</FormDescription>
        <div className="space-y-2">
          {ALT_DISPOSAL_TYPES.map((opt) => (
            <label
              key={opt.value}
              className="flex min-h-[56px] cursor-pointer items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent/50"
            >
              <span className="text-base font-medium">{opt.label}</span>
              <Checkbox
                checked={(altDisposalTypes ?? []).includes(opt.value)}
                onCheckedChange={(checked) => {
                  const current = form.getValues("alternativeSystem.altDisposalTypes") ?? [];
                  form.setValue(
                    "alternativeSystem.altDisposalTypes",
                    checked ? [...current, opt.value] : current.filter((v) => v !== opt.value),
                    { shouldDirty: true },
                  );
                }}
              />
            </label>
          ))}
        </div>
      </section>

      {/* Distribution Method */}
      <section className="space-y-3">
        <h4 className="text-base font-medium">Method of Distribution</h4>
        <FormDescription>Select all that apply.</FormDescription>
        <div className="space-y-2">
          {ALT_DISTRIBUTION_METHODS.map((opt) => (
            <label
              key={opt.value}
              className="flex min-h-[56px] cursor-pointer items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent/50"
            >
              <span className="text-base font-medium">{opt.label}</span>
              <Checkbox
                checked={(altDistMethods ?? []).includes(opt.value)}
                onCheckedChange={(checked) => {
                  const current = form.getValues("alternativeSystem.altDistributionMethods") ?? [];
                  form.setValue(
                    "alternativeSystem.altDistributionMethods",
                    checked ? [...current, opt.value] : current.filter((v) => v !== opt.value),
                    { shouldDirty: true },
                  );
                }}
              />
            </label>
          ))}
        </div>
      </section>

      {/* Distribution Component Inspection */}
      <section className="space-y-4">
        <FormField
          control={form.control}
          name="alternativeSystem.altDistCompInspected"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Was the distribution component inspected?</FormLabel>
              <FormControl>
                <ButtonGroup
                  options={YES_NO_OPTIONS}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {altDistCompInspected === "yes" && (
          <FormField
            control={form.control}
            name="alternativeSystem.altDistCompYesDescription"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Description of inspection method</FormLabel>
                <FormControl>
                  <Textarea {...field} value={field.value ?? ""} rows={2} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {altDistCompInspected === "no" && (
          <FormField
            control={form.control}
            name="alternativeSystem.altDistCompNoExplanation"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Explanation</FormLabel>
                <FormControl>
                  <Textarea {...field} value={field.value ?? ""} rows={2} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="alternativeSystem.altOperationalStatus"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Operational status of component</FormLabel>
              <FormControl>
                <ButtonGroup
                  options={[
                    ...CONDITION_OPTIONS,
                    { value: "could_not_determine", label: "Could Not Determine" },
                  ]}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {form.watch("alternativeSystem.altOperationalStatus") === "could_not_determine" && (
          <FormField
            control={form.control}
            name="alternativeSystem.altOperationalStatusExplanation"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Explanation</FormLabel>
                <FormControl>
                  <Textarea {...field} value={field.value ?? ""} rows={2} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </section>

      {/* Supply Line Material */}
      <section className="space-y-3">
        <h4 className="text-base font-medium">Supply Line Material</h4>
        <FormDescription>Select all that apply.</FormDescription>
        <div className="space-y-2">
          {ALT_SUPPLY_LINE_MATERIALS.map((opt) => (
            <label
              key={opt.value}
              className="flex min-h-[56px] cursor-pointer items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent/50"
            >
              <span className="text-base font-medium">{opt.label}</span>
              <Checkbox
                checked={(altSupplyMaterials ?? []).includes(opt.value)}
                onCheckedChange={(checked) => {
                  const current = form.getValues("alternativeSystem.altSupplyLineMaterials") ?? [];
                  form.setValue(
                    "alternativeSystem.altSupplyLineMaterials",
                    checked ? [...current, opt.value] : current.filter((v) => v !== opt.value),
                    { shouldDirty: true },
                  );
                }}
              />
            </label>
          ))}
        </div>

        {(altSupplyMaterials ?? []).includes("other") && (
          <FormField
            control={form.control}
            name="alternativeSystem.altSupplyLineOtherDescription"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Specify Other</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </section>

      <Separator />

      {/* Inspection Ports */}
      <section className="space-y-4">
        <h4 className="text-base font-medium">Inspection Ports</h4>

        <FormField
          control={form.control}
          name="alternativeSystem.altInspectionPortsPresent"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Were inspection ports present?</FormLabel>
              <FormControl>
                <ButtonGroup
                  options={[
                    { value: "present", label: "Present" },
                    { value: "not_present", label: "Not Present" },
                  ]}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {portsPresent === "present" && (
          <>
            <FormField
              control={form.control}
              name="alternativeSystem.altNumberOfPorts"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Number of Ports</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      type="number"
                      min="1"
                      max="8"
                      className="min-h-[48px] w-32"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {portCount > 0 && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {Array.from({ length: portCount }, (_, i) => (
                  <FormField
                    key={`altPortDepth-${i}`}
                    control={form.control}
                    name={`alternativeSystem.altPortDepths.${i}` as const}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base">Port {i + 1} Depth</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value ?? ""}
                            className="min-h-[48px]"
                            placeholder='e.g. 12"'
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* Operational Test */}
      <FormField
        control={form.control}
        name="alternativeSystem.altOperationalTest"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-base">Was an operational (water loading) test performed?</FormLabel>
            <FormControl>
              <ButtonGroup
                options={YES_NO_OPTIONS}
                value={field.value ?? ""}
                onChange={field.onChange}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {form.watch("alternativeSystem.altOperationalTest") === "no" && (
        <FormField
          control={form.control}
          name="alternativeSystem.altOperationalTestExplanation"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Explanation</FormLabel>
              <FormControl>
                <Textarea {...field} value={field.value ?? ""} rows={2} className="min-h-[48px]" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <Separator />

      {/* Deficiencies */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Disposal Works Deficiencies</h3>

        <FormField
          control={form.control}
          name="alternativeSystem.altHasDeficiency"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Was there evidence of a disposal works deficiency?</FormLabel>
              <FormControl>
                <ButtonGroup
                  options={YES_NO_OPTIONS}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {altHasDeficiency === "yes" && (
          <>
            <FormDescription>Check all applicable deficiencies observed.</FormDescription>
            <div className="space-y-2">
              {ALT_DEFICIENCY_ITEMS.map((item) => (
                <FormField
                  key={item.field}
                  control={form.control}
                  name={`alternativeSystem.${item.field}`}
                  render={({ field }) => (
                    <FormItem>
                      <label className="flex min-h-[56px] cursor-pointer items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent/50">
                        <span className="text-base font-medium">{item.label}</span>
                        <FormControl>
                          <Checkbox checked={field.value as boolean} onCheckedChange={field.onChange} />
                        </FormControl>
                      </label>
                    </FormItem>
                  )}
                />
              ))}
            </div>

            {altDefOtherProblems && (
              <FormField
                control={form.control}
                name="alternativeSystem.altDefOtherProblemsDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Describe other problems</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value ?? ""} rows={2} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {altDefCouldNotDetermine && (
              <FormField
                control={form.control}
                name="alternativeSystem.altDefCouldNotDetermineExplanation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Explanation (could not determine)</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value ?? ""} rows={2} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </>
        )}
      </section>

      <Separator />

      {/* Repairs & Condition */}
      <section className="space-y-4">
        <FormField
          control={form.control}
          name="alternativeSystem.altRepairs"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Were repairs or maintenance done as part of this inspection?</FormLabel>
              <FormControl>
                <ButtonGroup
                  options={YES_NO_OPTIONS}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="alternativeSystem.altDisposalCondition"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Physical and operational condition of disposal works</FormLabel>
              <FormControl>
                <ButtonGroup
                  options={CONDITION_OPTIONS}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </section>

      <Separator />

      {/* Comments */}
      <FormField
        control={form.control}
        name="alternativeSystem.altDisposalComments"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-base">Inspector Comments (Section 5.1)</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                value={field.value ?? ""}
                rows={4}
                className="min-h-[48px]"
                placeholder="Process description and other inspector comments"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <Separator />

      {/* Contact Block */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Alternative System Inspector</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="alternativeSystem.orgResponsible"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel className="text-base">Organization Responsible for Completing Inspection</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="alternativeSystem.contactName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Contact Name</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="alternativeSystem.contactPhone"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Phone</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} type="tel" className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="alternativeSystem.contactEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Email</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} type="email" className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="alternativeSystem.altPrintedName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Printed Name</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormDescription>
          Date will be auto-filled when the report is finalized.
        </FormDescription>
      </section>
    </div>
  );
}
