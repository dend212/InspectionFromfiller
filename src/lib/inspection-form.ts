import type { InspectionFormData } from "@/types/inspection";

/**
 * Identity/contact fields in the alternativeSystem subtree that getDefaultFormValues
 * pre-fills for every new inspection (inspector name, company). They are NOT evidence
 * that the tech actually filled in alt-system content, so they're skipped when
 * deciding whether to auto-enable the addendum pages.
 */
const AUTO_PREFILLED_ALT_KEYS = new Set([
  "qualifiedInspector",
  "contactName",
  "altPrintedName",
  "orgResponsible",
]);

/**
 * Returns true if the alternativeSystem subtree has any meaningful (non-default) value.
 * Used to recover the includeAlternativePages flag if it gets lost upstream (e.g.
 * after an inspection round-trips through admin review and is returned to the tech).
 */
export function hasAlternativeSystemData(
  formData: InspectionFormData | null | undefined,
): boolean {
  const as = formData?.alternativeSystem;
  if (!as) return false;
  return Object.entries(as).some(([key, v]) => {
    if (AUTO_PREFILLED_ALT_KEYS.has(key)) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "boolean") return v === true;
    return false;
  });
}

/**
 * Normalize a loaded inspection form so the includeAlternativePages flag reflects
 * the actual presence of alt-system data. Preserves all other fields verbatim.
 * Returns null if formData is null (caller should fall back to defaults).
 */
export function normalizeIncludeAlternativePages(
  formData: InspectionFormData | null | undefined,
): InspectionFormData | null {
  if (!formData) return null;
  const explicitlyOn = formData.includeAlternativePages === true;
  const altDataPresent = hasAlternativeSystemData(formData);
  return {
    ...formData,
    includeAlternativePages: explicitlyOn || altDataPresent,
  };
}
