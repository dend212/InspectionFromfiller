"use client";

import { Camera, ChevronDown, Download, FileText, Loader2, Mail, Phone, X } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

interface SummaryData {
  token: string;
  facilityName: string | null;
  facilityAddress: string | null;
  facilityCity: string | null;
  facilityState: string;
  facilityZip: string | null;
  dateOfInspection: string | null;
  inspectorName: string | null;
  septicTankCondition: string | null;
  disposalWorksCondition: string | null;
  septicTankComments: string | null;
  disposalWorksComments: string | null;
  recommendations: string;
  company: {
    company: string;
    companyAddress: string;
    companyCity: string;
    companyState: string;
    companyZip: string;
    certificationNumber: string;
    registrationNumber: string;
    truckNumber: string;
  };
  contact: {
    phone: string;
    email: string;
  };
  hasPdf: boolean;
  media: {
    signedUrl: string | null;
    type: "photo" | "video";
    label: string | null;
    description: string | null;
  }[];
}

const CONDITION_MAP: Record<string, { label: string; color: string; bgColor: string }> = {
  operational: {
    label: "Operational",
    color: "bg-emerald-500",
    bgColor: "bg-emerald-50 text-emerald-800",
  },
  operational_with_concerns: {
    label: "Operational with Concerns",
    color: "bg-amber-400",
    bgColor: "bg-amber-50 text-amber-800",
  },
  not_operational: {
    label: "Not Operational",
    color: "bg-red-500",
    bgColor: "bg-red-50 text-red-800",
  },
};

