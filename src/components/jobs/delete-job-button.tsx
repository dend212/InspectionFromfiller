"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface DeleteJobButtonProps {
  jobId: string;
  jobTitle: string;
  /** If provided, called after successful delete instead of router.refresh(). */
  onDeleted?: () => void;
}

/**
 * Trash-can button + AlertDialog confirmation for deleting a job.
 * Calls DELETE /api/jobs/[id] (admin/office_staff only — server enforced).
 */
export function DeleteJobButton({ jobId, jobTitle, onDeleted }: DeleteJobButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async (e: React.MouseEvent) => {
    // Prevent the AlertDialog from closing until the request settles so we
    // can surface errors in place.
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }
      setOpen(false);
      if (onDeleted) {
        onDeleted();
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`Delete job: ${jobTitle}`}
          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={(e) => {
            // Stop the click from bubbling up to the row link wrapper (if any).
            e.stopPropagation();
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this job?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes <span className="font-semibold">{jobTitle}</span> along with
            every checklist item, photo, video, and summary attached to it. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={handleConfirm}>
            {busy ? (
              <>
                <Loader2 className="mr-1.5 size-4 animate-spin" />
                Deleting…
              </>
            ) : (
              "Delete job"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
