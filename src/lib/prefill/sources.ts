import type { PrefillSource } from "./types";

export interface SourceMeta {
  label: string;
  /** Tailwind classes for the badge dot */
  dotClass: string;
  /** Tailwind classes for chips/borders */
  accentClass: string;
}

export const SOURCE_META: Record<PrefillSource, SourceMeta> = {
  assessor: { label: "County Assessor", dotClass: "bg-blue-500", accentClass: "border-blue-300 text-blue-800 bg-blue-50" },
  permit: { label: "Permit records", dotClass: "bg-amber-500", accentClass: "border-amber-300 text-amber-900 bg-amber-50" },
  listing: { label: "Listing", dotClass: "bg-violet-500", accentClass: "border-violet-300 text-violet-900 bg-violet-50" },
  scan: { label: "Scanned form", dotClass: "bg-green-600", accentClass: "border-green-300 text-green-900 bg-green-50" },
};

export const EDITED_DOT_CLASS = "bg-gray-400";
export const VERIFIED_DOT_CLASS = "bg-emerald-600";
