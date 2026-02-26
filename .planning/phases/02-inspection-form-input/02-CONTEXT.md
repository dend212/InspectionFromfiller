# Phase 2: Inspection Form Input - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Field techs can fill out the complete ADEQ GWS 432 inspection form on a phone and attach photos/videos. This phase covers the multi-step form wizard, all 5 ADEQ sections, photo/video capture, auto-save, and draft management. PDF generation, review workflow, and delivery are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Form Flow & Navigation
- Linear wizard: Step 1 → 2 → 3 → 4 → 5 with Next/Back buttons
- Step dots progress indicator at top (5 dots, filled as sections complete)
- Warn-but-allow validation: highlight incomplete required fields when advancing, but don't block navigation
- All validation enforced on final Submit
- Submit button on the last section (Disposal Works) — no separate review summary page

### Field Behavior & Defaults
- Toggle switch per group for rarely-used conditional fields (e.g., "Alternative Treatment System" toggle reveals those fields)
- Pre-fill inspector info: company credentials (SewerTime Septic, NAWT #15805, CR-37, ADEQ Truck #2833) plus the assigned field tech's name from their profile
- Mix of input types: dropdowns where options are fixed (AZ counties, facility types), free text where values vary (city, addresses)
- Large tap-friendly toggle rows for checkbox-heavy sections (septic tank condition items) — easy to tap with gloves or dirty hands

### Mobile Capture Experience
- Native camera integration + gallery pick (tap "Add Photo" → choose camera or existing photo)
- Per-section photo attachment: each form section has its own "Add Photo" area, photos tied to the section they document
- Optional text caption per photo (e.g., "Crack in tank lid")
- Video: native camera recording, 120-second limit per clip, attached to inspection (not embedded in PDF)

### Auto-save & Draft Handling
- Auto-save on field blur (when tech taps out of a field)
- Multiple simultaneous draft inspections allowed (tech may visit multiple sites in a day)
- Field tech dashboard shows draft cards: facility name, date started, completion status — tap to resume
- Online only for v1 — requires internet connection to save

### Claude's Discretion
- Exact animation/transition between wizard steps
- Loading states and skeleton screens
- Error toast design and placement
- Specific spacing, typography, and color usage within the design system

</decisions>

<specifics>
## Specific Ideas

- Inspector name field shows "Daniel Endres / [assigned tech name]" — pre-filled from the logged-in user's profile
- Checkbox sections should feel effortless on mobile — big touch targets, no precision tapping needed
- The form should closely mirror the structure of the official ADEQ GWS 432 paper form so field techs recognize the sections

</specifics>

<deferred>
## Deferred Ideas

- Offline support / local-first sync — potential future phase if remote sites prove to be an issue
- Smart pre-fill from recent inspections (copy facility info for recurring sites) — nice-to-have for later
- In-app camera with overlay guides — not needed for v1

</deferred>

---

*Phase: 02-inspection-form-input*
*Context gathered: 2026-02-26*
