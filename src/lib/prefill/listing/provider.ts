import type { PrefillAddress } from "../types";

export type ListingWaterSource = "municipal" | "private_company" | "shared_well" | "private_well" | "hauled_water";

export interface ListingFacts {
  provider: "zillow";
  url: string;
  waterSource?: ListingWaterSource;
  sewer?: "septic" | "sewer" | "unknown";
  bedrooms?: number;
  bathrooms?: number;
  yearBuilt?: number;
  lotSqft?: number;
  /** Raw Zillow home type token (e.g. "SINGLE_FAMILY", "TOWNHOUSE"), as served — never normalised here. */
  homeType?: string;
  raw: Record<string, unknown>;
}

export interface ListingProvider {
  readonly name: "zillow";
  lookup(address: PrefillAddress, signal: AbortSignal): Promise<ListingFacts | null>;
}
