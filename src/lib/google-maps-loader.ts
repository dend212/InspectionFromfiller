import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

let loaderPromise: Promise<typeof google.maps | null> | null = null;
let mapsAndGeocodingPromise: Promise<typeof google.maps | null> | null = null;
let warned = false;

function ensureSdkOptions(): boolean {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    if (!warned && process.env.NODE_ENV !== "production") {
      console.warn(
        "[google-maps-loader] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set — Google Maps features will fall back gracefully.",
      );
      warned = true;
    }
    return false;
  }
  setOptions({ key: apiKey, v: "weekly" });
  return true;
}

/**
 * Load the Google Maps JS SDK (Places library) once and cache the promise.
 * Returns `null` if the API key is missing or loading fails, so callers can
 * gracefully fall back to a plain input.
 */
export function loadGoogleMaps(): Promise<typeof google.maps | null> {
  if (loaderPromise) return loaderPromise;

  if (!ensureSdkOptions()) {
    loaderPromise = Promise.resolve(null);
    return loaderPromise;
  }

  loaderPromise = importLibrary("places")
    .then(() => google.maps)
    .catch((err: unknown) => {
      console.error("[google-maps-loader] failed to load Google Maps SDK", err);
      return null;
    });

  return loaderPromise;
}

/**
 * Load the Google Maps JS SDK together with the `maps` and `geocoding`
 * libraries (needed for the map view + client-side address geocoding).
 * Result is cached — safe to call repeatedly. Returns `null` on failure so
 * callers can render a graceful fallback.
 */
export function loadGoogleMapsForMapView(): Promise<typeof google.maps | null> {
  if (mapsAndGeocodingPromise) return mapsAndGeocodingPromise;

  if (!ensureSdkOptions()) {
    mapsAndGeocodingPromise = Promise.resolve(null);
    return mapsAndGeocodingPromise;
  }

  mapsAndGeocodingPromise = Promise.all([importLibrary("maps"), importLibrary("geocoding")])
    .then(() => google.maps)
    .catch((err: unknown) => {
      console.error("[google-maps-loader] failed to load maps/geocoding libraries", err);
      return null;
    });

  return mapsAndGeocodingPromise;
}
