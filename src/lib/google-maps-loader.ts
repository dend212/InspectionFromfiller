import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

let loaderPromise: Promise<typeof google.maps | null> | null = null;
let warned = false;

/**
 * Load the Google Maps JS SDK (Places library) once and cache the promise.
 * Returns `null` if the API key is missing or loading fails, so callers can
 * gracefully fall back to a plain input.
 */
export function loadGoogleMaps(): Promise<typeof google.maps | null> {
  if (loaderPromise) return loaderPromise;

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    if (!warned && process.env.NODE_ENV !== "production") {
      console.warn(
        "[google-maps-loader] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set — address autocomplete will fall back to a plain input.",
      );
      warned = true;
    }
    loaderPromise = Promise.resolve(null);
    return loaderPromise;
  }

  setOptions({ key: apiKey, v: "weekly" });

  loaderPromise = importLibrary("places")
    .then(() => google.maps)
    .catch((err: unknown) => {
      console.error("[google-maps-loader] failed to load Google Maps SDK", err);
      return null;
    });

  return loaderPromise;
}
