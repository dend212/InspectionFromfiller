"use client";

import { Camera, Loader2, Upload, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

interface UploadedImage {
  storagePath: string;
  previewUrl: string;
  fileName: string;
}

interface ScanUploadZoneProps {
  inspectionId: string;
  uploadedImages: UploadedImage[];
  onUploadComplete: (image: UploadedImage) => void;
  onRemoveImage: (storagePath: string) => void;
  disabled?: boolean;
}

export function ScanUploadZone({
  inspectionId,
  uploadedImages,
  onUploadComplete,
  onRemoveImage,
  disabled = false,
}: ScanUploadZoneProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error("Only image files are accepted");
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        toast.error("Image must be under 10 MB");
        return;
      }

      setUploading(true);

      try {
        // Step 1: Get presigned upload URL
        const urlRes = await fetch(`/api/inspections/${inspectionId}/media/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            type: "photo",
            label: "Form Scan",
            section: "scan",
          }),
        });

        if (!urlRes.ok) {
          const err = await urlRes.json();
          throw new Error(err.error || "Failed to get upload URL");
        }

        const { token, storagePath } = await urlRes.json();

        // Step 2: Upload directly to Supabase Storage via SDK
        const supabase = createClient();
        const { error: uploadError } = await supabase.storage
          .from("inspection-media")
          .uploadToSignedUrl(storagePath, token, file);

        if (uploadError) {
          throw new Error(uploadError.message || "Storage upload failed");
        }

        // Create a local preview URL
        const previewUrl = URL.createObjectURL(file);

        onUploadComplete({
          storagePath,
          previewUrl,
          fileName: file.name,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        toast.error(message);
      } finally {
        setUploading(false);
        if (inputRef.current) {
          inputRef.current.value = "";
        }
      }
    },
    [inspectionId, onUploadComplete],
  );

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      await uploadFile(file);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);

      if (uploading || disabled) return;

      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) {
        toast.error("No image files found");
        return;
      }

      for (const file of files) {
        await uploadFile(file);
      }
    },
    [uploading, disabled, uploadFile],
  );

  return (
    <div className="space-y-4">
      {/* Uploaded thumbnails */}
      {uploadedImages.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {uploadedImages.map((img, i) => (
            <div key={img.storagePath} className="group relative">
              {/* biome-ignore lint/performance/noImgElement: blob preview URLs don't work with next/image */}
              <img
                src={img.previewUrl}
                alt={`Scan page ${i + 1}`}
                className="h-32 w-full rounded-lg border object-cover"
              />
              <div className="absolute top-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                Page {i + 1}
              </div>
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute top-1 right-1 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => onRemoveImage(img.storagePath)}
                disabled={disabled}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Upload zone */}
      <section
        aria-label="Drop zone for form scan images"
        className={`rounded-lg border-2 border-dashed p-6 transition-colors ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/40"
        } ${disabled ? "pointer-events-none opacity-50" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center gap-3">
          {uploading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Uploading...
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Upload className="h-4 w-4" />
                {uploadedImages.length === 0
                  ? "Upload photos of your paper inspection form"
                  : "Add more pages"}
              </div>
              <div className="flex gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                  <Camera className="h-4 w-4" />
                  Take Photo
                  <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleFileSelect}
                    disabled={uploading || disabled}
                  />
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent">
                  <Upload className="h-4 w-4" />
                  Browse
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleFileSelect}
                    disabled={uploading || disabled}
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                Upload 1-10 photos. Each page of the form should be a separate image for best
                results.
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
