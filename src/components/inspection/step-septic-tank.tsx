"use client";

import { useState, useEffect, useCallback } from "react";
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
  TANK_MATERIALS,
  BAFFLE_MATERIALS,
  BAFFLE_CONDITIONS,
  CAPACITY_BASIS_OPTIONS,
} from "@/lib/constants/inspection";
import { PhotoCapture } from "@/components/inspection/photo-capture";
import { MediaGallery, type MediaRecord } from "@/components/inspection/media-gallery";
import type { InspectionFormData } from "@/types/inspection";

/** Deficiency labels matching the schema boolean fields */
const TANK_DEFICIENCY_ITEMS = [
  { field: "deficiencyRootInvasion" as const, label: "Root Invasion" },
  { field: "deficiencyExposedRebar" as const, label: "Exposed Rebar" },
  { field: "deficiencyCracks" as const, label: "Cracks" },
  { field: "deficiencyDamagedInlet" as const, label: "Damaged Inlet" },
  { field: "deficiencyDamagedOutlet" as const, label: "Damaged Outlet" },
  { field: "deficiencyDamagedLids" as const, label: "Damaged Lids" },
  { field: "deficiencyDeterioratingConcrete" as const, label: "Deteriorating Concrete" },
  { field: "deficiencyOther" as const, label: "Other Deficiency" },
];

const SECTION_NAME = "septic-tank";

interface StepSepticTankProps {
  inspectionId: string;
}

