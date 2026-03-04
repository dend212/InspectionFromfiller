"use client";

import { Loader2, Video } from "lucide-react";
import { useRef, useState } from "react";
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

    const timeout = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error("Timed out reading video metadata"));
    }, 10_000);

    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };

    video.onerror = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      reject(new Error("Failed to read video file"));
    };
  });
}

export function VideoUpload({ inspectionId, onUploadComplete }: VideoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

      // Step 1: Get a presigned upload URL from the API
      const urlRes = await fetch(`/api/inspections/${inspectionId}/media/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, type: "video", label: "video" }),
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
        body: JSON.stringify({ storagePath, type: "video", label: "video" }),
      });

      if (!metaRes.ok) {
        const err = await metaRes.json();
        throw new Error(err.error || "Failed to save metadata");
      }

      const mediaRecord = (await metaRes.json()) as MediaRecord;
      onUploadComplete(mediaRecord);
      toast.success("Video uploaded");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
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
