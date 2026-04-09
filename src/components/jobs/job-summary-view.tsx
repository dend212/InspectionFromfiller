import Image from "next/image";

interface JobSummaryItem {
  id: string;
  title: string;
  instructions: string | null;
  status: "pending" | "done" | "skipped";
  note: string | null;
}

interface JobSummaryMedia {
  id: string;
  signedUrl: string | null;
  bucket: "checklist_item" | "general";
  checklistItemId: string | null;
  type: "photo" | "video";
  description: string | null;
}

interface JobSummaryViewProps {
  token: string;
  expiresAt: string;
  job: {
    title: string;
    customerName: string | null;
    serviceAddress: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    completedAt: string | null;
    customerSummary: string;
  };
  assigneeName: string | null;
  items: JobSummaryItem[];
  media: JobSummaryMedia[];
  hasPdf: boolean;
}

function StatusChip({ status }: { status: "pending" | "done" | "skipped" }) {
  const styles: Record<typeof status, string> = {
    done: "bg-emerald-100 text-emerald-800",
    skipped: "bg-amber-100 text-amber-800",
    pending: "bg-slate-100 text-slate-700",
  };
  const labels: Record<typeof status, string> = {
    done: "Done",
    skipped: "Skipped",
    pending: "Pending",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

export function JobSummaryView({
  token,
  job,
  assigneeName,
  items,
  media,
  hasPdf,
}: JobSummaryViewProps) {
  const addressLine = [job.city, job.state, job.zip].filter(Boolean).join(" ");
  const completedDate = job.completedAt
    ? new Date(job.completedAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const generalMedia = media.filter((m) => m.bucket === "general");
  const mediaByItem = new Map<string, JobSummaryMedia[]>();
  for (const m of media) {
    if (m.bucket !== "checklist_item" || !m.checklistItemId) continue;
    const arr = mediaByItem.get(m.checklistItemId) ?? [];
    arr.push(m);
    mediaByItem.set(m.checklistItemId, arr);
  }

  return (
    <div className="min-h-svh bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Service Visit Report
          </p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">{job.title}</h1>
          {job.customerName && <p className="mt-2 text-lg text-slate-600">{job.customerName}</p>}
          {(job.serviceAddress || addressLine) && (
            <p className="text-sm text-slate-500">
              {job.serviceAddress}
              {job.serviceAddress && addressLine ? ", " : ""}
              {addressLine}
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {assigneeName && (
              <div>
                <span className="text-slate-500">Technician: </span>
                <span className="font-medium text-slate-900">{assigneeName}</span>
              </div>
            )}
            {completedDate && (
              <div>
                <span className="text-slate-500">Completed: </span>
                <span className="font-medium text-slate-900">{completedDate}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10 space-y-10">
        {/* Customer summary paragraph */}
        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">Summary</h2>
          <p className="mt-3 whitespace-pre-wrap text-slate-800 leading-relaxed">
            {job.customerSummary}
          </p>
          {hasPdf && (
            <div className="mt-6">
              <a
                href={`/api/public/jobs/summary/${token}/pdf`}
                className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Download PDF Report
              </a>
            </div>
          )}
        </section>

        {/* Checklist items */}
        {items.length > 0 && (
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">Checklist</h2>
            <div className="mt-4 space-y-4">
              {items.map((item) => {
                const photos = mediaByItem.get(item.id) ?? [];
                return (
                  <div key={item.id} className="rounded-xl border bg-white p-6 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
                        {item.instructions && (
                          <p className="mt-1 text-sm italic text-slate-500">{item.instructions}</p>
                        )}
                      </div>
                      <StatusChip status={item.status} />
                    </div>
                    {item.note && (
                      <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{item.note}</p>
                    )}
                    {photos.length > 0 && (
                      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {photos.map((p) => {
                          if (!p.signedUrl) return null;
                          if (p.type === "video") {
                            return (
                              <div
                                key={p.id}
                                className="overflow-hidden rounded-lg border bg-black"
                              >
                                <div className="relative aspect-[4/3] w-full">
                                  <video
                                    src={p.signedUrl}
                                    controls
                                    preload="metadata"
                                    className="absolute inset-0 h-full w-full object-contain"
                                  >
                                    <track kind="captions" />
                                  </video>
                                </div>
                                {p.description && (
                                  <p className="bg-white px-2 py-1 text-[11px] text-slate-600">
                                    {p.description}
                                  </p>
                                )}
                              </div>
                            );
                          }
                          return (
                            <a
                              key={p.id}
                              href={p.signedUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="group block overflow-hidden rounded-lg border bg-slate-100"
                            >
                              <div className="relative aspect-[4/3] w-full">
                                <Image
                                  src={p.signedUrl}
                                  alt={p.description ?? "Job photo"}
                                  fill
                                  sizes="(min-width: 640px) 200px, 45vw"
                                  className="object-cover transition-transform group-hover:scale-[1.02]"
                                  unoptimized
                                />
                              </div>
                              {p.description && (
                                <p className="px-2 py-1 text-[11px] text-slate-600">
                                  {p.description}
                                </p>
                              )}
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Additional media (general, customer-visible only) */}
        {generalMedia.length > 0 && (
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">
              Additional Photos & Videos
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {generalMedia.map((p) => {
                if (!p.signedUrl) return null;
                if (p.type === "video") {
                  return (
                    <div
                      key={p.id}
                      className="overflow-hidden rounded-lg border bg-black shadow-sm"
                    >
                      <div className="relative aspect-square w-full">
                        <video
                          src={p.signedUrl}
                          controls
                          preload="metadata"
                          className="absolute inset-0 h-full w-full object-contain"
                        >
                          <track kind="captions" />
                        </video>
                      </div>
                      {p.description && (
                        <p className="bg-white px-2 py-1 text-[11px] text-slate-600">
                          {p.description}
                        </p>
                      )}
                    </div>
                  );
                }
                return (
                  <a
                    key={p.id}
                    href={p.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="group block overflow-hidden rounded-lg border bg-white shadow-sm"
                  >
                    <div className="relative aspect-square w-full">
                      <Image
                        src={p.signedUrl}
                        alt={p.description ?? "Additional photo"}
                        fill
                        sizes="(min-width: 768px) 200px, 45vw"
                        className="object-cover transition-transform group-hover:scale-[1.02]"
                        unoptimized
                      />
                    </div>
                    {p.description && (
                      <p className="px-2 py-1 text-[11px] text-slate-600">{p.description}</p>
                    )}
                  </a>
                );
              })}
            </div>
          </section>
        )}
      </main>

      <footer className="border-t bg-white">
        <div className="mx-auto max-w-4xl px-6 py-6 text-center text-xs text-slate-500">
          This link is valid for viewing and will expire automatically.
        </div>
      </footer>
    </div>
  );
}
