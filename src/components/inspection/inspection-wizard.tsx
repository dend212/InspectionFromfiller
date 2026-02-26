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
import type { InspectionFormData } from "@/types/inspection";

interface InspectionWizardProps {
  inspection: {
    id: string;
    formData: InspectionFormData | null;
    status: string;
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
    // Trigger validation for current step fields (warn-but-allow pattern)
    await form.trigger(
      STEP_FIELDS[currentStep] as FieldPath<InspectionFormData>[]
    );
    // Always advance regardless of validation result
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
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <WizardProgress
          currentStep={currentStep}
          onStepClick={handleStepClick}
        />

        <h2 className="text-xl font-semibold">
          Step {currentStep + 1}: {STEP_LABELS[currentStep]}
        </h2>

        <div className="min-h-[50vh]">
          {currentStep === 0 && <StepFacilityInfo inspectionId={inspection.id} />}
          {currentStep === 1 && <StepGeneralTreatment inspectionId={inspection.id} />}
          {currentStep === 2 && <StepDesignFlow inspectionId={inspection.id} />}
          {currentStep === 3 && <StepSepticTank inspectionId={inspection.id} />}
          {currentStep === 4 && <StepDisposalWorks inspectionId={inspection.id} />}
        </div>

        <WizardNavigation
          currentStep={currentStep}
          onNext={handleNext}
          onBack={handleBack}
          isLastStep={currentStep === 4}
          isSubmitting={form.formState.isSubmitting}
          saving={saving}
          lastSaved={lastSaved}
        />
      </form>
    </Form>
  );
}
