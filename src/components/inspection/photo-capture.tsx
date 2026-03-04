"use client";

import { Camera, Loader2, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { MediaRecord } from "./media-gallery";

interface PhotoCaptureProps {
  inspectionId: string;
  section: string;
  onUploadComplete: (media: MediaRecord) => void;
}

export function PhotoCapture({ inspectionId, section, onUploadComplete }: PhotoCaptureProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error("Only image files are accepted");
        return;
      }

      setUploading(true);

      try {
        // Step 1: Get a presigned upload URL from the API
        const urlRes = await fetch(`/api/inspections/${inspectionId}/media/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, type: "photo", label: section }),
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

        // Step 3: Save metadata via API
        const metaRes = await fetch(`/api/inspections/${inspectionId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storagePath, type: "photo", label: section }),
        });

        if (!metaRes.ok) {
          const err = await metaRes.json();
          throw new Error(err.error || "Failed to save metadata");
        }

        const mediaRecord = (await metaRes.json()) as MediaRecord;
        onUploadComplete(mediaRecord);
        toast.success("Photo uploaded");
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
    [inspectionId, section, onUploadComplete],
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

      if (uploading) return;

      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) {
        toast.error("No image files found in drop");
        return;
      }

      // Upload files sequentially to avoid overwhelming the server
      for (const file of files) {
        await uploadFile(file);
      }
    },
    [uploading, uploadFile],
  );

  return (
    <div
      className={`rounded-lg border-2 border-dashed p-4 transition-colors ${
        dragOver
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25 hover:border-muted-foreground/40"
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex flex-col items-center gap-2">
        {uploading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Uploading...
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Upload className="h-4 w-4" />
              Drag &amp; drop photos here, or
            </div>
            <label
              className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              aria-label={`Add photo for ${section}`}
            >
              <Camera className="h-4 w-4" />
              Browse Files
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileSelect}
                disabled={uploading}
              />
            </label>
          </>
        )}
      </div>
    </div>
  );
}
