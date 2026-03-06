"use client";

import { FilePlus, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export default function NewInspectionPage() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const res = await fetch("/api/inspections", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to create inspection");
      }
      const inspection = await res.json();
      router.push(`/inspections/${inspection.id}/edit`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create inspection");
      setIsCreating(false);
    }
  };

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">New Inspection</h1>
        <p className="mt-2 text-muted-foreground">
          Start a new septic system inspection report.
        </p>
      </div>
      <Button size="lg" onClick={handleCreate} disabled={isCreating}>
        {isCreating ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <FilePlus className="size-5" />
        )}
        {isCreating ? "Creating..." : "Create New Inspection"}
      </Button>
    </div>
  );
}
