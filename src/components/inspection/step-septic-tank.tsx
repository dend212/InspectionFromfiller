"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { ButtonGroup } from "@/components/ui/button-group";
import { cn } from "@/lib/utils";
import { MediaGallery, type MediaRecord } from "@/components/inspection/media-gallery";
import { PhotoCapture } from "@/components/inspection/photo-capture";
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
  BAFFLE_CONDITIONS,
  BAFFLE_MATERIALS,
  CAPACITY_BASIS_OPTIONS,
  TANK_MATERIALS,
} from "@/lib/constants/inspection";
import { AiCommentButton, CharacterCount } from "@/components/inspection/ai-comment-button";
import type { SepticTankContext } from "@/lib/ai/rewrite-comments";
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

  const numberOfTanksValue = form.watch("septicTank.numberOfTanks");
  const numberOfTanks = Math.min(
    Math.max(Number.parseInt(numberOfTanksValue || "1", 10) || 1, 1),
    3,
  );

  // Sync the tanks array to match numberOfTanks (grow or shrink)
  useEffect(() => {
    const currentTanks = form.getValues("septicTank.tanks") ?? [];
    if (currentTanks.length === numberOfTanks) return;

    const emptyTank = {
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
      lidsRisersPresent: "" as "" | "present" | "not_present",
      lidsSecurelyFastened: "" as "" | "yes" | "no",
      numberOfCompartments: "",
      compartmentsOther: "",
      compromisedTank: "" as "" | "yes" | "no",
      deficiencyRootInvasion: false,
      deficiencyExposedRebar: false,
      deficiencyCracks: false,
      deficiencyDamagedInlet: false,
      deficiencyDamagedOutlet: false,
      deficiencyDamagedLids: false,
      deficiencyDeterioratingConcrete: false,
      deficiencyOther: false,
      baffleMaterial: [] as string[],
      inletBaffleCondition: [] as string[],
      outletBaffleCondition: [] as string[],
      interiorBaffleCondition: [] as string[],
      effluentFilterPresent: "" as "" | "present" | "not_present",
      effluentFilterServiced: "" as "" | "serviced" | "not_serviced",
    };

    if (currentTanks.length < numberOfTanks) {
      const newTanks = [...currentTanks];
      for (let i = currentTanks.length; i < numberOfTanks; i++) {
        newTanks.push({ ...emptyTank });
      }
      form.setValue("septicTank.tanks", newTanks);
    } else {
      // Shrink: remove extra tanks
      form.setValue("septicTank.tanks", currentTanks.slice(0, numberOfTanks));
    }
  }, [numberOfTanks, form]);

  const buildTankContext = useCallback((): SepticTankContext => {
    const st = form.getValues("septicTank");
    const fi = form.getValues("facilityInfo");
    const tanks = (st.tanks ?? []).map((tank) => {
      const deficiencies: string[] = [];
      for (const item of TANK_DEFICIENCY_ITEMS) {
        if (tank[item.field]) deficiencies.push(item.label);
      }
      return {
        tankMaterial: tank.tankMaterial || "",
        tankCapacity: tank.tankCapacity || "",
        liquidLevel: tank.liquidLevel || "",
        primaryScumThickness: tank.primaryScumThickness || "",
        primarySludgeThickness: tank.primarySludgeThickness || "",
        secondaryScumThickness: tank.secondaryScumThickness || "",
        secondarySludgeThickness: tank.secondarySludgeThickness || "",
        compromisedTank: tank.compromisedTank || "",
        numberOfCompartments: tank.numberOfCompartments || "",
        accessOpenings: tank.accessOpenings || "",
        lidsRisersPresent: tank.lidsRisersPresent || "",
        lidsSecurelyFastened: tank.lidsSecurelyFastened || "",
        baffleMaterial: tank.baffleMaterial || [],
        inletBaffleCondition: tank.inletBaffleCondition || [],
        outletBaffleCondition: tank.outletBaffleCondition || [],
        interiorBaffleCondition: tank.interiorBaffleCondition || [],
        effluentFilterPresent: tank.effluentFilterPresent || "",
        effluentFilterServiced: tank.effluentFilterServiced || "",
        deficiencies,
      };
    });

    return {
      numberOfTanks: st.numberOfTanks || "",
      tanksPumped: st.tanksPumped || "",
      haulerCompany: st.haulerCompany || "",
      tanks,
      overallCondition: fi?.septicTankCondition || "",
    };
  }, [form]);

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
                  <ButtonGroup
                    options={[
                      { value: "discharge_auth", label: "Discharge Auth (12 mo)" },
                      { value: "not_necessary", label: "Not necessary (mfr)" },
                      { value: "no_accumulation", label: "No accumulation" },
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
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
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
            <FormField
              control={form.control}
              name={`septicTank.tanks.${tankIndex}.tankCapacity`}
              render={({ field }) => {
                const TANK_CAPACITY_PRESETS = ["1000", "1250", "1500", "2000", "2500", "3000"];
                const isPreset = TANK_CAPACITY_PRESETS.includes(field.value);
                const isOther = !!field.value && !isPreset;
                return (
                  <FormItem>
                    <FormLabel className="text-base">Tank Capacity (gal)</FormLabel>
                    <FormControl>
                      <div className="space-y-2">
                        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                          {TANK_CAPACITY_PRESETS.map((size) => (
                            <button
                              key={size}
                              type="button"
                              aria-pressed={field.value === size}
                              className={cn(
                                "min-h-[48px] rounded-lg px-3 py-2.5 text-base font-medium transition-all",
                                "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                field.value === size
                                  ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                                  : "border border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground hover:border-primary/30"
                              )}
                              onClick={() => field.onChange(field.value === size ? "" : size)}
                            >
                              {Number(size).toLocaleString()}
                            </button>
                          ))}
                          <button
                            type="button"
                            aria-pressed={!!isOther}
                            className={cn(
                              "min-h-[48px] rounded-lg px-3 py-2.5 text-base font-medium transition-all",
                              "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                              isOther
                                ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                                : "border border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground hover:border-primary/30"
                            )}
                            onClick={() => {
                              if (isOther) {
                                field.onChange("");
                              } else {
                                field.onChange("other");
                              }
                            }}
                          >
                            Other
                          </button>
                        </div>
                        {isOther && (
                          <Input
                            className="min-h-[48px]"
                            type="number"
                            min="0"
                            placeholder="Enter custom capacity"
                            value={field.value === "other" ? "" : field.value}
                            onChange={(e) => field.onChange(e.target.value || "other")}
                          />
                        )}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.tankDimensions`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Tank Dimensions</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        className="min-h-[48px]"
                        placeholder="e.g. 8'L x 4'W x 5'D"
                      />
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
                    <FormControl>
                      <ButtonGroup
                        options={CAPACITY_BASIS_OPTIONS}
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
                    <FormControl>
                      <ButtonGroup
                        options={TANK_MATERIALS}
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
                      <ButtonGroup
                        options={[
                          { value: "one", label: "One" },
                          { value: "two", label: "Two" },
                          { value: "three", label: "Three+" },
                          { value: "other", label: "Other" },
                        ]}
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
                    <FormControl>
                      <ButtonGroup
                        options={[
                          { value: "present", label: "Present" },
                          { value: "not_present", label: "Not Present" },
                        ]}
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
                name={`septicTank.tanks.${tankIndex}.lidsSecurelyFastened`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Lids Securely Fastened?</FormLabel>
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
                      <ButtonGroup
                        options={[
                          { value: "one", label: "One" },
                          { value: "two", label: "Two" },
                          { value: "other", label: "Other" },
                        ]}
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

            {/* Baffle Material — checkboxes (multi-select) */}
            <FormField
              control={form.control}
              name={`septicTank.tanks.${tankIndex}.baffleMaterial`}
              render={({ field }) => {
                const selected: string[] = Array.isArray(field.value) ? field.value : [];
                const toggle = (val: string) => {
                  const next = selected.includes(val)
                    ? selected.filter((v) => v !== val)
                    : [...selected, val];
                  field.onChange(next);
                };
                return (
                  <FormItem>
                    <FormLabel className="text-base">Baffle Material</FormLabel>
                    <div className="space-y-2">
                      {BAFFLE_MATERIALS.map((mat) => (
                        <label
                          key={mat.value}
                          className="flex min-h-[48px] cursor-pointer items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent/50"
                        >
                          <span className="text-base font-medium">{mat.label}</span>
                          <Checkbox
                            checked={selected.includes(mat.value)}
                            onCheckedChange={() => toggle(mat.value)}
                          />
                        </label>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* Inlet Baffle Condition — checkboxes */}
              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.inletBaffleCondition`}
                render={({ field }) => {
                  const selected: string[] = Array.isArray(field.value) ? field.value : [];
                  const toggle = (val: string) => {
                    const next = selected.includes(val)
                      ? selected.filter((v) => v !== val)
                      : [...selected, val];
                    field.onChange(next);
                  };
                  return (
                    <FormItem>
                      <FormLabel className="text-base">Inlet Baffle</FormLabel>
                      <div className="space-y-2">
                        {BAFFLE_CONDITIONS.map((c) => (
                          <label
                            key={c.value}
                            className="flex min-h-[44px] cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent/50"
                          >
                            <span className="text-sm font-medium">{c.label}</span>
                            <Checkbox
                              checked={selected.includes(c.value)}
                              onCheckedChange={() => toggle(c.value)}
                            />
                          </label>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              {/* Outlet Baffle Condition — checkboxes */}
              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.outletBaffleCondition`}
                render={({ field }) => {
                  const selected: string[] = Array.isArray(field.value) ? field.value : [];
                  const toggle = (val: string) => {
                    const next = selected.includes(val)
                      ? selected.filter((v) => v !== val)
                      : [...selected, val];
                    field.onChange(next);
                  };
                  return (
                    <FormItem>
                      <FormLabel className="text-base">Outlet Baffle</FormLabel>
                      <div className="space-y-2">
                        {BAFFLE_CONDITIONS.map((c) => (
                          <label
                            key={c.value}
                            className="flex min-h-[44px] cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent/50"
                          >
                            <span className="text-sm font-medium">{c.label}</span>
                            <Checkbox
                              checked={selected.includes(c.value)}
                              onCheckedChange={() => toggle(c.value)}
                            />
                          </label>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              {/* Interior Baffle Condition — checkboxes */}
              <FormField
                control={form.control}
                name={`septicTank.tanks.${tankIndex}.interiorBaffleCondition`}
                render={({ field }) => {
                  const selected: string[] = Array.isArray(field.value) ? field.value : [];
                  const toggle = (val: string) => {
                    const next = selected.includes(val)
                      ? selected.filter((v) => v !== val)
                      : [...selected, val];
                    field.onChange(next);
                  };
                  return (
                    <FormItem>
                      <FormLabel className="text-base">Interior Baffle</FormLabel>
                      <div className="space-y-2">
                        {BAFFLE_CONDITIONS.map((c) => (
                          <label
                            key={c.value}
                            className="flex min-h-[44px] cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent/50"
                          >
                            <span className="text-sm font-medium">{c.label}</span>
                            <Checkbox
                              checked={selected.includes(c.value)}
                              onCheckedChange={() => toggle(c.value)}
                            />
                          </label>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  );
                }}
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
                    <FormControl>
                      <ButtonGroup
                        options={[
                          { value: "present", label: "Present" },
                          { value: "not_present", label: "Not Present" },
                        ]}
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
                name={`septicTank.tanks.${tankIndex}.effluentFilterServiced`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Filter Serviced?</FormLabel>
                    <FormControl>
                      <ButtonGroup
                        options={[
                          { value: "serviced", label: "Serviced" },
                          { value: "not_serviced", label: "Not Serviced" },
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
          </div>

          {tankIndex < numberOfTanks - 1 && <Separator className="my-8 border-2" />}
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
              <div className="flex items-center justify-between">
                <FormLabel className="text-base">Comments</FormLabel>
                <AiCommentButton
                  inspectionId={inspectionId}
                  section="septicTank"
                  fieldPath="septicTank.septicTankComments"
                  buildContext={buildTankContext}
                />
              </div>
              <FormControl>
                <Textarea
                  {...field}
                  rows={4}
                  className="min-h-[48px]"
                  placeholder="Additional comments about the septic tank inspection"
                />
              </FormControl>
              <CharacterCount value={field.value} />
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
