"use client";

import { useRef, useState } from "react";
import { Video, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { MediaRecord } from "./media-gallery";

interface VideoUploadProps {
  inspectionId: string;
  onUploadComplete: (media: MediaRecord) => void;
}

/**
 * Validates video duration by loading metadata in a temporary <video> element.
 * Returns the duration in seconds, or rejects if the file cannot be loaded.
 */
function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(file);
    video.src = url;

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to read video file"));
    };
  });
}

export function VideoUpload({
  inspectionId,
  onUploadComplete,
}: VideoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);

    try {
      // Duration validation (MDIA-02): reject videos over 120 seconds
      const duration = await getVideoDuration(file);
      if (duration > 120) {
        toast.error("Video must be 120 seconds or less");
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
        return;
      }

      const supabase = createClient();
      const filePath = `${inspectionId}/video/${crypto.randomUUID()}-${file.name}`;

      const { data, error: uploadError } = await supabase.storage
        .from("inspection-media")
        .upload(filePath, file);

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      // Save metadata to API
      const response = await fetch(
        `/api/inspections/${inspectionId}/media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storagePath: data.path,
            type: "video",
            label: "video",
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to save video metadata");
      }

      const mediaRecord = (await response.json()) as MediaRecord;
      onUploadComplete(mediaRecord);
      toast.success("Video uploaded");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Upload failed";
      toast.error(message);
    } finally {
      setUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  return (
    <div>
      <label
        className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
        aria-label="Upload video"
      >
        {uploading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Uploading...
          </>
        ) : (
          <>
            <Video className="h-5 w-5" />
            Upload Video
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={handleFileSelect}
          disabled={uploading}
        />
      </label>
    </div>
  );
}
