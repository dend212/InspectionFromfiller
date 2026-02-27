"use client";

import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

interface EmailHistoryEntry {
  id: string;
  recipientEmail: string;
  subject: string;
  sentAt: string;
  senderName: string;
}

interface SendEmailDialogProps {
  inspectionId: string;
  facilityAddress: string | null;
  customerEmail: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SendEmailDialog({
  inspectionId,
  facilityAddress,
  customerEmail,
  open,
  onOpenChange,
}: SendEmailDialogProps) {
  const [recipientEmail, setRecipientEmail] = useState(customerEmail ?? "");
  const [subject, setSubject] = useState(
    `Inspection Report - ${facilityAddress || "Property Inspection"}`,
  );
  const [personalNote, setPersonalNote] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [emailHistory, setEmailHistory] = useState<EmailHistoryEntry[]>([]);

  // Reset fields and fetch history when dialog opens
  useEffect(() => {
    if (open) {
      setRecipientEmail(customerEmail ?? "");
      setSubject(
        `Inspection Report - ${facilityAddress || "Property Inspection"}`,
      );
      setPersonalNote("");
      setIsSending(false);

      // Fetch send history
      fetch(`/api/inspections/${inspectionId}/emails`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data: EmailHistoryEntry[]) => setEmailHistory(data))
        .catch(() => setEmailHistory([]));
    }
  }, [open, inspectionId, customerEmail, facilityAddress]);

  const isValidEmail = recipientEmail.includes("@") && recipientEmail.trim().length > 0;

  // Compose preview body (matches server template)
  const addressLine = facilityAddress || "the inspected property";
  const notePart = personalNote ? `${personalNote}\n\n` : "";
  const previewBody = `Dear Customer,

Please find attached your inspection report for ${addressLine}.

${notePart}If you have any questions about this report, please don't hesitate to contact us.

Best regards,
SewerTime Septic`;

  const handleSend = async () => {
    if (!isValidEmail || isSending) return;
    setIsSending(true);

    try {
      const res = await fetch(`/api/inspections/${inspectionId}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientEmail: recipientEmail.trim(),
          subject,
          personalNote: personalNote.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send email");
      }

      toast.success(`Report sent successfully to ${recipientEmail.trim()}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to send email",
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Mail className="size-5" />
            Send Report to Customer
          </AlertDialogTitle>
          <AlertDialogDescription>
            Send the finalized inspection report as a PDF attachment.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          {/* Recipient Email */}
          <div className="space-y-2">
            <Label htmlFor="recipient-email">Recipient Email</Label>
            <Input
              id="recipient-email"
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="customer@example.com"
            />
          </div>

          {/* Subject */}
          <div className="space-y-2">
            <Label htmlFor="email-subject">Subject</Label>
            <Input
              id="email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          {/* Personal Note */}
          <div className="space-y-2">
            <Label htmlFor="personal-note">Personal Note (optional)</Label>
            <Textarea
              id="personal-note"
              value={personalNote}
              onChange={(e) => setPersonalNote(e.target.value)}
              placeholder="Add a personal note (optional)"
              rows={3}
            />
          </div>

          {/* Email Preview */}
          <div className="space-y-2">
            <Label>Email Preview</Label>
            <div className="rounded-md border bg-muted/30 p-4 text-sm whitespace-pre-wrap text-muted-foreground">
              {previewBody}
            </div>
          </div>

          {/* Send History */}
          {emailHistory.length > 0 && (
            <div className="space-y-2">
              <Label className="text-muted-foreground">Previously Sent</Label>
              <div className="space-y-1">
                {emailHistory.map((entry) => (
                  <p
                    key={entry.id}
                    className="text-xs text-muted-foreground"
                  >
                    {new Date(entry.sentAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    to {entry.recipientEmail}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={!isValidEmail || isSending}
          >
            {isSending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Mail className="size-4" />
            )}
            Send Email
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
