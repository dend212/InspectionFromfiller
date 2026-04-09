"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

export interface AddressParts {
  street: string;
  city: string;
  state: string;
  zip: string;
}

interface AddressComponentLike {
  longText: string | null;
  shortText: string | null;
  types: string[];
}

/**
 * Parse a Google Places AddressComponent array into our flat address shape.
 * Pure function — unit tested.
 */
export function parseAddressComponents(
  components: AddressComponentLike[],
): AddressParts {
  const find = (type: string) =>
    components.find((c) => c.types.includes(type));
  const streetNumber = find("street_number")?.longText ?? "";
  const route = find("route")?.longText ?? "";
  const street = [streetNumber, route].filter(Boolean).join(" ").trim();
  const city =
    find("locality")?.longText ??
    find("sublocality_level_1")?.longText ??
    find("postal_town")?.longText ??
    "";
  const state = find("administrative_area_level_1")?.shortText ?? "";
  const zip = find("postal_code")?.longText ?? "";
  return { street, city, state, zip };
}

interface Props {
  value: string;
  onChange: (text: string) => void;
  onPlaceSelected: (parts: AddressParts) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  id,
  placeholder,
  disabled,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // PlaceAutocompleteElement is a web component; type it loosely to avoid
  // depending on the exact version of @types/google.maps.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elementRef = useRef<any>(null);
  const [mounted, setMounted] = useState(false);
  const [failed, setFailed] = useState(false);

  // Keep latest callbacks in refs so the mount effect runs once.
  const onChangeRef = useRef(onChange);
  const onPlaceSelectedRef = useRef(onPlaceSelected);
  useEffect(() => {
    onChangeRef.current = onChange;
    onPlaceSelectedRef.current = onPlaceSelected;
  }, [onChange, onPlaceSelected]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then((maps) => {
      if (cancelled) return;
      if (!maps || !containerRef.current) {
        setFailed(true);
        return;
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const PlacesNs = maps.places as any;
        if (!PlacesNs?.PlaceAutocompleteElement) {
          console.error(
            "[AddressAutocomplete] PlaceAutocompleteElement unavailable — falling back to plain input",
          );
          setFailed(true);
          return;
        }
        const el = new PlacesNs.PlaceAutocompleteElement({
          includedRegionCodes: ["us"],
        });
        if (id) el.id = id;
        if (placeholder) {
          try {
            el.setAttribute("placeholder", placeholder);
          } catch {
            /* ignore */
          }
        }
        // Make the element fill the form width.
        try {
          el.style.width = "100%";
          el.style.display = "block";
        } catch {
          /* ignore */
        }
        elementRef.current = el;
        containerRef.current.appendChild(el);

        // Selection — user picked a suggestion
        el.addEventListener("gmp-select", async (evt: Event) => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const detail: any = evt as any;
            const prediction = detail.placePrediction;
            if (!prediction) return;
            const place = prediction.toPlace();
            await place.fetchFields({
              fields: ["addressComponents", "formattedAddress"],
            });
            const raw = (place.addressComponents ?? []) as Array<{
              longText: string | null;
              shortText: string | null;
              types: string[];
            }>;
            const parts = parseAddressComponents(raw);
            onPlaceSelectedRef.current(parts);
            onChangeRef.current(parts.street);
          } catch (err) {
            console.error(
              "[AddressAutocomplete] failed to fetch place details",
              err,
            );
          }
        });

        // Keystrokes — bubble up through shadow DOM (input events are composed).
        el.addEventListener("input", () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const text = ((el as any).value ?? "") as string;
          onChangeRef.current(text);
        });

        setMounted(true);
      } catch (err) {
        console.error(
          "[AddressAutocomplete] failed to mount PlaceAutocompleteElement",
          err,
        );
        setFailed(true);
      }
    });

    return () => {
      cancelled = true;
      const container = containerRef.current;
      const el = elementRef.current;
      if (container && el && container.contains(el)) {
        container.removeChild(el);
      }
      elementRef.current = null;
    };
    // Mount-once — callbacks kept fresh via refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes into the element.
  useEffect(() => {
    if (!mounted) return;
    const el = elementRef.current;
    if (el && el.value !== value) {
      try {
        el.value = value ?? "";
      } catch {
        /* ignore */
      }
    }
  }, [mounted, value]);

  if (failed) {
    return (
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full"
      aria-disabled={disabled || undefined}
    />
  );
}
