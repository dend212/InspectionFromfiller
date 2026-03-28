"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { type FieldPath, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ApnLookupInput } from "@/components/inspection/apn-lookup-input";
import { ReviewNoteBanner } from "@/components/inspection/review-note-banner";
import { ScanFormButton } from "@/components/inspection/scan-form-button";
import { StepAlternativeSystem } from "@/components/inspection/step-alternative-system";
import { StepDesignFlow } from "@/components/inspection/step-design-flow";
import { StepDisposalWorks } from "@/components/inspection/step-disposal-works";
import { StepFacilityInfo } from "@/components/inspection/step-facility-info";
import { StepGeneralTreatment } from "@/components/inspection/step-general-treatment";
import { StepSepticTank } from "@/components/inspection/step-septic-tank";
import { SubmitForReviewButton } from "@/components/inspection/submit-for-review-button";
import { WizardNavigation } from "@/components/inspection/wizard-navigation";
import { WizardProgress } from "@/components/inspection/wizard-progress";
import { Form } from "@/components/ui/form";
import { useAutoSave } from "@/hooks/use-auto-save";
import { STEP_LABELS } from "@/lib/constants/inspection";
import {
  getDefaultFormValues,
  inspectionFormSchema,
  STEP_FIELDS,
} from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

interface InspectionWizardProps {
  inspection: {
    id: string;
    formData: InspectionFormData | null;
    status: string;
    reviewNotes?: string | null;
  };
}

export function InspectionWizard({ inspection }: InspectionWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const form = useForm<InspectionFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(inspectionFormSchema) as any,
    defaultValues: inspection.formData ?? getDefaultFormValues(""),
    mode: "onBlur",
  });

  const { saving, lastSaved } = useAutoSave(form, inspection.id);

  // Watch the toggle — drives step count and isLastStep
  const includeAlternativePages = useWatch({
    control: form.control,
    name: "includeAlternativePages",
    defaultValue: false,
  });

  const totalSteps = includeAlternativePages ? 6 : 5;
  const isLastStep = currentStep === totalSteps - 1;

  const handleNext = async () => {
    // Trigger validation for current step fields
    const isValid = await form.trigger(STEP_FIELDS[currentStep] as FieldPath<InspectionFormData>[]);
    if (!isValid) {
      toast.error("Please fill in all required fields before continuing");
      return;
    }
    setCurrentStep((prev) => Math.min(prev + 1, totalSteps - 1));
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  const handleStepClick = (step: number) => {
    setCurrentStep(step);
  };

  const handleSubmit = form.handleSubmit(
    async (data) => {
      try {
        // Save final data
        const response = await fetch(`/api/inspections/${inspection.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          throw new Error("Failed to save inspection");
        }

        toast.success("Inspection saved successfully");
      } catch {
        toast.error("Failed to submit inspection");
      }
    },
    () => {
      // Validation failed on submit -- show error
      toast.error("Please complete all required fields before submitting");
    },
  );

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-6 pb-4">
        {inspection.reviewNotes && <ReviewNoteBanner note={inspection.reviewNotes} />}

        {inspection.status === "draft" && (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <ApnLookupInput form={form} />
            <ScanFormButton inspectionId={inspection.id} form={form} />
          </div>
        )}

        <WizardProgress
          currentStep={currentStep}
          totalSteps={totalSteps}
          onStepClick={handleStepClick}
        />

        <div className="rounded-lg border bg-card p-4 sm:p-6">
          <div className="mb-5 pb-4 border-b">
            <p className="text-xs font-medium text-primary uppercase tracking-wider">
              Step {currentStep + 1} of {totalSteps}
            </p>
            <h2 className="text-xl font-semibold mt-1">{STEP_LABELS[currentStep]}</h2>
          </div>

          <div className="min-h-[40vh]">
            {currentStep === 0 && <StepFacilityInfo inspectionId={inspection.id} />}
            {currentStep === 1 && <StepGeneralTreatment inspectionId={inspection.id} />}
            {currentStep === 2 && <StepDesignFlow inspectionId={inspection.id} />}
            {currentStep === 3 && <StepSepticTank inspectionId={inspection.id} />}
            {currentStep === 4 && <StepDisposalWorks inspectionId={inspection.id} />}
            {currentStep === 5 && <StepAlternativeSystem inspectionId={inspection.id} />}
          </div>
        </div>

        <WizardNavigation
          currentStep={currentStep}
          onNext={handleNext}
          onBack={handleBack}
          isLastStep={isLastStep}
          isSubmitting={form.formState.isSubmitting}
          saving={saving}
          lastSaved={lastSaved}
          submitButton={
            inspection.status === "draft" ? (
              <SubmitForReviewButton inspectionId={inspection.id} formData={form.getValues()} />
            ) : undefined
          }
        />
      </form>
    </Form>
  );
}
