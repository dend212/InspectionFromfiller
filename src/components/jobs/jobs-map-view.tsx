"use client";

import { Loader2, MapPin } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { loadGoogleMapsForMapView } from "@/lib/google-maps-loader";

export interface JobMapItem {
  id: string;
  title: string;
  status: "open" | "in_progress" | "completed";
  customerName: string | null;
  serviceAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** Ordered list of assignee display names. Empty = unassigned. */
  assigneeNames: string[];
}

function formatAssignees(names: string[]): string {
  if (names.length === 0) return "Unassigned";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, ${names[1]}`;
  return `${names[0]} +${names.length - 1}`;
}

interface JobsMapViewProps {
  jobs: JobMapItem[];
}

/** Default center (SewerTime HQ, Cave Creek AZ) used when no jobs are geocoded. */
const DEFAULT_CENTER = { lat: 33.8337, lng: -111.9509 };
const DEFAULT_ZOOM = 10;
const CACHE_KEY_PREFIX = "sewertime:geocode:v1:";

interface GeocodeCacheEntry {
  lat: number;
  lng: number;
  formattedAddress?: string;
}

const STATUS_LABELS: Record<JobMapItem["status"], string> = {
  open: "Open",
  in_progress: "In Progress",
  completed: "Completed",
};

const STATUS_PIN_COLORS: Record<JobMapItem["status"], string> = {
  open: "#64748b", // slate-500
  in_progress: "#2563eb", // blue-600
  completed: "#10b981", // emerald-500
};

function buildFullAddress(job: JobMapItem): string | null {
  const parts = [job.serviceAddress, job.city, job.state, job.zip].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(", ");
}

function readCache(address: string): GeocodeCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY_PREFIX + address);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GeocodeCacheEntry;
    if (typeof parsed?.lat === "number" && typeof parsed?.lng === "number") return parsed;
    return null;
  } catch {
    return null;
  }
}

function writeCache(address: string, entry: GeocodeCacheEntry): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CACHE_KEY_PREFIX + address, JSON.stringify(entry));
  } catch {
    // Quota or disabled — ignore; cache is best-effort.
  }
}

/** Promisified single-address geocode via the loaded Google Geocoder. */
function geocodeOne(
  geocoder: google.maps.Geocoder,
  address: string,
): Promise<GeocodeCacheEntry | null> {
  return new Promise((resolve) => {
    geocoder.geocode({ address }, (results, status) => {
      if (status === "OK" && results && results[0]) {
        const loc = results[0].geometry.location;
        resolve({
          lat: loc.lat(),
          lng: loc.lng(),
          formattedAddress: results[0].formatted_address,
        });
        return;
      }
      resolve(null);
    });
  });
}

function statusPinSvgUrl(status: JobMapItem["status"]): string {
  const color = STATUS_PIN_COLORS[status];
  // Simple teardrop pin with a white dot in the middle.
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">
  <path d="M16 0 C7.2 0 0 7.2 0 16 C0 28 16 42 16 42 C16 42 32 28 32 16 C32 7.2 24.8 0 16 0 Z"
        fill="${color}" stroke="#ffffff" stroke-width="2"/>
  <circle cx="16" cy="15" r="5" fill="#ffffff"/>
</svg>`.trim();
  return `data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`;
}

