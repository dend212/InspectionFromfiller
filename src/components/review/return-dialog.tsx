"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ReturnDialogProps {
  inspectionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReturned: () => void;
}

export function ReturnDialog({
  inspectionId,
  open,
  onOpenChange,
  onReturned,
}: ReturnDialogProps) {
  const [note, setNote] = useState("");
  const [isReturning, setIsReturning] = useState(false);

  const handleReturn = async () => {
    if (!note.trim()) {
      toast.error("Please enter a note explaining what needs to be fixed");
      return;
    }

    setIsReturning(true);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to return inspection");
      }
      toast.success("Inspection returned to field tech");
      setNote("");
      onOpenChange(false);
      onReturned();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to return inspection"
      );
    } finally {
      setIsReturning(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Return to Field Tech</AlertDialogTitle>
          <AlertDialogDescription>
            This will send the inspection back to the field tech for corrections.
            Please explain what needs to be fixed.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Label htmlFor="return-note">Return Note</Label>
          <Textarea
            id="return-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Explain what needs to be fixed..."
            rows={4}
            className="resize-none"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setNote("")}>
            Cancel
          </AlertDialogCancel>
          <Button
            onClick={handleReturn}
            disabled={isReturning || !note.trim()}
            className="bg-amber-600 hover:bg-amber-700"
          >
            {isReturning && <Loader2 className="size-4 animate-spin" />}
            Return Inspection
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
