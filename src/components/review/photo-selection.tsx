"use client";

import { ImageIcon, Video } from "lucide-react";
import { useCallback, useState } from "react";
import type { MediaRecord } from "@/components/inspection/media-gallery";
import { Button } from "@/components/ui/button";
import { ReviewSection } from "./review-section";

interface PhotoSelectionProps {
  inspectionId: string;
  media: MediaRecord[];
  /** Photo ids included in the report */
  selectedIds: Set<string>;
  onToggle: (mediaId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  /** Called after a caption PATCH succeeds so the owner can update its media list */
  onDescriptionSaved: (mediaId: string, description: string) => void;
  readOnly: boolean;
}

/**
 * Select-for-report photo grid with inline caption editing, plus a read-only
 * video list. Extracted verbatim from the legacy review editor.
 */
export function PhotoSelection({
  inspectionId,
  media,
  selectedIds,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onDescriptionSaved,
  readOnly,
}: PhotoSelectionProps) {
  const photos = media.filter((m) => m.type === "photo");
  const videos = media.filter((m) => m.type === "video");
  const [editingDescId, setEditingDescId] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState("");

  const saveDescription = useCallback(
    async (mediaId: string, newDesc: string) => {
      const trimmed = newDesc.trim();
      const item = media.find((m) => m.id === mediaId);
      if (trimmed === (item?.description ?? "")) {
        setEditingDescId(null);
        return;
      }
      try {
        const res = await fetch(`/api/inspections/${inspectionId}/media`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaId, description: trimmed }),
        });
        if (res.ok) {
          onDescriptionSaved(mediaId, trimmed);
        }
      } finally {
        setEditingDescId(null);
      }
    },
    [inspectionId, media, onDescriptionSaved],
  );

  if (photos.length === 0 && videos.length === 0) return null;

  return (
    <ReviewSection
      title={`Photos (${selectedIds.size} of ${photos.length} selected for the report)`}
      defaultOpen
    >
      <div className="space-y-4">
        {/* Photos */}
        {photos.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Photos</p>
              {!readOnly && (
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={onSelectAll}
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={onDeselectAll}
                  >
                    Deselect All
                  </Button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {photos.map((photo, idx) => {
                const isSelected = selectedIds.has(photo.id);
                const isEditingThis = editingDescId === photo.id;
                return (
                  <div
                    key={photo.id}
                    className={`relative rounded-lg border overflow-hidden text-left transition-all ${
                      isSelected ? "ring-2 ring-primary border-primary" : "opacity-50 border-muted"
                    }`}
                  >
                    <button
                      type="button"
                      disabled={readOnly}
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? "Exclude" : "Include"} ${photo.label ?? `photo ${idx + 1}`}`}
                      className={`w-full ${!readOnly ? "cursor-pointer hover:opacity-80" : ""}`}
                      onClick={() => onToggle(photo.id)}
                    >
                      {photo.signedUrl ? (
                        <img
                          src={photo.signedUrl}
                          alt={photo.label ?? `Photo ${idx + 1}`}
                          className="aspect-square w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex aspect-square w-full items-center justify-center bg-muted">
                          <ImageIcon className="size-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute left-1.5 top-1.5">
                        <div
                          className={`flex size-5 items-center justify-center rounded border text-[10px] font-bold ${
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/50 bg-background/80 text-muted-foreground"
                          }`}
                        >
                          {isSelected ? "✓" : ""}
                        </div>
                      </div>
                    </button>
                    {isEditingThis && !readOnly ? (
                      <input
                        type="text"
                        autoFocus
                        value={descDraft}
                        onChange={(e) => setDescDraft(e.target.value)}
                        onBlur={() => saveDescription(photo.id, descDraft)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveDescription(photo.id, descDraft);
                          } else if (e.key === "Escape") {
                            setEditingDescId(null);
                          }
                        }}
                        className="w-full border-t bg-background px-1.5 py-1 text-[10px] outline-none focus:ring-1 focus:ring-ring"
                        placeholder="Add description…"
                      />
                    ) : (
                      <button
                        type="button"
                        disabled={readOnly}
                        className="w-full truncate px-1.5 py-1 text-left text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDescDraft(photo.description ?? "");
                          setEditingDescId(photo.id);
                        }}
                      >
                        {photo.description || "Add description…"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Videos */}
        {videos.length > 0 && (
          <>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Videos</p>
            <div className="space-y-1">
              {videos.map((video) => (
                <div key={video.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <Video className="size-4 text-muted-foreground" />
                  <span className="text-sm">{video.label || "Video"}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(video.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </ReviewSection>
  );
}
