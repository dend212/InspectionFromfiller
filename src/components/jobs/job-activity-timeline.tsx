"use client";

import {
  CheckCircle2,
  Circle,
  FilePlus,
  FileText,
  History,
  ImagePlus,
  Link as LinkIcon,
  ListChecks,
  ListPlus,
  Mail,
  RotateCcw,
  Trash2,
  UserCog,
} from "lucide-react";
import { useEffect, useState } from "react";

interface ActivityEntry {
  id: string;
  eventType: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  actorName: string;
}

interface JobActivityTimelineProps {
  jobId: string;
  /**
   * Parent can pass a refreshKey (any monotonically-changing value) to
   * force the timeline to re-fetch — e.g. after the parent knows an
   * optimistic local update has landed on the server.
   */
  refreshKey?: number;
}

const EVENT_META: Record<string, { Icon: typeof Circle; iconClass: string; label: string }> = {
  "job.created": {
    Icon: FilePlus,
    iconClass: "bg-blue-100 text-blue-700",
    label: "Job created",
  },
  "job.status_changed": {
    Icon: Circle,
    iconClass: "bg-slate-100 text-slate-700",
    label: "Status changed",
  },
  "job.reopened": {
    Icon: RotateCcw,
    iconClass: "bg-amber-100 text-amber-700",
    label: "Reopened",
  },
  "job.assignees_changed": {
    Icon: UserCog,
    iconClass: "bg-indigo-100 text-indigo-700",
    label: "Assignees changed",
  },
  "job.finalized": {
    Icon: CheckCircle2,
    iconClass: "bg-emerald-100 text-emerald-700",
    label: "Finalized",
  },
  "job.notes_updated": {
    Icon: FileText,
    iconClass: "bg-slate-100 text-slate-700",
    label: "Notes updated",
  },
  "job.customer_summary_generated": {
    Icon: FileText,
    iconClass: "bg-purple-100 text-purple-700",
    label: "Summary generated",
  },
  "checklist.item_added": {
    Icon: ListPlus,
    iconClass: "bg-sky-100 text-sky-700",
    label: "Checklist item added",
  },
  "checklist.item_updated": {
    Icon: ListChecks,
    iconClass: "bg-sky-100 text-sky-700",
    label: "Checklist item edited",
  },
  "checklist.item_status_changed": {
    Icon: CheckCircle2,
    iconClass: "bg-emerald-100 text-emerald-700",
    label: "Checklist item status",
  },
  "checklist.item_deleted": {
    Icon: Trash2,
    iconClass: "bg-rose-100 text-rose-700",
    label: "Checklist item deleted",
  },
  "media.added": {
    Icon: ImagePlus,
    iconClass: "bg-cyan-100 text-cyan-700",
    label: "Media added",
  },
  "media.removed": {
    Icon: Trash2,
    iconClass: "bg-rose-100 text-rose-700",
    label: "Media removed",
  },
  "media.visibility_changed": {
    Icon: ImagePlus,
    iconClass: "bg-cyan-100 text-cyan-700",
    label: "Media visibility",
  },
  "summary.link_created": {
    Icon: LinkIcon,
    iconClass: "bg-violet-100 text-violet-700",
    label: "Summary link",
  },
  "summary.email_sent": {
    Icon: Mail,
    iconClass: "bg-teal-100 text-teal-700",
    label: "Summary emailed",
  },
};

function eventMeta(eventType: string) {
  return (
    EVENT_META[eventType] ?? {
      Icon: History,
      iconClass: "bg-slate-100 text-slate-700",
      label: eventType,
    }
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function JobActivityTimeline({ jobId, refreshKey = 0 }: JobActivityTimelineProps) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // refreshKey is intentionally read here (not in deps) so the parent
    // can trigger a refetch without us re-subscribing to a new closure.
    void refreshKey;
    let cancelled = false;
    setError(null);
    fetch(`/api/jobs/${jobId}/activity`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Failed to load activity (${res.status})`);
        }
        return res.json() as Promise<ActivityEntry[]>;
      })
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load activity");
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, refreshKey]);

  if (entries === null && !error) {
    return (
      <section className="rounded-xl border bg-card p-6 space-y-3">
        <h2 className="text-lg font-semibold">Activity</h2>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-xl border bg-card p-6 space-y-3">
        <h2 className="text-lg font-semibold">Activity</h2>
        <p className="text-sm text-destructive">{error}</p>
      </section>
    );
  }

  const visible = expanded ? entries! : (entries ?? []).slice(0, 10);
  const hiddenCount = (entries?.length ?? 0) - visible.length;

  return (
    <section className="rounded-xl border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Activity</h2>
        {entries && entries.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {entries.length} {entries.length === 1 ? "event" : "events"}
          </span>
        )}
      </div>

      {entries && entries.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          No activity recorded yet. Events will appear here as the job progresses.
        </p>
      ) : (
        <ol className="relative space-y-0">
          {/* Vertical rail running through the timeline */}
          <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" aria-hidden="true" />

          {visible.map((entry) => {
            const { Icon, iconClass, label } = eventMeta(entry.eventType);
            return (
              <li key={entry.id} className="relative flex gap-3 py-2">
                <div
                  className={`relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ${iconClass}`}
                  role="img"
                  aria-label={label}
                >
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{entry.summary}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-medium">{entry.actorName}</span>
                    <span className="mx-1.5">·</span>
                    <time
                      dateTime={entry.createdAt}
                      title={new Date(entry.createdAt).toLocaleString()}
                    >
                      {formatTimestamp(entry.createdAt)}
                    </time>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs font-medium text-primary hover:underline"
        >
          Show {hiddenCount} older {hiddenCount === 1 ? "event" : "events"}
        </button>
      )}
      {expanded && entries && entries.length > 10 && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-xs font-medium text-muted-foreground hover:underline"
        >
          Collapse
        </button>
      )}
    </section>
  );
}
