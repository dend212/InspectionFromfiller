"use client";

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { MediaRecord } from "./media-gallery";

interface PhotoCaptureProps {
  inspectionId: string;
  section: string;
  onUploadComplete: (media: MediaRecord) => void;
}

export function PhotoCapture({
  inspectionId,
  section,
  onUploadComplete,
}: PhotoCaptureProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) {
      console.warn("[PhotoCapture] No file selected");
      return;
    }

    console.log("[PhotoCapture] File selected:", file.name, file.type, file.size);
    setUploading(true);

    try {
      const supabase = createClient();
      const filePath = `${inspectionId}/${section}/${crypto.randomUUID()}-${file.name}`;
      console.log("[PhotoCapture] Uploading to storage:", filePath);

      const { data, error: uploadError } = await supabase.storage
        .from("inspection-media")
        .upload(filePath, file);

      if (uploadError) {
        console.error("[PhotoCapture] Storage upload error:", uploadError);
        throw new Error(`Storage upload failed: ${uploadError.message}`);
      }

      console.log("[PhotoCapture] Storage upload success:", data.path);

      // Save metadata to API
      const response = await fetch(
        `/api/inspections/${inspectionId}/media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storagePath: data.path,
            type: "photo",
            label: section,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[PhotoCapture] API error:", response.status, errorText);
        throw new Error(`Failed to save photo metadata: ${response.status}`);
      }

      const mediaRecord = (await response.json()) as MediaRecord;
      console.log("[PhotoCapture] Media record saved:", mediaRecord.id);
      onUploadComplete(mediaRecord);
      toast.success("Photo uploaded");
    } catch (err) {
      console.error("[PhotoCapture] Upload failed:", err);
      const message =
        err instanceof Error ? err.message : "Upload failed";
      toast.error(message, { duration: 8000 });
    } finally {
      setUploading(false);
      // Reset file input so the same file can be re-selected
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  return (
    <div>
      <label
        className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        aria-label={`Add photo for ${section}`}
      >
        {uploading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Uploading...
          </>
        ) : (
          <>
            <Camera className="h-5 w-5" />
            Add Photo
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
          disabled={uploading}
        />
      </label>
    </div>
  );
}
