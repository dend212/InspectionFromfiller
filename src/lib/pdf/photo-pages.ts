/**
 * Photo Page Builder for ADEQ Inspection PDF
 *
 * Builds pdfme page schemas and inputs for a photo appendix:
 * - Photos are grouped by form section (STEP_LABELS order)
 * - 2 photos per page, stacked vertically
 * - Each photo has a caption: "Section Name - Photo N"
 * - First photo page has "Inspection Photos" header
 * - Subsequent pages show the section group name as header
 *
 * Returns a Uint8Array PDF or null if no photos exist.
 */

import type { Template, Schema, Font } from "@pdfme/common";
import { generate } from "@pdfme/generator";
import { text, image } from "@pdfme/schemas";
import type { MediaRecord } from "@/components/inspection/media-gallery";
import { STEP_LABELS } from "@/lib/constants/inspection";
import { createClient } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Blank US Letter page in mm for pdfme basePdf */
const BLANK_PAGE = {
  width: 215.9,
  height: 279.4,
  padding: [10, 10, 10, 10] as [number, number, number, number],
};

/** Photo layout constants (in mm) */
const LAYOUT = {
  pageWidth: 215.9,
  margin: 12,
  headerY: 12,
  headerHeight: 8,
  photo1Y: 24,
  photoWidth: 175,
  photoHeight: 110,
  captionHeight: 6,
  captionGap: 1,
  photoGap: 4,
} as const;

// Computed positions
const PHOTO_X = (LAYOUT.pageWidth - LAYOUT.photoWidth) / 2;
const CAPTION_1_Y = LAYOUT.photo1Y + LAYOUT.photoHeight + LAYOUT.captionGap;
const PHOTO_2_Y =
  CAPTION_1_Y + LAYOUT.captionHeight + LAYOUT.photoGap;
const CAPTION_2_Y = PHOTO_2_Y + LAYOUT.photoHeight + LAYOUT.captionGap;

// ---------------------------------------------------------------------------
// Font loader (reuses same Liberation Sans fonts as main template)
// ---------------------------------------------------------------------------

let cachedFont: Font | null = null;

async function loadFont(): Promise<Font> {
  if (cachedFont) return cachedFont;

  const [regularRes, boldRes] = await Promise.all([
    fetch("/fonts/LiberationSans-Regular.ttf"),
    fetch("/fonts/LiberationSans-Bold.ttf"),
  ]);

  if (!regularRes.ok || !boldRes.ok) {
    throw new Error("Failed to load fonts for photo pages");
  }

  cachedFont = {
    LiberationSans: { data: await regularRes.arrayBuffer(), fallback: true },
    LiberationSansBold: { data: await boldRes.arrayBuffer() },
  };

  return cachedFont;
}

// ---------------------------------------------------------------------------
// Photo data fetching
// ---------------------------------------------------------------------------

/**
 * Fetches a photo from Supabase storage and converts it to a base64 data URL.
 * pdfme's image schema accepts this format.
 */
