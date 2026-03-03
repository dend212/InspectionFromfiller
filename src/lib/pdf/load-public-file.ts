/**
 * Universal file loader for public/ assets.
 *
 * In the browser, uses fetch() with a relative URL.
 * On the server (Node.js / Vercel), reads from the filesystem via process.cwd()/public/.
 */
export async function loadPublicFile(relativePath: string): Promise<ArrayBuffer> {
  if (typeof window !== "undefined") {
    const response = await fetch(relativePath);
    if (!response.ok) {
      throw new Error(`Failed to load ${relativePath}: ${response.status} ${response.statusText}`);
    }
    return response.arrayBuffer();
  }

  // Server-side: read from filesystem
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const filePath = join(process.cwd(), "public", relativePath);
  const buffer = await readFile(filePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
