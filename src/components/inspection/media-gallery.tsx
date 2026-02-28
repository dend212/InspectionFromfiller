"use client";

import { Camera, X, Video as VideoIcon } from "lucide-react";

export interface MediaRecord {
  id: string;
  type: "photo" | "video";
  storagePath: string;
  label: string | null;
  sortOrder: number | null;
  createdAt: string;
  signedUrl?: string | null;
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
  item: MediaRecord;
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
      ) : item.type === "photo" ? (
        <div className="flex aspect-square items-center justify-center bg-muted">
          <Camera className="h-10 w-10 text-muted-foreground" />
        </div>
      ) : (
        <div className="flex aspect-square items-center justify-center bg-muted">
          <VideoIcon className="h-10 w-10 text-muted-foreground" />
        </div>
      )}

      {/* Caption */}
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
          item={item}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
