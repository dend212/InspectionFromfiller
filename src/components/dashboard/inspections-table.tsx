"use client";

import { ArrowUpDown, Check, Download, Eye, Trash2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface InspectionRow {
  id: string;
  facilityAddress: string | null;
  customerName: string | null;
  status: string;
  inspectorName: string;
  createdAt: string; // ISO string
  completedAt: string | null;
  finalizedPdfPath: string | null;
  emailSentCount: number;
  isFromWorkiz: boolean;
}

interface InspectionsTableProps {
  inspections: InspectionRow[];
  sortColumn: string;
  sortOrder: string;
  isPrivileged: boolean;
  page: number;
  totalPages: number;
  totalCount: number;
}

const SORTABLE_COLUMNS = [
  { key: "address", label: "Address" },
  { key: "date", label: "Date" },
  { key: "customer", label: "Customer Name" },
  { key: "status", label: "Status" },
] as const;

function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(isoString));
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "draft":
      return <Badge variant="secondary">Draft</Badge>;
    case "submitted":
    case "in_review":
      return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-200">In Review</Badge>;
    case "completed":
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-200">Complete</Badge>;
    case "sent":
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-200">Sent</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

const PAGE_SIZE = 20;

export function InspectionsTable({
  inspections,
  sortColumn,
  sortOrder,
  isPrivileged,
  page,
  totalPages,
  totalCount,
}: InspectionsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Prune stale IDs when inspections list changes (e.g. after delete + refresh)
  useEffect(() => {
    const currentIds = new Set(inspections.map((i) => i.id));
    setSelectedIds((prev) => {
      const pruned = new Set([...prev].filter((id) => currentIds.has(id)));
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [inspections]);

  const allSelected = inspections.length > 0 && inspections.every((i) => selectedIds.has(i.id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(inspections.map((i) => i.id)));
    }
  }, [allSelected, inspections]);

  const handleSelectOne = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const handleDeselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  function handleSort(column: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (sortColumn === column) {
      // Toggle direction
      params.set("order", sortOrder === "asc" ? "desc" : "asc");
    } else {
      params.set("sort", column);
      params.set("order", "asc");
    }
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`);
  }

  function handleRowClick(inspection: InspectionRow) {
    if (inspection.status === "draft") {
      router.push(`/inspections/${inspection.id}/edit`);
    } else if (isPrivileged) {
      router.push(`/review/${inspection.id}`);
    } else {
      router.push(`/inspections/${inspection.id}`);
    }
  }

  async function handleDownload(e: React.MouseEvent, inspectionId: string) {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/download`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.downloadUrl) {
        window.open(data.downloadUrl, "_blank");
      }
    } catch {
      // Silently fail -- download is best-effort
    }
  }

  async function handleDelete(e: React.MouseEvent, inspectionId: string) {
    e.stopPropagation();
    if (!window.confirm("Delete this inspection? This cannot be undone.")) {
      return;
    }
    try {
      const res = await fetch(`/api/inspections/${inspectionId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to delete inspection");
        return;
      }
      toast.success("Inspection deleted");
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(inspectionId);
        return next;
      });
      router.refresh();
    } catch {
      toast.error("Failed to delete inspection");
    }
  }

  async function handleBulkDelete() {
    const idsToDelete = Array.from(selectedIds);

    if (idsToDelete.length === 0) {
      toast.error("No inspections selected to delete");
      setShowDeleteDialog(false);
      return;
    }

    setIsDeleting(true);
    try {
      const res = await fetch("/api/inspections/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: idsToDelete }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to delete inspections");
        return;
      }

      const data = await res.json();
      toast.success(`Deleted ${data.deletedCount} inspection(s)`);
      setSelectedIds(new Set());
      router.refresh();
    } catch {
      toast.error("Failed to delete inspections");
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  }

  function handlePageChange(newPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (newPage <= 1) {
      params.delete("page");
    } else {
      params.set("page", String(newPage));
    }
    setSelectedIds(new Set());
    router.replace(`${pathname}?${params.toString()}`);
  }

  function handleClearFilters() {
    setSelectedIds(new Set());
    router.replace(pathname);
  }

  if (inspections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border py-16">
        <p className="text-lg font-medium text-muted-foreground">No inspections found</p>
        <p className="mt-1 text-sm text-muted-foreground">Try adjusting your search or filters</p>
        <Button variant="outline" className="mt-4" onClick={handleClearFilters}>
          Clear Filters
        </Button>
      </div>
    );
  }

  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, totalCount);

  return (
    <div className="space-y-4">
      {/* Floating action bar when items are selected */}
      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-20 flex items-center gap-3 rounded-lg border bg-background/95 px-4 py-3 shadow-md backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleDeselectAll}>
              <X className="size-3.5" />
              Deselect All
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="size-3.5" />
              Delete Selected ({selectedIds.size})
            </Button>
          </div>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40px]">
              <Checkbox
                checked={someSelected ? "indeterminate" : allSelected}
                onCheckedChange={handleSelectAll}
                aria-label="Select all inspections"
              />
            </TableHead>
            {SORTABLE_COLUMNS.map((col) => (
              <TableHead key={col.key}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  <ArrowUpDown className="size-3.5" />
                </button>
              </TableHead>
            ))}
            <TableHead>Inspector</TableHead>
            <TableHead>Sent</TableHead>
            <TableHead className="w-[80px]">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {inspections.map((inspection) => (
            <TableRow
              key={inspection.id}
              className={`cursor-pointer ${selectedIds.has(inspection.id) ? "bg-muted/50" : ""}`}
              onClick={() => handleRowClick(inspection)}
            >
              <TableCell onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={selectedIds.has(inspection.id)}
                  onCheckedChange={(checked) => handleSelectOne(inspection.id, checked === true)}
                  aria-label={`Select inspection at ${
                    inspection.facilityAddress || "unknown address"
                  }`}
                />
              </TableCell>
              <TableCell className="max-w-[200px] truncate">
                {inspection.facilityAddress || "No address"}
              </TableCell>
              <TableCell>{formatDate(inspection.createdAt)}</TableCell>
              <TableCell className="max-w-[150px] truncate">
                {inspection.customerName || "\u2014"}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <StatusBadge status={inspection.status} />
                  {inspection.isFromWorkiz && (
                    <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200 text-[10px] px-1.5 py-0">
                      Workiz
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>{inspection.inspectorName}</TableCell>
              <TableCell>
                {inspection.emailSentCount > 0 ? (
                  <span className="inline-flex items-center gap-1 text-green-600">
                    <Check className="size-4" />
                    {inspection.emailSentCount}
                  </span>
                ) : inspection.finalizedPdfPath ? (
                  <span className="text-muted-foreground text-sm">Ready</span>
                ) : (
                  "\u2014"
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 [tr:hover_&]:opacity-100">
                  {(inspection.status === "completed" || inspection.status === "sent") &&
                    inspection.finalizedPdfPath && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={(e) => handleDownload(e, inspection.id)}
                        title="Download PDF"
                      >
                        <Download className="size-3.5" />
                        <span className="sr-only">Download</span>
                      </Button>
                    )}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/inspections/${inspection.id}`);
                    }}
                    title="View inspection"
                  >
                    <Eye className="size-3.5" />
                    <span className="sr-only">View</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => handleDelete(e, inspection.id)}
                    title="Delete inspection"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                    <span className="sr-only">Delete</span>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Pagination */}
      <div className="flex items-center justify-between px-2">
        <p className="text-sm text-muted-foreground">
          Showing {start}&ndash;{end} of {totalCount}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => handlePageChange(page - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => handlePageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Bulk delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.size} inspection{selectedIds.size !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. Selected inspections and their associated
              reports will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                handleBulkDelete();
              }}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
