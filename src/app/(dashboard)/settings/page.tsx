"use client";

import { ArrowRight, Check, ListChecks, Loader2, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SignaturePad } from "@/components/inspection/signature-pad";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/hooks/use-user-role";

export default function SettingsPage() {
  const { role } = useUserRole();
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [pendingSignature, setPendingSignature] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/profile/signature")
      .then((res) => res.json())
      .then((data) => setSavedSignature(data.signatureDataUrl))
      .catch(() => toast.error("Failed to load signature"))
      .finally(() => setLoading(false));
  }, []);

  const handleCapture = useCallback((dataUrl: string) => {
    setPendingSignature(dataUrl);
  }, []);

  const handleSave = async () => {
    const sig = pendingSignature;
    if (!sig) return;

    setSaving(true);
    try {
      const res = await fetch("/api/profile/signature", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureDataUrl: sig }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed");
      }

      setSavedSignature(sig);
      setPendingSignature(null);
      toast.success("Signature saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save signature");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your profile and preferences</p>
      </div>

      <div className="rounded-lg border bg-card p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Inspector Signature</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Draw your signature below. It will be automatically applied to all finalized inspection
            PDFs.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {savedSignature && !pendingSignature && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Current Signature</label>
                <div className="rounded-lg border-2 border-green-200 bg-background p-4 flex items-center justify-center">
                  <Image
                    src={savedSignature}
                    alt="Saved signature"
                    width={400}
                    height={120}
                    className="max-h-28 w-auto object-contain"
                    unoptimized
                  />
                </div>
                <p className="text-xs text-green-600 flex items-center gap-1">
                  <Check className="h-3 w-3" /> Signature saved — draw below to replace
                </p>
              </div>
            )}

            <SignaturePad onSignatureCapture={handleCapture} />

            {pendingSignature && (
              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save Signature
              </Button>
            )}
          </>
        )}
      </div>

      {role === "admin" && (
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Admin Tools</h2>
            <p className="text-sm text-muted-foreground">Manage checklist templates and users.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/admin/checklist-templates"
              className="group flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
                <ListChecks className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-semibold">
                  Checklist Templates
                  <ArrowRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Create and edit reusable checklist templates for jobs.
                </p>
              </div>
            </Link>
            <Link
              href="/admin/users"
              className="group flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
                <Users className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-semibold">
                  Manage Users
                  <ArrowRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Invite team members, set roles, and remove access.
                </p>
              </div>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
