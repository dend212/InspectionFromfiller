/**
 * In-app route for an inspection, the routing of handleRowClick in
 * src/components/dashboard/inspections-table.tsx: drafts open the wizard, everything else the
 * review editor for admin/office staff and the read-only view for the field-tech owner.
 */
export function inspectionPath(id: string, status: string, privileged: boolean): string {
  if (status === "draft") return `/inspections/${id}/edit`;
  return privileged ? `/review/${id}` : `/inspections/${id}`;
}