export function StepSepticTank({ inspectionId }: StepSepticTankProps) {
  const form = useFormContext<InspectionFormData>();
  const [media, setMedia] = useState<MediaRecord[]>([]);

  useEffect(() => {
    async function loadMedia() {
      try {
        const res = await fetch(`/api/inspections/${inspectionId}/media`);
        if (res.ok) {
          const data = (await res.json()) as MediaRecord[];
          setMedia(data);
        }
      } catch {
        // Silently fail
      }
    }
    loadMedia();
  }, [inspectionId]);

  const handleDeleteMedia = useCallback(async (mediaId: string) => {
    await fetch(`/api/inspections/${inspectionId}/media`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId }),
    });
    setMedia((prev) => prev.filter((m) => m.id !== mediaId));
  }, [inspectionId]);
  const numberOfTanksValue = form.watch("septicTank.numberOfTanks");
  const numberOfTanks = Math.min(Math.max(Number.parseInt(numberOfTanksValue || "1", 10) || 1, 1), 3);

  // Ensure the tanks array has enough entries
  const currentTanks = form.getValues("septicTank.tanks") ?? [];
  if (currentTanks.length < numberOfTanks) {
    const newTanks = [...currentTanks];
    for (let i = currentTanks.length; i < numberOfTanks; i++) {
      newTanks.push({
        liquidLevel: "",
        primaryScumThickness: "",
        primarySludgeThickness: "",
        secondaryScumThickness: "",
        secondarySludgeThickness: "",
        liquidLevelNotDetermined: false,
        tankDimensions: "",
        tankCapacity: "",
        capacityBasis: "",
        capacityNotDeterminedReason: "",
        tankMaterial: "",
        tankMaterialOther: "",
        accessOpenings: "",
        accessOpeningsOther: "",
        lidsRisersPresent: "",
        lidsSecurelyFastened: "",
        numberOfCompartments: "",
        compartmentsOther: "",
        compromisedTank: "",
        deficiencyRootInvasion: false,
        deficiencyExposedRebar: false,
        deficiencyCracks: false,
        deficiencyDamagedInlet: false,
        deficiencyDamagedOutlet: false,
        deficiencyDamagedLids: false,
        deficiencyDeterioratingConcrete: false,
        deficiencyOther: false,
        baffleMaterial: "",
        inletBaffleCondition: "",
        outletBaffleCondition: "",
        interiorBaffleCondition: "",
        effluentFilterPresent: "",
        effluentFilterServiced: "",
      });
    }
    form.setValue("septicTank.tanks", newTanks);
  }

  return (
    <div className="space-y-8">
      {/* Section 4A: Number of Tanks & Pumping */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Section 4A: Septic Tank Overview</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="septicTank.numberOfTanks"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Number of Tanks</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" type="number" min="1" max="3" />
                </FormControl>
                <FormDescription>Maximum 3 tanks</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="septicTank.tankInspectionDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Tank Inspection Date</FormLabel>
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

      {/* Section 4C: Pumping */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Section 4C: Pumping</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="septicTank.tanksPumped"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Tanks Pumped?</FormLabel>
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
            name="septicTank.haulerCompany"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Hauler Company</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="septicTank.haulerLicense"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Hauler License #</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="septicTank.pumpingNotPerformedReason"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">If Not Pumped, Reason</FormLabel>
                <FormControl>
                  <Input {...field} className="min-h-[48px]" placeholder="Why pumping was not performed" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <Separator />

      {/* Per-Tank Inspection Data */}
      {Array.from({ length: numberOfTanks }).map((_, tankIndex) => (
        <section key={tankIndex} className="space-y-6">
          <h3 className="text-lg font-medium">
            Tank {tankIndex + 1} {numberOfTanks > 1 ? `of ${numberOfTanks}` : ""} Inspection
          </h3>

          {/* 4B: Liquid Levels */}
          <div className="space-y-4">
            <h4 className="text-base font-medium">Liquid Levels</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.liquidLevel`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Liquid Level</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" placeholder="inches from top" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.primaryScumThickness`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Primary Scum Thickness</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" placeholder="inches" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.primarySludgeThickness`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Primary Sludge Depth</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" placeholder="inches" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.secondaryScumThickness`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Secondary Scum Thickness</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" placeholder="inches" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.secondarySludgeThickness`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Secondary Sludge Depth</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" placeholder="inches" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name={`septicTank.tanks.${tankIndex}.liquidLevelNotDetermined`}
              render={({ field }) => (
                <FormItem>
                  <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg border p-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <span className="text-base">Liquid level could not be determined</span>
                  </label>
                </FormItem>
              )}
            />
          </div>

          <Separator />

          {/* 4D-E: Capacity */}
          <div className="space-y-4">
            <h4 className="text-base font-medium">Dimensions & Capacity</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.tankDimensions`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Tank Dimensions</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" placeholder="e.g. 8'L x 4'W x 5'D" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.tankCapacity`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Tank Capacity (gal)</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" type="number" min="0" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.capacityBasis`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Capacity Basis</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="min-h-[48px] w-full">
                          <SelectValue placeholder="Select basis" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CAPACITY_BASIS_OPTIONS.map((opt) => (
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

              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.capacityNotDeterminedReason`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">If Not Determined, Reason</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <Separator />

          {/* 4F: Material */}
          <div className="space-y-4">
            <h4 className="text-base font-medium">Material & Access</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.tankMaterial`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Tank Material</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="min-h-[48px] w-full">
                          <SelectValue placeholder="Select material" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TANK_MATERIALS.map((mat) => (
                          <SelectItem key={mat.value} value={mat.value}>
                            {mat.label}
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
                name={`septicTank.tanks.${tankIndex}.tankMaterialOther`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Material (Other)</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" placeholder="If Other, specify" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.accessOpenings`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Access Openings</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" placeholder="Number and type" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.accessOpeningsOther`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Access Other</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <Separator />

          {/* 4H: Lids/Risers */}
          <div className="space-y-4">
            <h4 className="text-base font-medium">Lids & Risers</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.lidsRisersPresent`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Lids/Risers Present?</FormLabel>
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
                name={`septicTank.tanks.${tankIndex}.lidsSecurelyFastened`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Lids Securely Fastened?</FormLabel>
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
          </div>

          <Separator />

          {/* 4I: Compartments & 4J: Compromised Tank */}
          <div className="space-y-4">
            <h4 className="text-base font-medium">Compartments</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.numberOfCompartments`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Number of Compartments</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" type="number" min="0" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.compartmentsOther`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Compartments Notes</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.compromisedTank`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Compromised Tank?</FormLabel>
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
          </div>

          <Separator />

          {/* 4K: Deficiencies -- Large tap-friendly toggle rows */}
          <div className="space-y-4">
            <h4 className="text-base font-medium">Section 4K: Tank Deficiencies</h4>
            <FormDescription>
              Tap each row to toggle deficiency found during inspection.
            </FormDescription>
            <div className="space-y-2">
              {TANK_DEFICIENCY_ITEMS.map((item) => (
                <FormField
                  key={item.field}
                  control={form.control}
                  name={`septicTank.tanks.${tankIndex}.${item.field}`}
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
          </div>

          <Separator />

          {/* 4L: Baffles */}
          <div className="space-y-4">
            <h4 className="text-base font-medium">Section 4L: Baffles / Sanitary Tees</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.baffleMaterial`}
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel className="text-base">Baffle Material</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="min-h-[48px] w-full">
                          <SelectValue placeholder="Select material" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {BAFFLE_MATERIALS.map((mat) => (
                          <SelectItem key={mat.value} value={mat.value}>
                            {mat.label}
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
                name={`septicTank.tanks.${tankIndex}.inletBaffleCondition`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Inlet Baffle</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="min-h-[48px] w-full">
                          <SelectValue placeholder="Condition" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {BAFFLE_CONDITIONS.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
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
                name={`septicTank.tanks.${tankIndex}.outletBaffleCondition`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Outlet Baffle</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="min-h-[48px] w-full">
                          <SelectValue placeholder="Condition" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {BAFFLE_CONDITIONS.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
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
                name={`septicTank.tanks.${tankIndex}.interiorBaffleCondition`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Interior Baffle</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="min-h-[48px] w-full">
                          <SelectValue placeholder="Condition" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {BAFFLE_CONDITIONS.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <Separator />

          {/* 4M: Effluent Filter */}
          <div className="space-y-4">
            <h4 className="text-base font-medium">Section 4M: Effluent Filter</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.effluentFilterPresent`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Effluent Filter Present?</FormLabel>
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
                name={`septicTank.tanks.${tankIndex}.effluentFilterServiced`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Filter Serviced?</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="min-h-[48px] w-full">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="serviced">Serviced</SelectItem>
                        <SelectItem value="not_serviced">Not Serviced</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          {tankIndex < numberOfTanks - 1 && (
            <Separator className="my-8 border-2" />
          )}
        </section>
      ))}

      <Separator />

      {/* Inspector Comments */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Inspector Comments (Section 4)</h3>
        <FormField
          control={form.control}
          name="septicTank.septicTankComments"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Comments</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={4}
                  className="min-h-[48px]"
                  placeholder="Additional comments about the septic tank inspection"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
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
