"use client";

import { Loader2, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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

interface EmailHistoryEntry {
  id: string;
  recipientEmail: string;
  subject: string;
  sentAt: string;
  senderName: string;
}

interface SendJobSummaryDialogProps {
  jobId: string;
  /** Used only for the fallback subject line. */
  jobTitle: string;
  customerEmail: string | null;
  /** Full service address; used in both the subject line and the body. */
  serviceAddressLine: string | null;
  summaryUrl: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Admin-only dialog that sends the tokenized customer summary link to the
 * job's customer. Deliberately mirrors SendEmailDialog (inspections):
 * same title, same subject/body shape, same email history footer. Only the
 * words "inspection" → "service visit" change.
 */
export function SendJobSummaryDialog({
  jobId,
  jobTitle,
  customerEmail,
  serviceAddressLine,
  summaryUrl,
  open,
  onOpenChange,
}: SendJobSummaryDialogProps) {
  const initialSubject = `Service Visit Summary - ${serviceAddressLine || jobTitle}`;
  const [recipientEmail, setRecipientEmail] = useState(customerEmail ?? "");
  const [subject, setSubject] = useState(initialSubject);
  const [personalNote, setPersonalNote] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [emailHistory, setEmailHistory] = useState<EmailHistoryEntry[]>([]);

  // Reset fields + fetch history on open
  useEffect(() => {
    if (!open) return;
    setRecipientEmail(customerEmail ?? "");
    setSubject(`Service Visit Summary - ${serviceAddressLine || jobTitle}`);
    setPersonalNote("");
    setIsSending(false);
    fetch(`/api/jobs/${jobId}/emails`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: EmailHistoryEntry[]) => setEmailHistory(data))
      .catch(() => setEmailHistory([]));
  }, [open, jobId, customerEmail, serviceAddressLine, jobTitle]);

  const isValidEmail = recipientEmail.includes("@") && recipientEmail.trim().length > 0;

  // Mirror server template verbatim so the preview matches what ships.
  const addressLine = serviceAddressLine || "your property";
  const notePart = personalNote ? `${personalNote}\n\n` : "";
  const previewBody = `Dear Customer,

Your service visit summary for ${addressLine} is ready. You can view it here:

${summaryUrl}

${notePart}This link includes a summary of the work performed and any photos or videos captured during the visit.

If you have any questions, please don't hesitate to contact us.

Best regards,
SewerTime Septic`;

  const handleSend = async () => {
    if (!isValidEmail || isSending) return;
    setIsSending(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/send-summary-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientEmail: recipientEmail.trim(),
          subject,
          personalNote: personalNote.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to send email");
      }
      toast.success(`Summary sent successfully to ${recipientEmail.trim()}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !isSending && onOpenChange(next)}>
      <AlertDialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Mail className="size-5" />
            Send Summary Link
          </AlertDialogTitle>
          <AlertDialogDescription>
            Send the service visit summary page link to the customer.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          {/* Recipient Email */}
          <div className="space-y-2">
            <Label htmlFor="job-recipient-email">Recipient Email</Label>
            <Input
              id="job-recipient-email"
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="customer@example.com"
            />
          </div>

          {/* Subject */}
          <div className="space-y-2">
            <Label htmlFor="job-email-subject">Subject</Label>
            <Input
              id="job-email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          {/* Personal Note */}
          <div className="space-y-2">
            <Label htmlFor="job-personal-note">Personal Note (optional)</Label>
            <Textarea
              id="job-personal-note"
              value={personalNote}
              onChange={(e) => setPersonalNote(e.target.value)}
              placeholder="Add a personal note (optional)"
              rows={3}
            />
          </div>

          {/* Email Preview */}
          <div className="space-y-2">
            <Label>Email Preview</Label>
            <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
              {previewBody}
            </div>
          </div>

          {/* Send History */}
          {emailHistory.length > 0 && (
            <div className="space-y-2">
              <Label className="text-muted-foreground">Previously Sent</Label>
              <div className="space-y-1">
                {emailHistory.map((entry) => (
                  <p key={entry.id} className="text-xs text-muted-foreground">
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={!isValidEmail || isSending}>
            {isSending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
            Send Email
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
