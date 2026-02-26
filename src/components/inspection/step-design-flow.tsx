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
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DESIGN_FLOW_BASIS, ACTUAL_FLOW_EVALUATION } from "@/lib/constants/inspection";
import { PhotoCapture } from "@/components/inspection/photo-capture";
import { MediaGallery, type MediaRecord } from "@/components/inspection/media-gallery";
import type { InspectionFormData } from "@/types/inspection";

const SECTION_NAME = "design-flow";

interface StepDesignFlowProps {
  inspectionId: string;
}

export function StepDesignFlow({ inspectionId }: StepDesignFlowProps) {
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

  return (
    <div className="space-y-8">
      {/* 3A: Estimated Design Flow */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Section 3A: Estimated Design Flow</h3>
        <FormField
          control={form.control}
          name="designFlow.estimatedDesignFlow"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Estimated Design Flow (GPD)</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  className="min-h-[48px]"
                  type="number"
                  min="0"
                  placeholder="Gallons per day"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </section>

      <Separator />

      {/* 3B: Basis for Design Flow */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Section 3B: Basis for Design Flow</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="designFlow.designFlowBasis"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel className="text-base">Basis for Design Flow</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="min-h-[48px] w-full">
                      <SelectValue placeholder="Select basis" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {DESIGN_FLOW_BASIS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
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
            name="designFlow.numberOfBedrooms"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Number of Bedrooms</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="min-h-[48px]"
                    type="number"
                    min="0"
                  />
                </FormControl>
                <FormDescription>
                  Standard: 150 GPD per bedroom
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="designFlow.fixtureCount"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Fixture Count</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="min-h-[48px]"
                    type="number"
                    min="0"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="designFlow.nonDwellingGpd"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Non-Dwelling GPD</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="min-h-[48px]"
                    type="number"
                    min="0"
                    placeholder="If applicable"
                  />
                </FormControl>
                <FormDescription>
                  Additional flow from non-dwelling sources
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <Separator />

      {/* 3D: Actual Flow Evaluation */}
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Section 3D: Actual Flow Evaluation</h3>
        <FormField
          control={form.control}
          name="designFlow.actualFlowEvaluation"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Actual Flow Evaluation</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="min-h-[48px] w-full">
                    <SelectValue placeholder="Select evaluation" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {ACTUAL_FLOW_EVALUATION.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
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
          name="designFlow.designFlowComments"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Comments</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={4}
                  className="min-h-[48px]"
                  placeholder="Additional comments on design flow calculations"
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
