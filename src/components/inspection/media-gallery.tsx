"use client";

import { useEffect, useState } from "react";
import { X, Video as VideoIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export interface MediaRecord {
  id: string;
  type: "photo" | "video";
  storagePath: string;
  label: string | null;
  sortOrder: number | null;
  createdAt: string;
}

interface MediaGalleryProps {
  inspectionId: string;
  section?: string;
  media: MediaRecord[];
  onDelete: (mediaId: string) => void;
}

function MediaThumbnail({
  item,
  onDelete,
}: {
  item: MediaRecord & { signedUrl?: string };
  onDelete: (mediaId: string) => void;
}) {
  const caption = item.label ?? "";

  return (
    <div className="group relative rounded-lg border bg-card overflow-hidden">
      {/* Delete button */}
      <button
        type="button"
        onClick={() => onDelete(item.id)}
        className="absolute right-1 top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-destructive-foreground sm:opacity-0 transition-opacity sm:group-hover:opacity-100 focus:opacity-100"
        aria-label="Delete media"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Thumbnail or placeholder */}
      {item.type === "photo" && item.signedUrl ? (
        <div className="aspect-square">
          <img
            src={item.signedUrl}
            alt={caption || "Inspection photo"}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="flex aspect-square items-center justify-center bg-muted">
          <VideoIcon className="h-10 w-10 text-muted-foreground" />
        </div>
      )}

      {/* Caption input */}
      {caption && (
        <div className="p-2">
          <p className="w-full text-xs text-muted-foreground truncate">
            {caption}
          </p>
        </div>
      )}
    </div>
  );
}

export function MediaGallery({
  inspectionId,
  section,
  media,
  onDelete,
}: MediaGalleryProps) {
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>(
    {}
  );

  // Generate signed URLs for photo thumbnails
  useEffect(() => {
    if (media.length === 0) return;

    const photos = media.filter((m) => m.type === "photo");
    if (photos.length === 0) return;

    const supabase = createClient();

    async function loadUrls() {
      const urls: Record<string, string> = {};

      for (const photo of photos) {
        // Skip if we already have a URL for this item
        if (signedUrls[photo.id]) {
          urls[photo.id] = signedUrls[photo.id];
          continue;
        }

        const { data } = await supabase.storage
          .from("inspection-media")
          .createSignedUrl(photo.storagePath, 3600);

        if (data?.signedUrl) {
          urls[photo.id] = data.signedUrl;
        }
      }

      setSignedUrls((prev) => ({ ...prev, ...urls }));
    }

    loadUrls();
    // Only re-run when media list changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media]);

  if (media.length === 0) {
    return (
      <div className="flex min-h-[80px] items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25">
        <p className="text-sm text-muted-foreground">No photos yet</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {media.map((item) => (
        <MediaThumbnail
          key={item.id}
          item={{ ...item, signedUrl: signedUrls[item.id] }}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
