/**
 * Maricopa County APNs are book-map-parcel[split]: `NNN-NN-NNN` with an
 * optional trailing letter (219-11-121, 218-49-003B). The EDMS archives only
 * match the dashed form (`21911121` returns 0 rows), the assessor accepts
 * either — so everything downstream normalises through here.
 *
 * Returns null when the input is not an APN.
 */
export function formatApn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const match = /^(\d{3})(\d{2})(\d{3})([A-Z]?)$/.exec(compact);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}${match[4]}`;
}
