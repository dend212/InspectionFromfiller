"use client";

import { useRef, useState, useCallback } from "react";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { Eraser } from "lucide-react";

interface SignaturePadProps {
  /** Called with the PNG data URL whenever the user finishes a stroke */
  onSignatureCapture: (dataUrl: string) => void;
}

/**
 * Draw-on-screen signature pad using react-signature-canvas.
 *
 * Designed for field use with finger or stylus. Exports a trimmed
 * PNG data URL on each stroke end for embedding in the generated PDF.
 */
export function SignaturePad({ onSignatureCapture }: SignaturePadProps) {
  const sigRef = useRef<SignatureCanvas | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  const handleEnd = useCallback(() => {
    const canvas = sigRef.current;
    if (!canvas || canvas.isEmpty()) return;

    setIsEmpty(false);

    // Get trimmed canvas and export as PNG data URL
    const trimmed = canvas.getTrimmedCanvas();
    const dataUrl = trimmed.toDataURL("image/png");
    onSignatureCapture(dataUrl);
  }, [onSignatureCapture]);

  const handleClear = useCallback(() => {
    sigRef.current?.clear();
    setIsEmpty(true);
  }, []);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium leading-none">
        Inspector Signature
      </label>
      <div className="rounded-lg border-2 border-dashed border-muted-foreground/30 bg-background">
        <SignatureCanvas
          ref={sigRef}
          penColor="black"
          backgroundColor="rgba(0,0,0,0)"
          canvasProps={{
            className: "w-full h-40 touch-none",
          }}
          onEnd={handleEnd}
        />
      </div>
      <div className="flex items-center justify-between">
        {isEmpty ? (
          <p className="text-xs text-muted-foreground">
            Sign above using finger or stylus
          </p>
        ) : (
          <p className="text-xs text-green-600">Signature captured</p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleClear}
          disabled={isEmpty}
        >
          <Eraser className="size-4" />
          Clear
        </Button>
      </div>
    </div>
  );
}