async function fetchPhotoAsDataUrl(
  storagePath: string,
): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.storage
    .from("inspection-media")
    .createSignedUrl(storagePath, 3600);

  if (!data?.signedUrl) return null;

  try {
    const response = await fetch(data.signedUrl);
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        "",
      ),
    );
    return `data:image/jpeg;base64,${base64}`;
  } catch {
    console.error(`Failed to fetch photo: ${storagePath}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Photo grouping
// ---------------------------------------------------------------------------

interface PhotoGroup {
  sectionLabel: string;
  photos: MediaRecord[];
}

/**
 * Groups photos by their `label` field (section name) in STEP_LABELS order.
 * Photos without labels go into an "Other" group at the end.
 */
function groupPhotosBySection(photos: MediaRecord[]): PhotoGroup[] {
  const groupMap = new Map<string, MediaRecord[]>();

  for (const photo of photos) {
    const key = photo.label ?? "Other";
    const existing = groupMap.get(key) ?? [];
    existing.push(photo);
    groupMap.set(key, existing);
  }

  // Order groups by STEP_LABELS, then append any extras
  const ordered: PhotoGroup[] = [];
  const stepLabelsArray = [...STEP_LABELS];

  for (const label of stepLabelsArray) {
    const groupPhotos = groupMap.get(label);
    if (groupPhotos && groupPhotos.length > 0) {
      ordered.push({ sectionLabel: label, photos: groupPhotos });
      groupMap.delete(label);
    }
  }

  // Append remaining groups (including "Other")
  for (const [label, groupPhotos] of groupMap) {
    if (groupPhotos.length > 0) {
      ordered.push({ sectionLabel: label, photos: groupPhotos });
    }
  }

  return ordered;
}

// ---------------------------------------------------------------------------
// Schema & input builder
// ---------------------------------------------------------------------------

interface PageData {
  schema: Schema[];
  input: Record<string, string>;
}

function buildPageSchemaAndInput(
  pageIndex: number,
  headerText: string,
  photo1DataUrl: string | null,
  photo1Caption: string,
  photo2DataUrl: string | null,
  photo2Caption: string,
): PageData {
  const prefix = `photoPage${pageIndex}`;

  const schema: Schema[] = [
    // Header
    {
      name: `${prefix}_header`,
      type: "text",
      position: { x: LAYOUT.margin, y: LAYOUT.headerY },
      width: LAYOUT.pageWidth - LAYOUT.margin * 2,
      height: LAYOUT.headerHeight,
      fontSize: 14,
      fontName: "LiberationSansBold",
      alignment: "center",
      verticalAlignment: "middle",
      fontColor: "#000000",
      backgroundColor: "",
      lineHeight: 1,
      characterSpacing: 0,
    } as Schema,
  ];

  const input: Record<string, string> = {
    [`${prefix}_header`]: headerText,
  };

  // Photo 1 (always present on a page)
  if (photo1DataUrl) {
    schema.push({
      name: `${prefix}_photo1`,
      type: "image",
      position: { x: PHOTO_X, y: LAYOUT.photo1Y },
      width: LAYOUT.photoWidth,
      height: LAYOUT.photoHeight,
    } as Schema);
    input[`${prefix}_photo1`] = photo1DataUrl;
  }

  // Caption 1
  schema.push({
    name: `${prefix}_caption1`,
    type: "text",
    position: { x: PHOTO_X, y: CAPTION_1_Y },
    width: LAYOUT.photoWidth,
    height: LAYOUT.captionHeight,
    fontSize: 9,
    fontName: "LiberationSans",
    alignment: "center",
    verticalAlignment: "middle",
    fontColor: "#444444",
    backgroundColor: "",
    lineHeight: 1,
    characterSpacing: 0,
  } as Schema);
  input[`${prefix}_caption1`] = photo1Caption;

  // Photo 2 (may be absent for odd-numbered last photo in group)
  if (photo2DataUrl) {
    schema.push({
      name: `${prefix}_photo2`,
      type: "image",
      position: { x: PHOTO_X, y: PHOTO_2_Y },
      width: LAYOUT.photoWidth,
      height: LAYOUT.photoHeight,
    } as Schema);
    input[`${prefix}_photo2`] = photo2DataUrl;
  }

  // Caption 2
  schema.push({
    name: `${prefix}_caption2`,
    type: "text",
    position: { x: PHOTO_X, y: CAPTION_2_Y },
    width: LAYOUT.photoWidth,
    height: LAYOUT.captionHeight,
    fontSize: 9,
    fontName: "LiberationSans",
    alignment: "center",
    verticalAlignment: "middle",
    fontColor: "#444444",
    backgroundColor: "",
    lineHeight: 1,
    characterSpacing: 0,
  } as Schema);
  input[`${prefix}_caption2`] = photo2Caption;

  return { schema, input };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Builds photo appendix pages for the ADEQ inspection PDF.
 *
 * @param media - All media records for the inspection
 * @returns Uint8Array PDF of photo pages, or null if no photos exist
 */
export async function buildPhotoPages(
  media: MediaRecord[],
): Promise<Uint8Array | null> {
  // Filter to photos only
  const photos = media.filter((m) => m.type === "photo");
  if (photos.length === 0) return null;

  // Group photos by section
  const groups = groupPhotosBySection(photos);

  // Fetch all photo data URLs in parallel
  const dataUrlMap = new Map<string, string>();
  const fetchPromises = photos.map(async (photo) => {
    const dataUrl = await fetchPhotoAsDataUrl(photo.storagePath);
    if (dataUrl) {
      dataUrlMap.set(photo.id, dataUrl);
    }
  });
  await Promise.all(fetchPromises);

  // Build pages: iterate through groups, 2 photos per page
  const pages: PageData[] = [];
  let globalPageIndex = 0;
  let isFirstPage = true;

  for (const group of groups) {
    let photoCountInGroup = 0;

    for (let i = 0; i < group.photos.length; i += 2) {
      const photo1 = group.photos[i];
      const photo2 = i + 1 < group.photos.length ? group.photos[i + 1] : null;

      photoCountInGroup++;
      const photo2CountInGroup = photo2 ? photoCountInGroup + 1 : 0;

      // Header text: "Inspection Photos" on first page, section name on others
      const headerText = isFirstPage
        ? "Inspection Photos"
        : group.sectionLabel;

      const photo1DataUrl = dataUrlMap.get(photo1.id) ?? null;
      const photo2DataUrl = photo2 ? dataUrlMap.get(photo2.id) ?? null : null;

      // Caption format: "Section Name - Photo N"
      const caption1 = `${group.sectionLabel} - Photo ${i + 1}`;
      const caption2 = photo2 ? `${group.sectionLabel} - Photo ${i + 2}` : "";

      const pageData = buildPageSchemaAndInput(
        globalPageIndex,
        headerText,
        photo1DataUrl,
        photo1DataUrl ? caption1 : "",
        photo2DataUrl,
        photo2DataUrl ? caption2 : "",
      );

      pages.push(pageData);
      globalPageIndex++;
      isFirstPage = false;

      if (photo2) {
        photoCountInGroup++;
      }
    }
  }

  if (pages.length === 0) return null;

  // Build pdfme template: one schema array per page
  const font = await loadFont();
  const template: Template = {
    basePdf: BLANK_PAGE,
    schemas: pages.map((p) => p.schema),
  };

  const inputs = pages.map((p) => p.input);

  const pdf = await generate({
    template,
    inputs,
    plugins: { text, image },
    options: { font },
  });

  return pdf;
}
