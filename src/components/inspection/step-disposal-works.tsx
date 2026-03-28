"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { MediaGallery, type MediaRecord } from "@/components/inspection/media-gallery";
import { PhotoCapture } from "@/components/inspection/photo-capture";
import { VideoUpload } from "@/components/inspection/video-upload";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DISPOSAL_TYPES,
  DISTRIBUTION_METHODS,
  SUPPLY_LINE_MATERIALS,
} from "@/lib/constants/inspection";
import { AiCommentButton, CharacterCount } from "@/components/inspection/ai-comment-button";
import type { DisposalWorksContext } from "@/lib/ai/rewrite-comments";
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

const SECTION_NAME = "disposal-works";

interface StepDisposalWorksProps {
  inspectionId: string;
}

export function StepDisposalWorks({ inspectionId }: StepDisposalWorksProps) {
  const form = useFormContext<InspectionFormData>();
  const [media, setMedia] = useState<MediaRecord[]>([]);

  const portsPresent = useWatch({
    control: form.control,
    name: "disposalWorks.inspectionPortsPresent",
  });
  const numberOfPorts = useWatch({ control: form.control, name: "disposalWorks.numberOfPorts" });
  const portCount = Math.min(Math.max(Number.parseInt(numberOfPorts || "0", 10) || 0, 0), 8);

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

  const buildDisposalContext = useCallback((): DisposalWorksContext => {
    const dw = form.getValues("disposalWorks");
    const fi = form.getValues("facilityInfo");

    const deficiencies: string[] = [];
    for (const item of DISPOSAL_DEFICIENCY_ITEMS) {
      // biome-ignore lint/suspicious/noExplicitAny: dynamic field access on form data
      if ((dw as any)?.[item.field]) deficiencies.push(item.label);
    }

    // Gather port depths
    const portDepths: string[] = [];
    for (let i = 0; i < portCount; i++) {
      // biome-ignore lint/suspicious/noExplicitAny: dynamic port depth field access
      const depth = (dw as any)?.[`portDepth${i + 1}`] || "";
      if (depth) portDepths.push(depth);
    }

    return {
      disposalType: dw?.disposalType || "",
      distributionMethod: dw?.distributionMethod || "",
      supplyLineMaterial: dw?.supplyLineMaterial || "",
      locationDetermined: dw?.disposalWorksLocationDetermined || "",
      distributionComponentInspected: dw?.distributionComponentInspected || "",
      inspectionPortsPresent: dw?.inspectionPortsPresent || "",
      numberOfPorts: dw?.numberOfPorts || "",
      portDepths,
      hydraulicLoadTestPerformed: dw?.hydraulicLoadTestPerformed || "",
      hasDisposalDeficiency: dw?.hasDisposalDeficiency || "",
      repairsRecommended: dw?.repairsRecommended || "",
      deficiencies,
      overallCondition: fi?.disposalWorksCondition || "",
    };
  }, [form, portCount]);

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
            name="disposalWorks.disposalWorksLocationNotDeterminedReason"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">If No, Reason</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="min-h-[48px]"
                    placeholder="Why location could not be determined"
                  />
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
                <FormControl>
                  <ButtonGroup
                    options={SUPPLY_LINE_MATERIALS}
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
        </div>

        {/* Port Depth inputs — shown when ports are present and count > 0 */}
        {portsPresent === "present" && portCount > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: portCount }, (_, i) => (
              <FormField
                key={`portDepth-${i}`}
                control={form.control}
                name={`disposalWorks.portDepths.${i}` as const}
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

      </section>

      {/* Hydraulic Load Test */}
      <FormField
        control={form.control}
        name="disposalWorks.hydraulicLoadTestPerformed"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-base">Hydraulic Load Test Performed?</FormLabel>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ].map((opt) => {
                const isSelected = field.value === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={isSelected}
                    className={`min-h-[48px] rounded-lg px-4 py-2.5 text-base font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      isSelected
                        ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                        : "border border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground hover:border-primary/30"
                    }`}
                    onClick={() => field.onChange(isSelected ? "" : opt.value)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

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
                      <Checkbox checked={field.value as boolean} onCheckedChange={field.onChange} />
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
              <div className="flex items-center justify-between">
                <FormLabel className="text-base">Comments & Findings</FormLabel>
                <AiCommentButton
                  inspectionId={inspectionId}
                  section="disposalWorks"
                  fieldPath="disposalWorks.disposalWorksComments"
                  buildContext={buildDisposalContext}
                />
              </div>
              <FormControl>
                <Textarea
                  {...field}
                  rows={6}
                  className="min-h-[48px]"
                  placeholder="Detailed findings, observations, and recommendations for the disposal works inspection"
                />
              </FormControl>
              <CharacterCount value={field.value} />
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
          <FormDescription className="flex items-center text-sm text-muted-foreground sm:col-span-1">
            Date will be auto-filled when the report is finalized.
          </FormDescription>
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

      <Separator className="my-6" />

      {/* Video upload (general inspection attachment) */}
      <div className="space-y-4">
        <h3 className="text-base font-medium">Video</h3>
        <VideoUpload
          inspectionId={inspectionId}
          onUploadComplete={(newMedia) => setMedia((prev) => [...prev, newMedia])}
        />
        <MediaGallery
          inspectionId={inspectionId}
          media={media.filter((m) => m.type === "video")}
          onDelete={handleDeleteMedia}
          onLabelUpdate={handleLabelUpdate}
          onDescriptionUpdate={handleDescriptionUpdate}
        />
      </div>

      <Separator className="my-6" />

      {/* Alternative System Pages toggle */}
      <FormField
        control={form.control}
        name="includeAlternativePages"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-center gap-3 rounded-lg border border-dashed p-4">
              <FormControl>
                <Switch
                  checked={!!field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <div>
                <FormLabel className="text-base cursor-pointer">
                  Add Alternative System Pages
                </FormLabel>
                <FormDescription className="mt-0.5">
                  Adds Section 5 &amp; 5.1 to the report for properties with alternative/aerobic systems
                </FormDescription>
              </div>
            </div>
          </FormItem>
        )}
      />
    </div>
  );
}
