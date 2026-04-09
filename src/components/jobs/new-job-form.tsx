"use client";

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
  const [form, setForm] = useState({
    title: "",
    templateId: "",
    assignedTo: role === "field_tech" ? currentUser.id : currentUser.id,
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    serviceAddress: "",
    city: "",
    state: "AZ",
    zip: "",
  });

  const update = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

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
          assignedTo: form.assignedTo,
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
            <Label htmlFor="assignee">Assigned tech</Label>
            {role === "field_tech" ? (
              <Input id="assignee" value={currentUser.fullName} disabled className="mt-1.5" />
            ) : (
              <select
                id="assignee"
                value={form.assignedTo}
                onChange={(e) => update({ assignedTo: e.target.value })}
                className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.fullName}
                  </option>
                ))}
              </select>
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
