"use client";

import { Sparkles, Trash2, Upload, Video } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useJobNoteRewrite } from "@/hooks/use-job-note-rewrite";
import { uploadVideoTus } from "@/lib/storage/tus-upload.mjs";
import { createClient } from "@/lib/supabase/client";
import type { AppRole } from "@/types/roles";

// Hard ceiling from migration 0010 bumping the bucket file_size_limit.
const VIDEO_BUCKET_LIMIT_MB = 500;
const MAX_VIDEO_SECONDS = 300;

interface JobDetail {
  id: string;
  title: string;
  status: "open" | "in_progress" | "completed";
  assignedTo: string;
  assigneeName: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  serviceAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  generalNotes: string | null;
  customerSummary: string | null;
  finalizedPdfPath: string | null;
  customerPdfPath: string | null;
}

interface ChecklistItem {
  id: string;
  title: string;
  instructions: string | null;
  requiredPhotoCount: number;
  requiresNote: boolean;
  isRequired: boolean;
  sortOrder: number;
  status: "pending" | "done" | "skipped";
  note: string | null;
}

interface MediaRow {
  id: string;
  bucket: "checklist_item" | "general";
  checklistItemId: string | null;
  storagePath: string;
  signedUrl: string | null;
  type: "photo" | "video";
  description: string | null;
  visibleToCustomer: boolean;
  sortOrder: number;
}

interface JobDetailViewProps {
  role: AppRole;
  currentUserId: string;
  job: JobDetail;
  items: ChecklistItem[];
  media: MediaRow[];
  latestSummaryToken: string | null;
}

const STATUS_LABELS: Record<"open" | "in_progress" | "completed", string> = {
  open: "Open",
  in_progress: "In Progress",
  completed: "Completed",
};

