# Jobs Address — Google Places Autocomplete

**Date:** 2026-04-09
**Scope:** New Job form only (`src/components/jobs/new-job-form.tsx`). Explicitly NOT the ADEQ inspection form or any other address field.

## Goal

When a user creates a job, typing into the **Service address** field surfaces Google Places suggestions. Picking a suggestion auto-fills `serviceAddress` (street), `city`, `state`, and `zip`. The user can still type freely and submit without picking a suggestion.

## Approach

Use Google's current-gen `google.maps.places.PlaceAutocompleteElement` web component, loaded on demand via the official `@googlemaps/js-api-loader`. The classic `google.maps.places.Autocomplete` class was deprecated in March 2025, so we adopt the new API from day one.

Rejected alternatives:
- **`use-places-autocomplete` hook** — built on the deprecated `Autocomplete` class.
- **Server-side proxy to Places REST API** — overkill. Maps JS keys are public-by-design and restricted by HTTP referrer + API.

## Components

### 1. `src/lib/google-maps-loader.ts` (new)
Memoized singleton that wraps `@googlemaps/js-api-loader`:
```ts
export async function loadGoogleMaps(): Promise<typeof google.maps | null>
```
- Reads `process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
- Returns `null` if the key is missing or the script fails to load (caller falls back to plain input).
- Loads `libraries: ["places"]`, `v: "weekly"`.
- Caches the promise so multiple components share one load.

### 2. `src/components/ui/address-autocomplete.tsx` (new)
Thin React wrapper around `PlaceAutocompleteElement`.

**Props:**
```ts
{
  value: string;
  onChange: (text: string) => void;
  onPlaceSelected: (parts: { street: string; city: string; state: string; zip: string }) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
}
```

**Behavior:**
- On mount: `await loadGoogleMaps()`. If null, render a plain `<Input>` instead (graceful fallback).
- Instantiates `new google.maps.places.PlaceAutocompleteElement({ includedRegionCodes: ["us"], types: ["address"] })` and mounts it into a div ref.
- Listens for the `gmp-select` event. On fire: `await place.fetchFields({ fields: ["addressComponents", "formattedAddress"] })`, parse components via the helper below, call `onPlaceSelected(parts)` AND `onChange(parts.street)`.
- Keeps the element's input value in sync with the `value` prop so external resets work.
- Styles the shadow-DOM element to match the existing shadcn `<Input>` via CSS parts (`::part(input)`), falling back to minimal tailwind on the wrapper div.

### 3. `parseAddressComponents()` helper (colocated in address-autocomplete.tsx)
Pure function — easy to unit test:
```ts
function parseAddressComponents(
  components: google.maps.places.AddressComponent[]
): { street: string; city: string; state: string; zip: string }
```
Maps:
- `street_number` + `route` → `street` (joined with space)
- `locality` (or fallback `sublocality_level_1`) → `city`
- `administrative_area_level_1` shortText → `state`
- `postal_code` → `zip`

Missing fields return empty strings (never `undefined`) so form state stays clean.

### 4. `src/components/jobs/new-job-form.tsx` (edit)
Replace the plain `<Input id="serviceAddress">` at line 159 with `<AddressAutocomplete>`. Wire:
```ts
onChange={(text) => update({ serviceAddress: text })}
onPlaceSelected={({ street, city, state, zip }) =>
  update({ serviceAddress: street, city, state, zip: zip || form.zip })}
```
All other fields (title, customer name/email/phone, template, assignee) stay untouched.

### 5. Env config
- `.env.example`: add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=` (empty placeholder).
- `.env.local`: add the real key.
- Vercel: add the key to Preview + Production environments (manual step — documented in handoff).

### 6. Dependency
Install `@googlemaps/js-api-loader` (official Google package, ~3kb).
No `@types/google.maps` needed — types ship with the loader package.

## Data Flow

```
user types in field
  → PlaceAutocompleteElement shows Google dropdown
  → user clicks a suggestion
  → gmp-select event fires
  → wrapper calls place.fetchFields(['addressComponents'])
  → parseAddressComponents() returns {street, city, state, zip}
  → onPlaceSelected callback runs update() on form state
  → React re-renders the four inputs with new values
  → user can still edit any field manually before submit
```

## Error Handling

| Scenario | Behavior |
|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` missing | Render plain `<Input>`, warn once in dev console |
| Script load fails (network / ad-blocker) | Same plain-input fallback |
| User types and submits without picking a suggestion | Typed value submitted as-is (autocomplete is enhancement-only) |
| Places API quota exceeded / 403 | Google element shows its own error state; form still submittable |
| `place.fetchFields` throws | Caught, logged, typed text preserved, no state update |

## Testing

**Unit test** — `src/components/ui/__tests__/parse-address-components.test.ts`
- Full US address → all four fields populated
- Missing postal code → zip is `""`
- PO Box / no street_number → street is just the route
- Missing state → state is `""`
- `sublocality_level_1` fallback when `locality` absent

**Manual / Playwright E2E** (I run this, not the user)
- Navigate to `/jobs/new`
- Type "1600 Amphitheatre"
- Assert suggestion dropdown appears
- Click first suggestion
- Assert `serviceAddress`, `city`, `state`, `zip` inputs all populated
- Edit one field manually, confirm it sticks
- Submit form, confirm job created with expected values

**Static checks**
- `pnpm typecheck` (or `tsc --noEmit`)
- `pnpm lint`
- `pnpm build`

## Security

- API key is `NEXT_PUBLIC_*` because Maps JS API runs client-side. This is standard and expected.
- User must restrict the key in Google Cloud Console:
  1. Application restrictions → HTTP referrers → add `localhost:3000/*`, Vercel preview pattern, production domain
  2. API restrictions → Maps JavaScript API + Places API only
- Key already shared in chat history — recommend rotation after restriction is in place.

## Out of Scope (YAGNI)

- Address autocomplete on the ADEQ inspection form
- Address autocomplete on any other form (customer edit, send-email, etc.)
- Saving lat/lng on the job record
- Reverse geocoding, map preview
- International addresses

## Rollback

Single revert of the feature commit restores the plain `<Input>`. The only irreversible external change is adding the env var to Vercel — that can be left in place harmlessly.

## Handoff Checklist (filled in at the end)

1. **What changed** — files, env vars, deps
2. **What was verified** — typecheck / build / test results + Playwright evidence
3. **What the user needs to do next** — restrict the key in Google Cloud Console, add env var to Vercel
4. **Known gaps** — (TBD)
5. **How to roll back** — `git revert <sha>`
