"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AppRole } from "@/types/roles";

interface NewJobFormProps {
  templates: Array<{ id: string; name: string }>;
  assignees: Array<{ id: string; fullName: string }>;
  currentUser: { id: string; fullName: string };
  role: AppRole;
}

export function NewJobForm({ templates, assignees, currentUser, role }: NewJobFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Default for field techs: pre-assign themselves. Admin/office_staff start
  // unassigned so they can deliberately choose (or leave it unassigned).
  const initialAssignees = role === "field_tech" ? [currentUser.id] : [];
  const [form, setForm] = useState({
    title: "",
    templateId: "",
    assignees: initialAssignees,
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    serviceAddress: "",
    city: "",
    state: "AZ",
    zip: "",
  });

  const update = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  // Assignee name lookup for the chip display
  const assigneeLookup = new Map(assignees.map((a) => [a.id, a.fullName] as const));
  assigneeLookup.set(currentUser.id, currentUser.fullName);

  const addAssignee = (id: string) => {
    if (!id || form.assignees.includes(id)) return;
    update({ assignees: [...form.assignees, id] });
  };
  const removeAssignee = (id: string) => {
    update({ assignees: form.assignees.filter((a) => a !== id) });
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error("Job title is required");
      return;
    }

    startTransition(async () => {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          templateId: form.templateId || undefined,
          assignees: form.assignees,
          customerName: form.customerName.trim() || undefined,
          customerEmail: form.customerEmail.trim() || undefined,
          customerPhone: form.customerPhone.trim() || undefined,
          serviceAddress: form.serviceAddress.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim() || "AZ",
          zip: form.zip.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Failed to create job");
        return;
      }
      const { job } = await res.json();
      toast.success("Job created");
      router.push(`/jobs/${job.id}`);
    });
  };

  // Options still addable: not already selected
  const availableToAdd = assignees.filter((a) => !form.assignees.includes(a.id));

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="space-y-4">
        <div>
          <Label htmlFor="title">Job title</Label>
          <Input
            id="title"
            value={form.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="e.g. Pump out service — 123 Main St"
            className="mt-1.5"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="template">Checklist template</Label>
            <select
              id="template"
              value={form.templateId}
              onChange={(e) => update({ templateId: e.target.value })}
              className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">(None — start blank)</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="assignee">
              Assigned techs
              <span className="ml-1 font-normal text-muted-foreground">(empty = any tech)</span>
            </Label>
            {role === "field_tech" ? (
              <Input id="assignee" value={currentUser.fullName} disabled className="mt-1.5" />
            ) : (
              <div className="mt-1.5 space-y-2">
                {/* Chips for selected assignees */}
                {form.assignees.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {form.assignees.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                      >
                        {assigneeLookup.get(id) ?? "Unknown"}
                        <button
                          type="button"
                          onClick={() => removeAssignee(id)}
                          className="rounded-full p-0.5 hover:bg-primary/20"
                          aria-label={`Remove ${assigneeLookup.get(id) ?? "tech"}`}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs italic text-muted-foreground">
                    Unassigned — any field tech can pick it up.
                  </p>
                )}
                {/* Add-another dropdown */}
                {availableToAdd.length > 0 && (
                  <select
                    id="assignee"
                    value=""
                    onChange={(e) => {
                      addAssignee(e.target.value);
                      // Reset to placeholder so the same option can be re-picked later
                      e.currentTarget.value = "";
                    }}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">+ Add tech…</option>
                    {availableToAdd.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.fullName}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Customer & Location
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="customerName">Customer name</Label>
            <Input
              id="customerName"
              value={form.customerName}
              onChange={(e) => update({ customerName: e.target.value })}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="customerPhone">Phone</Label>
            <Input
              id="customerPhone"
              value={form.customerPhone}
              onChange={(e) => update({ customerPhone: e.target.value })}
              className="mt-1.5"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="customerEmail">Email</Label>
            <Input
              id="customerEmail"
              type="email"
              value={form.customerEmail}
              onChange={(e) => update({ customerEmail: e.target.value })}
              className="mt-1.5"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="serviceAddress">Service address</Label>
            <div className="mt-1.5">
              <AddressAutocomplete
                id="serviceAddress"
                value={form.serviceAddress}
                onChange={(text) => update({ serviceAddress: text })}
                onPlaceSelected={({ street, city, state, zip }) =>
                  update({
                    serviceAddress: street,
                    city: city || form.city,
                    state: state || form.state,
                    zip: zip || form.zip,
                  })
                }
                placeholder="Start typing an address…"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              value={form.city}
              onChange={(e) => update({ city: e.target.value })}
              className="mt-1.5"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={form.state}
                maxLength={2}
                onChange={(e) => update({ state: e.target.value.toUpperCase() })}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="zip">Zip</Label>
              <Input
                id="zip"
                value={form.zip}
                onChange={(e) => update({ zip: e.target.value })}
                className="mt-1.5"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push("/jobs")}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creating…" : "Create job"}
        </Button>
      </div>
    </form>
  );
}
