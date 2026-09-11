import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiCommentButton } from "@/components/inspection/ai-comment-button";
import { PhotoCapture } from "@/components/inspection/photo-capture";
import { StepDesignFlow } from "@/components/inspection/step-design-flow";
import { VideoUpload } from "@/components/inspection/video-upload";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/storage/tus-upload.mjs", () => ({ uploadVideoTus: vi.fn() }));
vi.mock("@/hooks/use-comment-rewrite", () => ({
  useCommentRewrite: () => ({ isGenerating: false, generate: vi.fn() }),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const form = useForm<InspectionFormData>({ defaultValues: getDefaultFormValues("Dan") });
  return <FormProvider {...form}>{children}</FormProvider>;
}

beforeEach(() => {
  // Media list fetch performed on mount by every step
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
});

describe("step readOnly", () => {
  it("wraps the step in an enabled fieldset by default and shows the photo drop zone", () => {
    render(
      <Wrapper>
        <StepDesignFlow inspectionId="insp-1" />
      </Wrapper>,
    );
    const fieldset = document.querySelector("fieldset");
    expect(fieldset).not.toBeNull();
    expect(fieldset).not.toBeDisabled();
    expect(screen.getByLabelText("Estimated Design Flow (GPD)")).toBeEnabled();
    expect(screen.getByText(/browse files/i)).toBeInTheDocument();
  });

  it("readOnly: fieldset[disabled] disables every control and hides the photo drop zone", () => {
    render(
      <Wrapper>
        <StepDesignFlow inspectionId="insp-1" readOnly />
      </Wrapper>,
    );
    expect(document.querySelector("fieldset[disabled]")).not.toBeNull();
    expect(screen.getByLabelText("Estimated Design Flow (GPD)")).toBeDisabled();
    // ButtonGroup buttons are native <button>s → disabled by the fieldset
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
    expect(screen.queryByText(/browse files/i)).not.toBeInTheDocument();
  });
});

describe("readOnly gating of upload / AI actions", () => {
  it("PhotoCapture renders nothing when readOnly", () => {
    const { container } = render(
      <PhotoCapture inspectionId="insp-1" section="design-flow" onUploadComplete={vi.fn()} readOnly />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("VideoUpload renders nothing when readOnly", () => {
    const { container } = render(
      <VideoUpload inspectionId="insp-1" onUploadComplete={vi.fn()} readOnly />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("AiCommentButton renders nothing when readOnly, and the button otherwise", () => {
    const { container, rerender } = render(
      <Wrapper>
        <AiCommentButton
          inspectionId="insp-1"
          section="septicTank"
          fieldPath="septicTank.septicTankComments"
          buildContext={() => ({}) as never}
          readOnly
        />
      </Wrapper>,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <Wrapper>
        <AiCommentButton
          inspectionId="insp-1"
          section="septicTank"
          fieldPath="septicTank.septicTankComments"
          buildContext={() => ({}) as never}
        />
      </Wrapper>,
    );
    expect(screen.getByRole("button", { name: /generate with ai/i })).toBeInTheDocument();
  });
});
