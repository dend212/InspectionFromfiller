"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { type FieldPath, useForm, useWatch } from "react-hook-form";
import type { MediaRecord } from "@/components/inspection/media-gallery";
import { StepAlternativeSystem } from "@/components/inspection/step-alternative-system";
import { StepDesignFlow } from "@/components/inspection/step-design-flow";
import { StepDisposalWorks } from "@/components/inspection/step-disposal-works";
import { StepFacilityInfo } from "@/components/inspection/step-facility-info";
import { StepGeneralTreatment } from "@/components/inspection/step-general-treatment";
import { StepSepticTank } from "@/components/inspection/step-septic-tank";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { useAutoSave } from "@/hooks/use-auto-save";
import { STEP_LABELS } from "@/lib/constants/inspection";
import { normalizeIncludeAlternativePages } from "@/lib/inspection-form";
import { getDefaultFormValues, inspectionFormSchema } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";
import { PhotoSelection } from "./photo-selection";
import { ReportPreview } from "./report-preview";
import { ReviewActions } from "./review-actions";
import { ReviewPill, useStepValidations } from "./review-pill";
import { ReviewSection } from "./review-section";
import { SaveStatusBar } from "./save-status-bar";

// prefill provider mounted in prefill phase 1

export interface ReviewEditorProps {
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
    isFromWorkiz: boolean;
  };
  media: MediaRecord[];
}

/** How long the jumped-to field keeps its amber ring */
const HIGHLIGHT_MS = 2000;

export function ReviewEditor({ inspection, media: initialMedia }: ReviewEditorProps) {
  const [status, setStatus] = useState(inspection.status);
  const readOnly = status === "completed" || status === "sent";

  // ── Form ────────────────────────────────────────────────────────────────────
  // Normalize so the includeAlternativePages flag stays consistent with the
  // presence of saved alt-system data round-tripping through review.
  const initialFormValues =
    normalizeIncludeAlternativePages(inspection.formData) ?? getDefaultFormValues("");

  const form = useForm<InspectionFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(inspectionFormSchema) as any,
    defaultValues: initialFormValues,
    mode: "onChange",
  });

  // seedFromInitial: opening the page (or reopening) must not write — only edits do
  const { status: saveStatus, lastSaved, flush } = useAutoSave(form, inspection.id, {
    enabled: !readOnly,
    seedFromInitial: true,
  });
  const validations = useStepValidations(form.control);
  const includeAlternativePages = useWatch({ control: form.control, name: "includeAlternativePages" });

  // ── Media selection (photos included in the report) ─────────────────────────
  const [mediaItems, setMediaItems] = useState(initialMedia);
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(
    () => new Set(initialMedia.filter((m) => m.type === "photo").map((m) => m.id)),
  );
  const selectedMedia = useMemo(
    () => mediaItems.filter((m) => selectedMediaIds.has(m.id)),
    [mediaItems, selectedMediaIds],
  );
  const toggleMedia = useCallback((id: string) => {
    setSelectedMediaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectAllPhotos = useCallback(
    () => setSelectedMediaIds(new Set(mediaItems.filter((m) => m.type === "photo").map((m) => m.id))),
    [mediaItems],
  );
  const deselectAllPhotos = useCallback(() => setSelectedMediaIds(new Set()), []);
  const handleDescriptionSaved = useCallback((mediaId: string, description: string) => {
    setMediaItems((prev) => prev.map((m) => (m.id === mediaId ? { ...m, description } : m)));
  }, []);

  // ── Sections (controlled so the finalize dialog can jump to a field) ────────
  const [openSections, setOpenSections] = useState<Record<number, boolean>>({});
  const setSectionOpen = useCallback(
    (index: number, open: boolean) => setOpenSections((prev) => ({ ...prev, [index]: open })),
    [],
  );

  const jumpToField = useCallback(
    (path: string, stepIndex: number) => {
      setSectionOpen(stepIndex, true);
      // Two frames: one for the section to mount, one for layout
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(`[data-field-path="${path}"]`);
          if (!el) return;
          el.scrollIntoView?.({ behavior: "smooth", block: "center" });
          el.setAttribute("data-highlight", "true");
          setTimeout(() => el.removeAttribute("data-highlight"), HIGHLIGHT_MS);
          form.setFocus(path as FieldPath<InspectionFormData>);
        }),
      );
    },
    [form, setSectionOpen],
  );

  const steps = [
    <StepFacilityInfo key="0" inspectionId={inspection.id} readOnly={readOnly} />,
    <StepGeneralTreatment key="1" inspectionId={inspection.id} readOnly={readOnly} />,
    <StepDesignFlow key="2" inspectionId={inspection.id} readOnly={readOnly} />,
    <StepSepticTank key="3" inspectionId={inspection.id} readOnly={readOnly} />,
    <StepDisposalWorks key="4" inspectionId={inspection.id} readOnly={readOnly} />,
    <StepAlternativeSystem key="5" inspectionId={inspection.id} readOnly={readOnly} />,
  ];

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
        {/* Status header + actions */}
        <ReviewActions
          inspectionId={inspection.id}
          status={status}
          facilityAddress={inspection.facilityAddress}
          customerEmail={inspection.customerEmail}
          isFromWorkiz={inspection.isFromWorkiz}
          selectedMediaIds={Array.from(selectedMediaIds)}
          onStatusChange={setStatus}
          flush={flush}
          getFormData={form.getValues}
          onJumpToField={jumpToField}
        />

        {/* Six wizard sections */}
        <div className="space-y-3">
          {steps.map((step, index) => (
            <ReviewSection
              key={STEP_LABELS[index]}
              title={STEP_LABELS[index]}
              open={openSections[index] ?? false}
              onOpenChange={(open) => setSectionOpen(index, open)}
              pill={
                <ReviewPill
                  result={index === 5 && !includeAlternativePages ? null : validations[index]}
                />
              }
            >
              {step}
            </ReviewSection>
          ))}
        </div>

        <PhotoSelection
          inspectionId={inspection.id}
          media={mediaItems}
          selectedIds={selectedMediaIds}
          onToggle={toggleMedia}
          onSelectAll={selectAllPhotos}
          onDeselectAll={deselectAllPhotos}
          onDescriptionSaved={handleDescriptionSaved}
          readOnly={readOnly}
        />

        <ReportPreview
          inspectionId={inspection.id}
          status={status}
          form={form}
          selectedMedia={selectedMedia}
          readOnly={readOnly}
        />

        <SaveStatusBar
          status={saveStatus}
          lastSaved={lastSaved}
          onRetry={() => void flush()}
          readOnly={readOnly}
        />
      </Form>
    </div>
  );
}
