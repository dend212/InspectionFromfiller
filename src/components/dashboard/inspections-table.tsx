"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ArrowUpDown, Check, Download, Eye, Trash2 } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

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
      return (
        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-200">
          In Review
        </Badge>
      );
    case "completed":
      return (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-200">
          Complete
        </Badge>
      );
    case "sent":
      return (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-200">
          Sent
        </Badge>
      );
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

  async function handleDownload(
    e: React.MouseEvent,
    inspectionId: string
  ) {
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
    if (!window.confirm("Delete this draft inspection? This cannot be undone.")) {
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
      toast.success("Draft inspection deleted");
      router.refresh();
    } catch {
      toast.error("Failed to delete inspection");
    }
  }

  function handlePageChange(newPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (newPage <= 1) {
      params.delete("page");
    } else {
      params.set("page", String(newPage));
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  function handleClearFilters() {
    router.replace(pathname);
  }

  if (inspections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border py-16">
        <p className="text-lg font-medium text-muted-foreground">
          No inspections found
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Try adjusting your search or filters
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={handleClearFilters}
        >
          Clear Filters
        </Button>
      </div>
    );
  }

  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, totalCount);

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
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
              className="cursor-pointer"
              onClick={() => handleRowClick(inspection)}
            >
              <TableCell className="max-w-[200px] truncate">
                {inspection.facilityAddress || "No address"}
              </TableCell>
              <TableCell>{formatDate(inspection.createdAt)}</TableCell>
              <TableCell className="max-w-[150px] truncate">
                {inspection.customerName || "\u2014"}
              </TableCell>
              <TableCell>
                <StatusBadge status={inspection.status} />
              </TableCell>
              <TableCell>{inspection.inspectorName}</TableCell>
              <TableCell>
                {inspection.emailSentCount > 0 ? (
                  <span className="inline-flex items-center gap-1 text-green-600">
                    <Check className="size-4" />
                    {inspection.emailSentCount}
                  </span>
                ) : inspection.finalizedPdfPath ? (
                  <span className="text-muted-foreground text-sm">
                    Ready
                  </span>
                ) : (
                  "\u2014"
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 [tr:hover_&]:opacity-100">
                  {(inspection.status === "completed" ||
                    inspection.status === "sent") &&
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
                  {inspection.status === "draft" && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={(e) => handleDelete(e, inspection.id)}
                      title="Delete draft"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                      <span className="sr-only">Delete</span>
                    </Button>
                  )}
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
    </div>
  );
}
