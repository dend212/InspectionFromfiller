"use client";

import { Loader2, Video } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { uploadVideoTus } from "@/lib/storage/tus-upload.mjs";
import { createClient } from "@/lib/supabase/client";
import type { MediaRecord } from "./media-gallery";

interface VideoUploadProps {
  inspectionId: string;
  onUploadComplete: (media: MediaRecord) => void;
}

// Hard ceiling on bucket side (migration 0010 bumped bucket file_size_limit to 500 MB).
const BUCKET_LIMIT_MB = 500;
// Default Supabase project-level "Upload File Size Limit". Unless it has been
// raised in Dashboard → Storage → Settings (Pro plan required to exceed 50 MB),
// anything over this size will fail with a "size exceeded" style error.
const PROJECT_LIMIT_MB = 50;

/**
 * Best-effort video duration probe. Returns duration in seconds or rejects if
 * the browser can't decode the file / read metadata within 10s.
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

/**
 * Map raw upload errors to messages a non-technical field technician can act on.
 */
function friendlyError(raw: string): string {
  const msg = raw.toLowerCase();
  if (
    msg.includes("exceeded the maximum") ||
    msg.includes("maximum size exceeded") ||
    msg.includes("413") ||
    msg.includes("payload too large")
  ) {
    return `Video too large for current upload limit (~${PROJECT_LIMIT_MB} MB). Ask your admin to raise "Upload File Size Limit" in Supabase Dashboard → Storage → Settings.`;
  }
  if (msg.includes("row-level security") || msg.includes("403")) {
    return "You don't have permission to upload to this inspection.";
  }
  if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("invalid compact jws")) {
    return "Session expired — please log in again.";
  }
  if (msg.includes("network") || msg.includes("failed to fetch") || msg.includes("aborted")) {
    return "Network issue during upload. Please try again on a stable connection.";
  }
  return raw;
}

export function VideoUpload({ inspectionId, onUploadComplete }: VideoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset input value immediately so the same file can be re-selected after error.
      if (inputRef.current) inputRef.current.value = "";

      // Hard stop for files over the bucket cap — no point even trying.
      const sizeMb = file.size / (1024 * 1024);
      if (sizeMb > BUCKET_LIMIT_MB) {
        toast.error(
          `Video is ${sizeMb.toFixed(0)} MB. Maximum is ${BUCKET_LIMIT_MB} MB — please trim or compress the video first.`,
          { duration: 6000 },
        );
        return;
      }

      setUploading(true);
      setProgressPct(0);

      try {
        // Duration probe (best-effort). Skip silently if the browser can't read it.
        try {
          const duration = await getVideoDuration(file);
          if (duration > 300) {
            toast.error("Video must be 5 minutes or less", { duration: 5000 });
            setUploading(false);
            setProgressPct(null);
            return;
          }
        } catch {
          // Unreadable metadata (unsupported codec, etc.) — allow upload anyway.
        }

        // Step 1: Ask the API for an authorized storage path. No signed token for video.
        const urlRes = await fetch(`/api/inspections/${inspectionId}/media/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, type: "video", label: "video" }),
        });

        if (!urlRes.ok) {
          const contentType = urlRes.headers.get("content-type") ?? "";
          if (contentType.includes("application/json")) {
            const err = await urlRes.json();
            throw new Error(err.error || "Failed to get upload URL");
          }
          throw new Error(
            urlRes.status === 401
              ? "Session expired — please log in again"
              : "Failed to get upload URL",
          );
        }

        const { storagePath } = (await urlRes.json()) as { storagePath: string };

        // Step 2: Grab the current user JWT to authenticate the TUS upload.
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) {
          throw new Error("401 — no active session");
        }

        // Step 3: TUS resumable upload direct to Supabase Storage with progress events.
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");

        await uploadVideoTus({
          supabaseUrl,
          bearerToken: session.access_token,
          bucket: "inspection-media",
          objectPath: storagePath,
          body: file,
          contentType: file.type || "video/mp4",
          onProgress: (bytesSent, bytesTotal) => {
            if (bytesTotal > 0) {
              setProgressPct(Math.round((bytesSent / bytesTotal) * 100));
            }
          },
        });

        // Step 4: Save metadata
        const metaRes = await fetch(`/api/inspections/${inspectionId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storagePath, type: "video", label: "video" }),
        });

        if (!metaRes.ok) {
          const contentType = metaRes.headers.get("content-type") ?? "";
          if (contentType.includes("application/json")) {
            const err = await metaRes.json();
            throw new Error(err.error || "Failed to save metadata");
          }
          throw new Error(
            metaRes.status === 401
              ? "Session expired — please log in again"
              : "Failed to save metadata",
          );
        }

        const mediaRecord = (await metaRes.json()) as MediaRecord;
        onUploadComplete(mediaRecord);
        toast.success("Video uploaded");
      } catch (err) {
        const raw = err instanceof Error ? err.message : "Upload failed";
        console.error("Video upload error:", err);
        toast.error(friendlyError(raw), { duration: 6000 });
      } finally {
        setUploading(false);
        setProgressPct(null);
      }
    },
    [inspectionId, onUploadComplete],
  );

  const labelText =
    uploading && progressPct !== null ? `Uploading ${progressPct}%…` : "Upload Video";

  return (
    <div className="w-full max-w-sm">
      <label
        className="flex min-h-[48px] w-full cursor-pointer items-center gap-3 overflow-hidden rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
        aria-label="Upload video"
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <Video className="h-5 w-5 shrink-0" aria-hidden="true" />
        )}
        <span className="flex-1 truncate">{labelText}</span>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={handleFileSelect}
          disabled={uploading}
        />
      </label>
      {uploading && progressPct !== null && (
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Video upload progress"
        >
          <div
            className="h-full bg-primary transition-[width] duration-200 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
    </div>
  );
}
