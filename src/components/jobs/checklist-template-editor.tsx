"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface TemplateItemDraft {
  id?: string; // present for existing items, absent for new
  title: string;
  instructions: string;
  requiredPhotoCount: number;
  requiresNote: boolean;
  isRequired: boolean;
}

interface ItemWithKey extends TemplateItemDraft {
  _localKey: string;
}

let localKeyCounter = 0;
const nextLocalKey = () => `local-${++localKeyCounter}`;

interface ChecklistTemplateEditorProps {
  mode: "create" | "edit";
  templateId?: string;
  initialName?: string;
  initialDescription?: string;
  initialItems?: TemplateItemDraft[];
}

export function ChecklistTemplateEditor({
  mode,
  templateId,
  initialName = "",
  initialDescription = "",
  initialItems = [],
}: ChecklistTemplateEditorProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [items, setItems] = useState<ItemWithKey[]>(() =>
    initialItems.length > 0
      ? initialItems.map((i) => ({ ...i, _localKey: i.id ?? nextLocalKey() }))
      : [
          {
            _localKey: nextLocalKey(),
            title: "",
            instructions: "",
            requiredPhotoCount: 0,
            requiresNote: false,
            isRequired: true,
          },
        ],
  );
  const [isPending, startTransition] = useTransition();

  const updateItem = (index: number, patch: Partial<TemplateItemDraft>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };
  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        _localKey: nextLocalKey(),
        title: "",
        instructions: "",
        requiredPhotoCount: 0,
        requiresNote: false,
        isRequired: true,
      },
    ]);
  };
  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("Template name is required");
      return;
    }
    const validItems = items.filter((i) => i.title.trim());
    if (validItems.length === 0) {
      toast.error("Add at least one checklist item");
      return;
    }

    startTransition(async () => {
      if (mode === "create") {
        const res = await fetch("/api/jobs/admin/checklist-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || undefined,
            items: validItems.map((i) => ({
              title: i.title.trim(),
              instructions: i.instructions.trim() || undefined,
              requiredPhotoCount: i.requiredPhotoCount,
              requiresNote: i.requiresNote,
              isRequired: i.isRequired,
            })),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error ?? "Failed to create template");
          return;
        }
        toast.success("Template created");
        router.push("/admin/checklist-templates");
        router.refresh();
        return;
      }

      // Edit mode: save metadata + diff items one by one.
      const metaRes = await fetch(`/api/jobs/admin/checklist-templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      });
      if (!metaRes.ok) {
        toast.error("Failed to save template metadata");
        return;
      }

      const initialById = new Map(initialItems.filter((i) => i.id).map((i) => [i.id!, i] as const));
      const currentIds = new Set<string>();

      for (let i = 0; i < validItems.length; i++) {
        const item = validItems[i];
        const payload = {
          title: item.title.trim(),
          instructions: item.instructions.trim() || null,
          requiredPhotoCount: item.requiredPhotoCount,
          requiresNote: item.requiresNote,
          isRequired: item.isRequired,
          sortOrder: i,
        };
        if (item.id) {
          currentIds.add(item.id);
          await fetch(`/api/jobs/admin/checklist-templates/${templateId}/items/${item.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        } else {
          await fetch(`/api/jobs/admin/checklist-templates/${templateId}/items`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        }
      }

      // Delete items the user removed
      for (const [id] of initialById) {
        if (!currentIds.has(id)) {
          await fetch(`/api/jobs/admin/checklist-templates/${templateId}/items/${id}`, {
            method: "DELETE",
          });
        }
      }

      toast.success("Template saved");
      router.refresh();
    });
  };

  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-4">
        <div>
          <Label htmlFor="template-name">Name</Label>
          <Input
            id="template-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Pump Out Service"
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="template-description">Description (optional)</Label>
          <Textarea
            id="template-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short summary of when to use this template"
            className="mt-1.5"
            rows={2}
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Items</h2>
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            Add item
          </Button>
        </div>

        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={item._localKey} className="rounded-lg border bg-card p-4 space-y-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-3">
                  <Input
                    value={item.title}
                    onChange={(e) => updateItem(idx, { title: e.target.value })}
                    placeholder="Item title (e.g. Inspect tank lid)"
                  />
                  <Textarea
                    value={item.instructions}
                    onChange={(e) => updateItem(idx, { instructions: e.target.value })}
                    placeholder="Optional instructions for the tech"
                    rows={2}
                  />
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`photo-${idx}`} className="text-xs text-muted-foreground">
                        Required photos
                      </Label>
                      <Input
                        id={`photo-${idx}`}
                        type="number"
                        min={0}
                        value={item.requiredPhotoCount}
                        onChange={(e) =>
                          updateItem(idx, {
                            requiredPhotoCount: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className="w-20 h-8"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Checkbox
                        id={`requires-note-${idx}`}
                        checked={item.requiresNote}
                        onCheckedChange={(v) => updateItem(idx, { requiresNote: !!v })}
                      />
                      <Label htmlFor={`requires-note-${idx}`} className="text-xs font-normal">
                        Requires note
                      </Label>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Checkbox
                        id={`is-required-${idx}`}
                        checked={item.isRequired}
                        onCheckedChange={(v) => updateItem(idx, { isRequired: !!v })}
                      />
                      <Label htmlFor={`is-required-${idx}`} className="text-xs font-normal">
                        Required to complete
                      </Label>
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeItem(idx)}
                  aria-label="Remove item"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/checklist-templates")}
        >
          Cancel
        </Button>
        <Button type="button" disabled={isPending} onClick={handleSave}>
          {isPending ? "Saving…" : mode === "create" ? "Create template" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