export function JobsMapView({ jobs }: JobsMapViewProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [geocodedCount, setGeocodedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [geocoding, setGeocoding] = useState(false);

  const jobsWithAddress = useMemo(
    () =>
      jobs
        .map((j) => ({ job: j, address: buildFullAddress(j) }))
        .filter((x): x is { job: JobMapItem; address: string } => !!x.address),
    [jobs],
  );

  // One-time map bootstrap
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const maps = await loadGoogleMapsForMapView();
      if (cancelled) return;
      if (!maps || !mapRef.current) {
        setStatus("unavailable");
        return;
      }
      mapInstanceRef.current = new maps.Map(mapRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        clickableIcons: false,
      });
      infoWindowRef.current = new maps.InfoWindow();
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
      // Clear existing markers on unmount
      for (const m of markersRef.current) m.setMap(null);
      markersRef.current = [];
    };
  }, []);

  // Geocode + render markers whenever the map is ready OR the job list changes
  useEffect(() => {
    if (status !== "ready") return;
    const map = mapInstanceRef.current;
    const infoWindow = infoWindowRef.current;
    if (!map || !infoWindow) return;
    if (typeof google === "undefined") return;

    // Reset existing markers on re-render
    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];
    setGeocodedCount(0);
    setFailedCount(0);

    if (jobsWithAddress.length === 0) return;

    const geocoder = new google.maps.Geocoder();
    const bounds = new google.maps.LatLngBounds();
    let cancelled = false;
    let successes = 0;
    let failures = 0;

    setGeocoding(true);

    (async () => {
      for (const { job, address } of jobsWithAddress) {
        if (cancelled) return;

        let entry = readCache(address);
        if (!entry) {
          entry = await geocodeOne(geocoder, address);
          if (entry) writeCache(address, entry);
          // Gentle throttle — Google allows ~50 QPS but we keep it polite
          // and avoid bursts of flashing markers.
          await new Promise((r) => setTimeout(r, 120));
        }
        if (cancelled) return;

        if (!entry) {
          failures += 1;
          setFailedCount(failures);
          continue;
        }

        const position = { lat: entry.lat, lng: entry.lng };
        const marker = new google.maps.Marker({
          position,
          map,
          title: job.title,
          icon: {
            url: statusPinSvgUrl(job.status),
            scaledSize: new google.maps.Size(32, 42),
            anchor: new google.maps.Point(16, 42),
          },
        });

        marker.addListener("click", () => {
          const fullAddress = entry?.formattedAddress ?? address;
          const statusLabel = STATUS_LABELS[job.status];
          const statusColor = STATUS_PIN_COLORS[job.status];
          const customerRow = job.customerName
            ? `<div style="margin-top:2px;color:#475569">${escapeHtml(job.customerName)}</div>`
            : "";
          const assigneeLabel = formatAssignees(job.assigneeNames);
          const assigneeRow =
            job.assigneeNames.length > 0
              ? `<div style="margin-top:6px;color:#64748b;font-size:11px">${
                  job.assigneeNames.length > 1 ? "Techs" : "Tech"
                }: ${escapeHtml(assigneeLabel)}</div>`
              : `<div style="margin-top:6px;color:#64748b;font-size:11px;font-style:italic">Unassigned — open to all techs</div>`;
          infoWindow.setContent(
            `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:240px;padding:2px 4px">
              <div style="display:flex;align-items:flex-start;gap:8px;justify-content:space-between">
                <div style="font-weight:600;color:#0f172a;font-size:14px;line-height:1.3">${escapeHtml(job.title)}</div>
                <span style="flex-shrink:0;background:${statusColor};color:#fff;font-size:10px;font-weight:600;padding:2px 6px;border-radius:9999px;text-transform:uppercase;letter-spacing:0.04em">${escapeHtml(statusLabel)}</span>
              </div>
              ${customerRow}
              <div style="margin-top:6px;color:#64748b;font-size:12px;line-height:1.35">${escapeHtml(fullAddress)}</div>
              ${assigneeRow}
              <div style="margin-top:8px">
                <a href="/jobs/${encodeURIComponent(job.id)}" style="display:inline-block;background:#0f172a;color:#fff;font-size:12px;font-weight:600;padding:6px 10px;border-radius:6px;text-decoration:none">Open job →</a>
              </div>
            </div>`,
          );
          infoWindow.open({ map, anchor: marker });
        });

        markersRef.current.push(marker);
        bounds.extend(position);
        successes += 1;
        setGeocodedCount(successes);

        if (successes === 1) {
          // Snap to the first result so the map isn't stuck on the default
          // center while we wait for the rest to resolve.
          map.panTo(position);
          map.setZoom(12);
        } else if (successes > 1) {
          map.fitBounds(bounds, 64);
        }
      }

      if (!cancelled) setGeocoding(false);
    })();

    return () => {
      cancelled = true;
      setGeocoding(false);
    };
  }, [status, jobsWithAddress]);

  const unmappableCount = jobs.length - jobsWithAddress.length;

  if (status === "unavailable") {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 p-10 text-center">
        <MapPin className="mx-auto size-8 text-muted-foreground" />
        <h3 className="mt-3 text-base font-semibold">Map unavailable</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Google Maps couldn&apos;t load. Check that{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
          </code>{" "}
          is set and the Maps JavaScript + Geocoding APIs are enabled.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/jobs">Back to jobs list</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-slate-500" /> Open
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-blue-600" /> In progress
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-emerald-500" /> Completed
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {geocoding ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="size-3 animate-spin" />
              Locating {geocodedCount + failedCount} / {jobsWithAddress.length}…
            </span>
          ) : (
            <span>
              {geocodedCount} mapped
              {failedCount > 0 && <>, {failedCount} couldn&apos;t be located</>}
              {unmappableCount > 0 && <>, {unmappableCount} missing address</>}
            </span>
          )}
        </div>
      </div>

      <div
        ref={mapRef}
        className="h-[calc(100svh-260px)] min-h-[420px] w-full overflow-hidden rounded-lg border bg-muted"
      />
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
