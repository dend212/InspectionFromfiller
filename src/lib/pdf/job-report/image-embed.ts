/**
 * Shared helper to fetch image bytes via signed URL and (server-side) resize
 * with sharp before pdf-lib embeds them. Lifted from photo-pages.ts so the
 * job report pipeline doesn't need to know about ADEQ inspection specifics.
 */

export async function fetchImageBytesForPdf(
  url: string,
  maxWidth = 1200,
): Promise<{ bytes: Uint8Array; isPng: boolean } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const rawBytes = new Uint8Array(buf);

    if (typeof window === "undefined") {
      try {
        const sharp = (await import("sharp")).default;
        const compressed = await sharp(Buffer.from(buf))
          .rotate() // auto-orient from EXIF
          .resize(maxWidth, undefined, { withoutEnlargement: true, fit: "inside" })
          .jpeg({ quality: 80, mozjpeg: true })
          .toBuffer();
        return { bytes: new Uint8Array(compressed), isPng: false };
      } catch {
        // Fall through
      }
    }

    const isPng =
      rawBytes.length > 4 &&
      rawBytes[0] === 0x89 &&
      rawBytes[1] === 0x50 &&
      rawBytes[2] === 0x4e &&
      rawBytes[3] === 0x47;
    return { bytes: rawBytes, isPng };
  } catch {
    return null;
  }
}