export function JobDetailView({
  role,
  job: initialJob,
  items: initialItems,
  media: initialMedia,
  latestSummaryToken: initialLatestSummaryToken,
}: JobDetailViewProps) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [items, setItems] = useState(initialItems);
  const [media, setMedia] = useState(initialMedia);
  const [generalNotes, setGeneralNotes] = useState(initialJob.generalNotes ?? "");
  const [customerSummary, setCustomerSummary] = useState(initialJob.customerSummary ?? "");
  const [latestSummaryToken, setLatestSummaryToken] = useState(initialLatestSummaryToken);
  const [isPending, startTransition] = useTransition();
  const rewrite = useJobNoteRewrite();

  const isCompleted = job.status === "completed";
  const isPrivileged = role === "admin" || role === "office_staff";
  const canFinalize = !isCompleted;

  const mediaByItem = new Map<string, MediaRow[]>();
  const generalMedia: MediaRow[] = [];
  for (const m of media) {
    if (m.bucket === "general") {
      generalMedia.push(m);
    } else if (m.checklistItemId) {
      const arr = mediaByItem.get(m.checklistItemId) ?? [];
      arr.push(m);
      mediaByItem.set(m.checklistItemId, arr);
    }
  }

  // ------- API helpers -------
  const saveNotes = async () => {
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generalNotes, customerSummary }),
    });
    if (!res.ok) {
      toast.error("Failed to save notes");
      return;
    }
    toast.success("Notes saved");
  };

  const patchStatus = async (status: "in_progress") => {
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      toast.error("Failed to update status");
      return;
    }
    const { job: updated } = await res.json();
    setJob((j) => ({ ...j, status: updated.status }));
    toast.success("Marked in progress");
  };

  const patchItem = async (
    itemId: string,
    patch: Partial<Pick<ChecklistItem, "status" | "note">>,
  ) => {
    const res = await fetch(`/api/jobs/${job.id}/checklist/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      toast.error("Failed to update item");
      return;
    }
    const { item } = await res.json();
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, status: item.status, note: item.note } : i)),
    );
  };

  const deleteItem = async (itemId: string) => {
    if (!confirm("Remove this checklist item?")) return;
    const res = await fetch(`/api/jobs/${job.id}/checklist/${itemId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Failed to delete");
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setMedia((prev) => prev.filter((m) => m.checklistItemId !== itemId));
  };

  const uploadFile = async (
    file: File,
    bucket: "checklist_item" | "general",
    checklistItemId?: string,
  ) => {
    try {
      // 1. Request signed upload URL
      const urlRes = await fetch(`/api/jobs/${job.id}/media/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, bucket, checklistItemId }),
      });
      if (!urlRes.ok) {
        const err = await urlRes.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to create upload URL");
      }
      const { signedUrl, token, storagePath } = await urlRes.json();

      // 2. Upload bytes using Supabase signed-upload endpoint
      const putRes = await fetch(signedUrl, {
        method: "PUT",
        headers: {
          "x-upsert": "true",
          Authorization: `Bearer ${token}`,
          "Content-Type": file.type,
        },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

      // 3. Register in DB
      const regRes = await fetch(`/api/jobs/${job.id}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath,
          bucket,
          checklistItemId: bucket === "checklist_item" ? checklistItemId : undefined,
          type: "photo",
        }),
      });
      if (!regRes.ok) {
        const err = await regRes.json().catch(() => ({}));
        throw new Error(err.error ?? "Registration failed");
      }
      const { media: newMedia } = await regRes.json();

      // 4. Fetch a fresh display URL by refreshing the page data.
      // Simpler: call the detail GET for a fresh signed URL.
      router.refresh();
      return newMedia;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg);
      return null;
    }
  };

  const uploadVideoFile = async (
    file: File,
    bucket: "checklist_item" | "general",
    checklistItemId: string | undefined,
    onProgress: (pct: number) => void,
  ) => {
    // Guard: hard size ceiling (bucket file_size_limit is 500 MB)
    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > VIDEO_BUCKET_LIMIT_MB) {
      toast.error(
        `Video is ${sizeMb.toFixed(0)} MB. Maximum is ${VIDEO_BUCKET_LIMIT_MB} MB — please trim or compress first.`,
        { duration: 6000 },
      );
      return null;
    }

    // Best-effort duration check (skip silently if browser can't decode)
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const videoEl = document.createElement("video");
        videoEl.preload = "metadata";
        const url = URL.createObjectURL(file);
        videoEl.src = url;
        const timeout = setTimeout(() => {
          URL.revokeObjectURL(url);
          reject(new Error("timeout"));
        }, 10_000);
        videoEl.onloadedmetadata = () => {
          clearTimeout(timeout);
          URL.revokeObjectURL(url);
          resolve(videoEl.duration);
        };
        videoEl.onerror = () => {
          clearTimeout(timeout);
          URL.revokeObjectURL(url);
          reject(new Error("decode"));
        };
      });
      if (duration > MAX_VIDEO_SECONDS) {
        toast.error(`Video must be ${MAX_VIDEO_SECONDS / 60} minutes or less`, {
          duration: 5000,
        });
        return null;
      }
    } catch {
      // Unreadable metadata — allow upload anyway
    }

    try {
      // 1. Ask API for an authorized storage path (no signed URL for video)
      const urlRes = await fetch(`/api/jobs/${job.id}/media/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          bucket,
          mediaType: "video",
          checklistItemId,
        }),
      });
      if (!urlRes.ok) {
        const err = await urlRes.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to get upload URL");
      }
      const { storagePath } = (await urlRes.json()) as { storagePath: string };

      // 2. Get the user JWT for TUS auth
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Session expired — please log in again");

      // 3. TUS resumable upload direct to Supabase Storage
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
      await uploadVideoTus({
        supabaseUrl,
        bearerToken: session.access_token,
        bucket: "inspection-media",
        objectPath: storagePath,
        body: file,
        contentType: file.type || "video/mp4",
        onProgress: (sent: number, total: number) => {
          if (total > 0) onProgress(Math.round((sent / total) * 100));
        },
      });

      // 4. Register in DB
      const regRes = await fetch(`/api/jobs/${job.id}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath,
          bucket,
          checklistItemId: bucket === "checklist_item" ? checklistItemId : undefined,
          type: "video",
        }),
      });
      if (!regRes.ok) {
        const err = await regRes.json().catch(() => ({}));
        throw new Error(err.error ?? "Registration failed");
      }
      toast.success("Video uploaded");
      router.refresh();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg, { duration: 6000 });
      return null;
    }
  };

  const deleteMedia = async (mediaId: string) => {
    if (!confirm("Delete this media?")) return;
    const res = await fetch(`/api/jobs/${job.id}/media/${mediaId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete");
      return;
    }
    setMedia((prev) => prev.filter((m) => m.id !== mediaId));
  };

  const toggleVisible = async (mediaId: string, next: boolean) => {
    const res = await fetch(`/api/jobs/${job.id}/media/${mediaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibleToCustomer: next }),
    });
    if (!res.ok) {
      toast.error("Failed to update visibility");
      return;
    }
    setMedia((prev) => prev.map((m) => (m.id === mediaId ? { ...m, visibleToCustomer: next } : m)));
  };

  const handleRewriteGeneralNotes = async () => {
    const out = await rewrite.generate({
      jobId: job.id,
      type: "generalNotes",
      currentText: generalNotes,
    });
    if (out) {
      setGeneralNotes(out);
      toast.success("Rewritten — remember to save");
    }
  };

  const handleRewriteItemNote = async (itemId: string, currentNote: string) => {
    const out = await rewrite.generate({
      jobId: job.id,
      type: "checklistItem",
      currentText: currentNote,
      checklistItemId: itemId,
    });
    if (out) {
      await patchItem(itemId, { note: out });
      toast.success("Item note rewritten");
    }
  };

  const handleGenerateCustomerSummary = async () => {
    const out = await rewrite.generate({
      jobId: job.id,
      type: "customerSummary",
    });
    if (out) {
      setCustomerSummary(out);
      // Persist it immediately
      await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerSummary: out }),
      });
      toast.success("Customer summary generated");
    }
  };

  const handleFinalize = () => {
    startTransition(async () => {
      const res = await fetch(`/api/jobs/${job.id}/finalize`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.details && Array.isArray(err.details)) {
          toast.error(`${err.error}: ${err.details.join("; ")}`);
        } else {
          toast.error(err.error ?? "Finalize failed");
        }
        return;
      }
      toast.success("Job finalized");
      router.refresh();
    });
  };

  const handleGenerateSummaryLink = () => {
    startTransition(async () => {
      const res = await fetch(`/api/jobs/${job.id}/generate-summary`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Failed");
        return;
      }
      const { token, summaryUrl } = await res.json();
      setLatestSummaryToken(token);
      await navigator.clipboard.writeText(summaryUrl).catch(() => {});
      toast.success("Summary link created and copied");
    });
  };

  const downloadPdf = async (variant: "staff" | "customer") => {
    const res = await fetch(`/api/jobs/${job.id}/download?variant=${variant}`);
    if (!res.ok) {
      toast.error("Download failed");
      return;
    }
    const { url } = await res.json();
    window.open(url, "_blank");
  };

  // ------- Render -------
  return (
    <div className="max-w-5xl space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Service Visit
          </p>
          <h1 className="text-2xl font-bold">{job.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {job.customerName || "No customer"} ·{" "}
            {[job.serviceAddress, job.city, job.state].filter(Boolean).join(", ") || "No address"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Assigned to {job.assigneeName ?? "—"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
              job.status === "completed"
                ? "bg-emerald-100 text-emerald-800"
                : job.status === "in_progress"
                  ? "bg-blue-100 text-blue-800"
                  : "bg-slate-100 text-slate-700"
            }`}
          >
            {STATUS_LABELS[job.status]}
          </span>
          {job.status === "open" && (
            <Button size="sm" variant="outline" onClick={() => patchStatus("in_progress")}>
              Start
            </Button>
          )}
        </div>
      </header>

      {/* Checklist */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Checklist</h2>
        {items.length === 0 && (
          <p className="text-sm italic text-muted-foreground">
            No checklist items. (Create a template first, or add ad-hoc items from the API.)
          </p>
        )}
        <div className="space-y-3">
          {items.map((item) => (
            <ChecklistItemCard
              key={item.id}
              item={item}
              jobId={job.id}
              media={mediaByItem.get(item.id) ?? []}
              disabled={isCompleted}
              onPatch={(patch) => patchItem(item.id, patch)}
              onDelete={() => deleteItem(item.id)}
              onUploadFile={(file) => uploadFile(file, "checklist_item", item.id)}
              onUploadVideo={(file, onProgress) =>
                uploadVideoFile(file, "checklist_item", item.id, onProgress)
              }
              onDeleteMedia={deleteMedia}
              onRewrite={() => handleRewriteItemNote(item.id, item.note ?? "")}
              rewriteBusy={rewrite.isGenerating}
            />
          ))}
        </div>
      </section>

      {/* General notes */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">General Notes</h2>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleRewriteGeneralNotes}
              disabled={rewrite.isGenerating || isCompleted}
            >
              <Sparkles className="size-3.5 mr-1.5" />
              Rewrite with AI
            </Button>
            <Button size="sm" onClick={saveNotes} disabled={isCompleted}>
              Save notes
            </Button>
          </div>
        </div>
        <Textarea
          value={generalNotes}
          onChange={(e) => setGeneralNotes(e.target.value)}
          rows={5}
          disabled={isCompleted}
          placeholder="Free-form notes about the visit that don't belong to a specific checklist item."
        />
      </section>

      {/* General media */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">General Photos & Videos</h2>
          <div className="flex gap-2">
            <GeneralPhotoUploadButton
              disabled={isCompleted}
              onFile={(file) => uploadFile(file, "general")}
            />
            <VideoUploadButton
              disabled={isCompleted}
              onFile={(file, onProgress) => uploadVideoFile(file, "general", undefined, onProgress)}
            />
          </div>
        </div>
        {generalMedia.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">No general media yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {generalMedia.map((m) => (
              <div key={m.id} className="group relative overflow-hidden rounded-lg border bg-white">
                {m.signedUrl && m.type === "photo" && (
                  <div className="relative aspect-square w-full">
                    <Image
                      src={m.signedUrl}
                      alt={m.description ?? "Job photo"}
                      fill
                      sizes="(min-width:768px) 200px, 45vw"
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                )}
                {m.signedUrl && m.type === "video" && (
                  <div className="relative aspect-square w-full bg-black">
                    <video
                      src={m.signedUrl}
                      controls
                      preload="metadata"
                      className="absolute inset-0 h-full w-full object-contain"
                    >
                      <track kind="captions" />
                    </video>
                  </div>
                )}
                <div className="flex items-center gap-1.5 border-t bg-muted/30 px-2 py-1.5 text-[11px]">
                  <Checkbox
                    id={`visible-${m.id}`}
                    checked={m.visibleToCustomer}
                    disabled={isCompleted}
                    onCheckedChange={(v) => toggleVisible(m.id, !!v)}
                  />
                  <Label
                    htmlFor={`visible-${m.id}`}
                    className="text-[11px] font-normal text-muted-foreground"
                  >
                    Show to customer
                  </Label>
                </div>
                {!isCompleted && (
                  <button
                    type="button"
                    onClick={() => deleteMedia(m.id)}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100"
                    aria-label="Delete"
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Customer summary */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Customer Summary</h2>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleGenerateCustomerSummary}
              disabled={rewrite.isGenerating || isCompleted}
            >
              <Sparkles className="size-3.5 mr-1.5" />
              Generate from checklist
            </Button>
            <Button size="sm" onClick={saveNotes} disabled={isCompleted}>
              Save
            </Button>
          </div>
        </div>
        <Textarea
          value={customerSummary}
          onChange={(e) => setCustomerSummary(e.target.value)}
          rows={5}
          disabled={isCompleted}
          placeholder="The polished customer-facing paragraph shown on the tokenized summary page."
        />
      </section>

      {/* Finalize + share */}
      <section className="rounded-xl border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Finalize & Share</h2>
        <div className="flex flex-wrap gap-2">
          {canFinalize && (
            <Button onClick={handleFinalize} disabled={isPending}>
              {isPending ? "Finalizing…" : "Finalize job"}
            </Button>
          )}
          {job.finalizedPdfPath && (
            <Button variant="outline" onClick={() => downloadPdf("staff")}>
              Download staff PDF
            </Button>
          )}
          {job.customerPdfPath && (
            <Button variant="outline" onClick={() => downloadPdf("customer")}>
              Download customer PDF
            </Button>
          )}
          {job.customerPdfPath && isPrivileged && (
            <Button variant="outline" onClick={handleGenerateSummaryLink} disabled={isPending}>
              {latestSummaryToken ? "Regenerate summary link" : "Create summary link"}
            </Button>
          )}
        </div>
        {latestSummaryToken && (
          <p className="text-sm text-muted-foreground">
            Public link:{" "}
            <a
              href={`/jobs/summary/${latestSummaryToken}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              /jobs/summary/{latestSummaryToken}
            </a>
          </p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ChecklistItemCard({
  item,
  media,
  disabled,
  onPatch,
  onDelete,
  onUploadFile,
  onUploadVideo,
  onDeleteMedia,
  onRewrite,
  rewriteBusy,
}: {
  item: ChecklistItem;
  jobId: string;
  media: MediaRow[];
  disabled: boolean;
  onPatch: (patch: Partial<Pick<ChecklistItem, "status" | "note">>) => void;
  onDelete: () => void;
  onUploadFile: (file: File) => void;
  onUploadVideo: (file: File, onProgress: (pct: number) => void) => Promise<true | null>;
  onDeleteMedia: (mediaId: string) => void;
  onRewrite: () => void;
  rewriteBusy: boolean;
}) {
  const [note, setNote] = useState(item.note ?? "");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Only photos count toward requiredPhotoCount (finalize gate is photo-only)
  const photoCount = media.filter((m) => m.type === "photo").length;
  const videoCount = media.length - photoCount;
  const photoCountOk = photoCount >= item.requiredPhotoCount;
  const noteOk = !item.requiresNote || note.trim().length > 0;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{item.title}</h3>
            {item.isRequired && (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">
                Required
              </span>
            )}
          </div>
          {item.instructions && (
            <p className="mt-1 text-sm italic text-muted-foreground">{item.instructions}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Photos: {photoCount} / {item.requiredPhotoCount}
            {videoCount > 0 ? ` · Videos: ${videoCount}` : ""}
            {item.requiresNote ? " · Note required" : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <select
            value={item.status}
            disabled={disabled}
            onChange={(e) => onPatch({ status: e.target.value as "pending" | "done" | "skipped" })}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            <option value="pending">Pending</option>
            <option value="done">Done</option>
            <option value="skipped">Skipped</option>
          </select>
          {!disabled && (
            <Button size="icon" variant="ghost" onClick={onDelete} aria-label="Delete item">
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Technician note</Label>
          <Button
            size="sm"
            variant="ghost"
            onClick={onRewrite}
            disabled={disabled || rewriteBusy}
            className="h-7 text-xs"
          >
            <Sparkles className="size-3 mr-1" /> Rewrite
          </Button>
        </div>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note !== (item.note ?? "")) {
              onPatch({ note: note.trim() || null });
            }
          }}
          rows={3}
          disabled={disabled}
          placeholder={item.requiresNote ? "Required" : "Optional"}
        />
        {!noteOk && <p className="text-xs text-amber-700">Note required to finalize.</p>}
      </div>

      {media.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {media.map((m) => (
            <div key={m.id} className="group relative overflow-hidden rounded-md border bg-white">
              {m.signedUrl && m.type === "photo" && (
                <div className="relative aspect-square w-full">
                  <Image
                    src={m.signedUrl}
                    alt={m.description ?? "Item photo"}
                    fill
                    sizes="100px"
                    className="object-cover"
                    unoptimized
                  />
                </div>
              )}
              {m.signedUrl && m.type === "video" && (
                <div className="relative aspect-square w-full bg-black">
                  <video
                    src={m.signedUrl}
                    controls
                    preload="metadata"
                    className="absolute inset-0 h-full w-full object-contain"
                  >
                    <track kind="captions" />
                  </video>
                </div>
              )}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onDeleteMedia(m.id)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100"
                  aria-label="Delete media"
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!photoCountOk && (
        <p className="text-xs text-amber-700">
          {item.requiredPhotoCount - photoCount} more photo(s) required to finalize.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUploadFile(f);
            e.target.value = "";
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="size-3.5 mr-1.5" />
          Add photo
        </Button>
        <VideoUploadButton
          disabled={disabled}
          onFile={(file, onProgress) => onUploadVideo(file, onProgress)}
        />
      </div>
    </div>
  );
}

function GeneralPhotoUploadButton({
  disabled,
  onFile,
}: {
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => ref.current?.click()}>
        <Upload className="size-3.5 mr-1.5" />
        Add photo
      </Button>
    </>
  );
}

function VideoUploadButton({
  disabled,
  onFile,
}: {
  disabled: boolean;
  onFile: (file: File, onProgress: (pct: number) => void) => Promise<unknown>;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pct, setPct] = useState(0);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // reset so the same file can be re-selected
    if (!f) return;
    setUploading(true);
    setPct(0);
    try {
      await onFile(f, setPct);
    } finally {
      setUploading(false);
      setPct(0);
    }
  };

  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleChange}
        disabled={disabled || uploading}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || uploading}
        onClick={() => ref.current?.click()}
      >
        <Video className="size-3.5 mr-1.5" />
        {uploading ? `Uploading ${pct}%` : "Add video"}
      </Button>
    </>
  );
}
