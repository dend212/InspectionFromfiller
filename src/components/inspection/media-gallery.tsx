"use client";

import { Camera, Pencil, Video as VideoIcon, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

export interface MediaRecord {
  id: string;
  type: "photo" | "video";
  storagePath: string;
  label: string | null;
  description: string | null;
  sortOrder: number | null;
  createdAt: string;
  signedUrl?: string | null;
}

interface MediaGalleryProps {
  inspectionId: string;
  section?: string;
  media: MediaRecord[];
  onDelete: (mediaId: string) => void;
  onLabelUpdate?: (mediaId: string, newLabel: string) => void;
  onDescriptionUpdate?: (mediaId: string, newDescription: string) => void;
}

function MediaThumbnail({
  item,
  inspectionId,
  onDelete,
  onDescriptionUpdate,
}: {
  item: MediaRecord;
  inspectionId: string;
  onDelete: (mediaId: string) => void;
  onDescriptionUpdate?: (mediaId: string, newDescription: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.description ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const caption = item.description ?? "";

  const saveDescription = useCallback(
    async (newDescription: string) => {
      const trimmed = newDescription.trim();
      if (trimmed === (item.description ?? "")) {
        setEditing(false);
        return;
      }
      setSaving(true);
      try {
        const res = await fetch(`/api/inspections/${inspectionId}/media`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaId: item.id, description: trimmed }),
        });
        if (res.ok) {
          onDescriptionUpdate?.(item.id, trimmed);
        }
      } finally {
        setSaving(false);
        setEditing(false);
      }
    },
    [inspectionId, item.id, item.description, onDescriptionUpdate],
  );

  const startEditing = useCallback(() => {
    setDraft(item.description ?? "");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [item.description]);

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

      {/* Editable Caption */}
      <div className="p-2">
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => saveDescription(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveDescription(draft);
              } else if (e.key === "Escape") {
                setEditing(false);
                setDraft(item.description ?? "");
              }
            }}
            disabled={saving}
            className="w-full rounded border border-input bg-background px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
            placeholder="Add description…"
          />
        ) : (
          <button
            type="button"
            onClick={startEditing}
            className="group/caption flex w-full items-center gap-1 text-left"
          >
            <p className="flex-1 truncate text-xs text-muted-foreground">
              {caption || "Add description…"}
            </p>
            <Pencil className="h-3 w-3 shrink-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover/caption:opacity-100" />
          </button>
        )}
      </div>
    </div>
  );
}

export function MediaGallery({
  inspectionId,
  section,
  media,
  onDelete,
  onLabelUpdate,
  onDescriptionUpdate,
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
          inspectionId={inspectionId}
          onDelete={onDelete}
          onDescriptionUpdate={onDescriptionUpdate}
        />
      ))}
    </div>
  );
}
