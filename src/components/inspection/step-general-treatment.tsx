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
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GP402_SYSTEM_TYPES, CONDITION_OPTIONS } from "@/lib/constants/inspection";
import { PhotoCapture } from "@/components/inspection/photo-capture";
import { MediaGallery, type MediaRecord } from "@/components/inspection/media-gallery";
import type { InspectionFormData } from "@/types/inspection";

const SECTION_NAME = "general-treatment";

interface StepGeneralTreatmentProps {
  inspectionId: string;
}

export function StepGeneralTreatment({ inspectionId }: StepGeneralTreatmentProps) {
  const form = useFormContext<InspectionFormData>();
  const showAlternative = form.watch("generalTreatment.alternativeSystem");
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

  return (
    <div className="space-y-8">
      {/* GP 4.02+ System Type Checkboxes */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">General Treatment & Disposal Type</h3>
        <FormDescription>
          Select all system types that apply to this facility (GP 4.02 - 4.23).
        </FormDescription>

        <div className="space-y-2">
          {GP402_SYSTEM_TYPES.map((systemType) => (
            <FormField
              key={systemType.value}
              control={form.control}
              name="generalTreatment.systemTypes"
              render={({ field }) => (
                <FormItem>
                  <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg border p-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value?.includes(systemType.value)}
                        onCheckedChange={(checked) => {
                          const current = field.value ?? [];
                          field.onChange(
                            checked
                              ? [...current, systemType.value]
                              : current.filter((v: string) => v !== systemType.value)
                          );
                        }}
                      />
                    </FormControl>
                    <span className="text-base leading-snug">{systemType.label}</span>
                  </label>
                </FormItem>
              )}
            />
          ))}
        </div>
      </section>

      <Separator />

      {/* Performance Assurance Plan */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Performance Assurance Plan</h3>
        <FormField
          control={form.control}
          name="generalTreatment.hasPerformanceAssurancePlan"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Performance Assurance Plan Required?</FormLabel>
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

      {/* Alternative Treatment System Toggle (FORM-02) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="text-lg font-medium">Alternative Treatment System</h3>
            <p className="text-sm text-muted-foreground">
              Show fields for non-standard system types
            </p>
          </div>
          <FormField
            control={form.control}
            name="generalTreatment.alternativeSystem"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label="Toggle alternative treatment system fields"
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        {showAlternative && (
          <div className="space-y-4 border-l-2 border-primary/20 pl-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="generalTreatment.altSystemManufacturer"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Manufacturer</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="generalTreatment.altSystemModel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Model</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="generalTreatment.altSystemCapacity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Capacity (GPD)</FormLabel>
                    <FormControl>
                      <Input {...field} className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="generalTreatment.altSystemDateInstalled"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Date Installed</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" className="min-h-[48px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="generalTreatment.altSystemCondition"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">System Condition</FormLabel>
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
            </div>

            <FormField
              control={form.control}
              name="generalTreatment.altSystemNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Notes</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3} className="min-h-[48px]" placeholder="Additional notes about the alternative system" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}
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
