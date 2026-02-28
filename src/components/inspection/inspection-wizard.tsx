"use client";

import { useState } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Form } from "@/components/ui/form";
import { WizardProgress } from "@/components/inspection/wizard-progress";
import { WizardNavigation } from "@/components/inspection/wizard-navigation";
import { StepFacilityInfo } from "@/components/inspection/step-facility-info";
import { StepGeneralTreatment } from "@/components/inspection/step-general-treatment";
import { StepDesignFlow } from "@/components/inspection/step-design-flow";
import { StepSepticTank } from "@/components/inspection/step-septic-tank";
import { StepDisposalWorks } from "@/components/inspection/step-disposal-works";
import { useAutoSave } from "@/hooks/use-auto-save";
import {
  inspectionFormSchema,
  getDefaultFormValues,
  STEP_FIELDS,
} from "@/lib/validators/inspection";
import { STEP_LABELS } from "@/lib/constants/inspection";
import { SubmitForReviewButton } from "@/components/inspection/submit-for-review-button";
import { ReviewNoteBanner } from "@/components/inspection/review-note-banner";
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

  const handleNext = async () => {
    // Trigger validation for current step fields
    const isValid = await form.trigger(
      STEP_FIELDS[currentStep] as FieldPath<InspectionFormData>[]
    );
    if (!isValid) {
      toast.error("Please fill in all required fields before continuing");
      return;
    }
    setCurrentStep((prev) => Math.min(prev + 1, 4));
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
    }
  );

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-6 pb-4">
        {inspection.reviewNotes && (
          <ReviewNoteBanner note={inspection.reviewNotes} />
        )}

        <WizardProgress
          currentStep={currentStep}
          onStepClick={handleStepClick}
        />

        <div className="rounded-lg border bg-card p-4 sm:p-6">
          <div className="mb-5 pb-4 border-b">
            <p className="text-xs font-medium text-primary uppercase tracking-wider">
              Step {currentStep + 1} of 5
            </p>
            <h2 className="text-xl font-semibold mt-1">
              {STEP_LABELS[currentStep]}
            </h2>
          </div>

          <div className="min-h-[40vh]">
            {currentStep === 0 && <StepFacilityInfo inspectionId={inspection.id} />}
            {currentStep === 1 && <StepGeneralTreatment inspectionId={inspection.id} />}
            {currentStep === 2 && <StepDesignFlow inspectionId={inspection.id} />}
            {currentStep === 3 && <StepSepticTank inspectionId={inspection.id} />}
            {currentStep === 4 && <StepDisposalWorks inspectionId={inspection.id} />}
          </div>
        </div>

        <WizardNavigation
          currentStep={currentStep}
          onNext={handleNext}
          onBack={handleBack}
          isLastStep={currentStep === 4}
          isSubmitting={form.formState.isSubmitting}
          saving={saving}
          lastSaved={lastSaved}
          submitButton={
            inspection.status === "draft" ? (
              <SubmitForReviewButton
                inspectionId={inspection.id}
                formData={form.getValues()}
              />
            ) : undefined
          }
        />
      </form>
    </Form>
  );
}
