// @ts-check
/**
 * Supabase resumable (TUS) upload helper — isomorphic (browser + Node).
 *
 * Why this exists: Supabase's standard POST upload is capped by a project-level
 * "Upload file size limit" that defaults to ~50 MB and cannot exceed the plan
 * limit on free tier. The TUS resumable endpoint is NOT subject to that cap —
 * it is only constrained by the bucket's `file_size_limit`. Using TUS we can
 * upload videos up to the bucket limit (currently 500 MB) AND get:
 *   - resumability across network drops (critical for field technicians on LTE)
 *   - progress events for a real upload progress bar
 *
 * Docs: https://supabase.com/docs/guides/storage/uploads/resumable-uploads
 */

import * as tus from "tus-js-client";

/**
 * @typedef {Object} TusUploadArgs
 * @property {string} supabaseUrl       - Project URL, e.g. https://abc.supabase.co
 * @property {string} bearerToken       - User JWT (browser) or service-role key (server).
 *                                         Used as Authorization header on the TUS PATCH requests.
 * @property {string} bucket            - Bucket name, e.g. "inspection-media"
 * @property {string} objectPath        - Object key inside the bucket (no leading slash)
 * @property {Blob | File | Buffer} body - The file to upload
 * @property {string} [contentType]     - MIME type (default: "application/octet-stream")
 * @property {string} [cacheControl]    - Cache-Control header (default: "3600")
 * @property {boolean} [upsert]         - Overwrite existing object (default: false)
 * @property {(bytesSent: number, bytesTotal: number) => void} [onProgress] - Progress callback
 * @property {AbortSignal} [signal]     - Abort signal for cancellation
 */

/**
 * Upload a file to Supabase Storage using the TUS resumable protocol.
 * Resolves on success, rejects on error or abort.
 *
 * @param {TusUploadArgs} args
 * @returns {Promise<void>}
 */
export function uploadVideoTus(args) {
  const {
    supabaseUrl,
    bearerToken,
    bucket,
    objectPath,
    body,
    contentType = "application/octet-stream",
    cacheControl = "3600",
    upsert = false,
    onProgress,
    signal,
  } = args;

  const endpoint = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/upload/resumable`;

  return new Promise((resolvePromise, rejectPromise) => {
    const upload = new tus.Upload(body, {
      endpoint,
      retryDelays: [0, 1_000, 3_000, 5_000, 10_000],
      // TUS server at Supabase ignores metadata changes on resume, so a stable
      // fingerprint tied to (bucket, objectPath) lets us resume across reloads.
      fingerprint: async () => `supabase-${bucket}-${objectPath}`,
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "x-upsert": upsert ? "true" : "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      // Supabase requires 6 MB chunks (except the final chunk, which can be smaller)
      chunkSize: 6 * 1024 * 1024,
      metadata: {
        bucketName: bucket,
        objectName: objectPath,
        contentType,
        cacheControl,
      },
      onError: (error) => {
        rejectPromise(normalizeError(error));
      },
      onProgress: onProgress
        ? (bytesSent, bytesTotal) => onProgress(bytesSent, bytesTotal)
        : undefined,
      onSuccess: () => {
        resolvePromise();
      },
    });

    if (signal) {
      const abort = () => {
        upload.abort(true).finally(() => {
          rejectPromise(new Error("Upload aborted"));
        });
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    }

    upload.start();
  });
}

/**
 * tus-js-client throws DetailedError with stringified response bodies.
 * Surface the useful bits so the toast message is meaningful.
 *
 * @param {unknown} error
 * @returns {Error}
 */
function normalizeError(error) {
  if (error && typeof error === "object" && "originalResponse" in error) {
    /** @type {any} */
    const detailed = error;
    const body = detailed.originalResponse?.getBody?.() ?? "";
    const status = detailed.originalResponse?.getStatus?.();
    const message =
      typeof body === "string" && body.length
        ? `${detailed.message ?? "Upload failed"} (HTTP ${status}): ${body.slice(0, 200)}`
        : (detailed.message ?? "Upload failed");
    return new Error(message);
  }
  if (error instanceof Error) return error;
  return new Error(String(error));
}