function ConditionIndicator({ condition }: { condition: string | null }) {
  const config = condition ? CONDITION_MAP[condition] : null;
  if (!config) {
    return (
      <div className="flex items-center gap-2">
        <span className="size-3 rounded-full bg-stone-300" />
        <span className="text-sm text-stone-400">Not assessed</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5">
      <span className={`size-3.5 rounded-full ${config.color} ring-2 ring-white shadow-sm`} />
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bgColor}`}>
        {config.label}
      </span>
    </div>
  );
}

export function InspectionSummary({ data }: { data: SummaryData }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const photos = data.media.filter((m) => m.type === "photo" && m.signedUrl);
  const videos = data.media.filter((m) => m.type === "video" && m.signedUrl);

  const fullAddress = [data.facilityAddress, data.facilityCity, data.facilityState, data.facilityZip]
    .filter(Boolean)
    .join(", ");

  const formattedDate = data.dateOfInspection
    ? new Date(data.dateOfInspection + "T00:00:00").toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const mailtoSubject = encodeURIComponent(
    `Re: Inspection Report - ${data.facilityAddress || "Property Inspection"}`,
  );

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const res = await fetch(`/api/summary/${data.token}/download`);
      if (!res.ok) {
        throw new Error("Failed to get download link");
      }
      const { downloadUrl } = await res.json();
      window.open(downloadUrl, "_blank");
    } catch {
      // Silently fail — the button shows loading state
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-stone-800">
              {data.facilityName || "Septic System Inspection Report"}
            </h1>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-500">
              {formattedDate && <span>{formattedDate}</span>}
              {fullAddress && <span>{fullAddress}</span>}
              {data.inspectorName && <span>Inspector: {data.inspectorName}</span>}
            </div>
          </div>
          <Image
            src="/sewertime-logo.png"
            alt="SewerTime Septic"
            width={140}
            height={46}
            className="shrink-0"
          />
        </div>
      </header>

      {/* Two-column layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-4 lg:col-span-1">
          {/* PDF Download Card */}
          {data.hasPdf && (
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="group flex w-full items-center gap-4 rounded-xl border border-stone-200 bg-white p-5 text-left shadow-sm transition-all hover:border-stone-300 hover:shadow-md disabled:opacity-60"
            >
              <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600 transition-colors group-hover:bg-red-100">
                {isDownloading ? (
                  <Loader2 className="size-6 animate-spin" />
                ) : (
                  <FileText className="size-6" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-stone-800">Inspection Report</p>
                <p className="text-xs text-stone-500">
                  {isDownloading ? "Preparing download..." : "Click to download PDF"}
                </p>
              </div>
              <Download className="ml-auto size-4 text-stone-400 transition-colors group-hover:text-stone-600" />
            </button>
          )}

          {/* Recommendations */}
          {data.recommendations && (
            <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
                Recommendations
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-stone-700 whitespace-pre-wrap">
                {data.recommendations}
              </p>
            </div>
          )}

          {/* Contact */}
          <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
            <button
              onClick={() => setContactOpen(!contactOpen)}
              className="flex w-full items-center justify-between p-5"
            >
              <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
                Contact Us
              </h2>
              <ChevronDown
                className={`size-4 text-stone-400 transition-transform ${
                  contactOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {contactOpen && (
              <div className="border-t border-stone-100 px-5 pb-5 pt-4 space-y-3">
                <a
                  href={`mailto:${data.contact.email}?subject=${mailtoSubject}`}
                  className="flex items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 transition-colors hover:bg-stone-100"
                >
                  <Mail className="size-4 text-stone-500" />
                  {data.contact.email}
                </a>
                <a
                  href={`tel:+1${data.contact.phone.replace(/\D/g, "")}`}
                  className="flex items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 transition-colors hover:bg-stone-100"
                >
                  <Phone className="size-4 text-stone-500" />
                  {data.contact.phone}
                </a>
                <div className="pt-1 text-xs text-stone-400">
                  <p>{data.company.company}</p>
                  <p>
                    {data.company.companyAddress}, {data.company.companyCity},{" "}
                    {data.company.companyState} {data.company.companyZip}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4 lg:col-span-2">
          {/* Status Indicators */}
          <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-500">
              System Status
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg bg-stone-50 px-4 py-3">
                <span className="text-sm font-medium text-stone-700">Septic Tank</span>
                <ConditionIndicator condition={data.septicTankCondition} />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-stone-50 px-4 py-3">
                <span className="text-sm font-medium text-stone-700">Drainfield</span>
                <ConditionIndicator condition={data.disposalWorksCondition} />
              </div>
            </div>
          </div>

          {/* Inspector Comments */}
          {(data.septicTankComments || data.disposalWorksComments) && (
            <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Inspector Comments
              </h2>
              <div className="space-y-4">
                {data.septicTankComments && (
                  <div>
                    <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400">
                      Septic Tank
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-stone-700 whitespace-pre-wrap">
                      {data.septicTankComments}
                    </p>
                  </div>
                )}
                {data.septicTankComments && data.disposalWorksComments && (
                  <hr className="border-stone-100" />
                )}
                {data.disposalWorksComments && (
                  <div>
                    <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400">
                      Drainfield
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-stone-700 whitespace-pre-wrap">
                      {data.disposalWorksComments}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Photo & Video Gallery */}
      {(photos.length > 0 || videos.length > 0) && (
        <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
            <Camera className="size-4" />
            Inspection Photos
            <span className="ml-1 text-xs font-normal normal-case text-stone-400">
              ({photos.length + videos.length})
            </span>
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((photo, i) => (
              <button
                key={i}
                onClick={() => setLightboxIndex(i)}
                className="group relative aspect-square overflow-hidden rounded-lg border border-stone-200 bg-stone-100"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.signedUrl!}
                  alt={photo.description || `Inspection photo ${i + 1}`}
                  className="size-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />
                {photo.description && (
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-2 pt-6">
                    <p className="text-xs text-white line-clamp-2">{photo.description}</p>
                  </div>
                )}
              </button>
            ))}
            {videos.map((video, i) => (
              <div
                key={`video-${i}`}
                className="relative aspect-square overflow-hidden rounded-lg border border-stone-200 bg-stone-900"
              >
                <video
                  src={video.signedUrl!}
                  className="size-full object-cover"
                  controls
                  preload="metadata"
                />
                {video.description && (
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-2 pt-6">
                    <p className="text-xs text-white line-clamp-2">{video.description}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && photos[lightboxIndex] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxIndex(null)}
        >
          <button
            onClick={() => setLightboxIndex(null)}
            className="absolute top-4 right-4 rounded-full bg-white/20 p-2 text-white transition-colors hover:bg-white/30"
          >
            <X className="size-5" />
          </button>
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photos[lightboxIndex].signedUrl!}
              alt={photos[lightboxIndex].description || "Inspection photo"}
              className="max-h-[85vh] max-w-full rounded-lg object-contain"
            />
            {photos[lightboxIndex].description && (
              <p className="mt-2 text-center text-sm text-white/80">
                {photos[lightboxIndex].description}
              </p>
            )}
            {photos.length > 1 && (
              <div className="mt-3 flex justify-center gap-3">
                <button
                  onClick={() => setLightboxIndex((lightboxIndex - 1 + photos.length) % photos.length)}
                  className="rounded-full bg-white/20 px-4 py-1.5 text-sm text-white hover:bg-white/30"
                >
                  Prev
                </button>
                <span className="py-1.5 text-sm text-white/60">
                  {lightboxIndex + 1} / {photos.length}
                </span>
                <button
                  onClick={() => setLightboxIndex((lightboxIndex + 1) % photos.length)}
                  className="rounded-full bg-white/20 px-4 py-1.5 text-sm text-white hover:bg-white/30"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-10 border-t border-stone-200 pt-6 text-center text-xs text-stone-400">
        <p>{data.company.company}</p>
        <p className="mt-0.5">
          {data.company.certificationNumber} | {data.company.registrationNumber}
        </p>
      </footer>
    </div>
  );
}
