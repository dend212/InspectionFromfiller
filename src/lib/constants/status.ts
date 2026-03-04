/**
 * Centralized status display configuration.
 * Uses CSS custom properties defined in globals.css for consistent theming.
 */

export const STATUS_CONFIG = {
  draft: {
    label: "Draft",
    className: "bg-status-draft text-status-draft-foreground",
  },
  submitted: {
    label: "In Review",
    className: "bg-status-review text-status-review-foreground",
  },
  in_review: {
    label: "In Review",
    className: "bg-status-review text-status-review-foreground",
  },
  completed: {
    label: "Completed",
    className: "bg-status-complete text-status-complete-foreground",
  },
  sent: {
    label: "Sent",
    className: "bg-status-success text-status-success-foreground",
  },
} as const;

export const WORKIZ_BADGE_CLASS = "bg-status-warning text-status-warning-foreground";

export type InspectionStatus = keyof typeof STATUS_CONFIG;

export function getStatusConfig(status: string) {
  return STATUS_CONFIG[status as InspectionStatus] ?? {
    label: status,
    className: "bg-status-draft text-status-draft-foreground",
  };
}
