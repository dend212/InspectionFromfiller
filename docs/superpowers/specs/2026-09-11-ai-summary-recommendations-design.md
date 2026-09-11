# AI-Drafted Summary Recommendations — Design

**Date:** 2026-09-11
**Status:** Approved (design), pending implementation plan
**Branch:** `feature/ai-summary-recommendations` (independent of the other two specs)

## 1. Goal

When an admin opens **Generate summary link** for a customer, the Recommendations box is pre-drafted by Claude from the inspection's tank and drainfield comments (plus flagged deficiencies and condition ratings). The draft is **brief and to the point** — a customer-facing summary, not a rewrite of the report — and fully editable, with a **Regenerate** button.

### Non-goals

- No change to the summary page, token, expiry, or email flow.
- No storage of drafts beyond what the user sends (the existing `inspection_summaries.recommendations` row).

## 2. Behaviour

1. Dialog opens → existing logic loads the most recent saved recommendations. **If that is empty**, the dialog immediately calls the draft endpoint and shows a skeleton with `Drafting recommendations…`; the textarea fills when the draft arrives (typically 2–4 s). If a previous recommendation exists, nothing is auto-generated (the user can press Regenerate).
2. **Regenerate** (sparkles icon, next to the textarea) requests a fresh draft; if the textarea has user edits, a confirm (`Replace your edits with a new draft?`) guards it.
3. Draft failure (rate limit, API error) → inline notice `Couldn't draft — write your own or retry`, textarea empty and editable. Never blocks sending.
4. Output format: plain text, 2–5 short bullet-style lines (`•` prefix), ≤ 60 words total, present tense, no jargon, no pricing, no ADEQ section numbers, no "we recommend" preamble repetition. Example:
   ```
   • Tank is structurally sound; pump every 3–5 years.
   • Inlet baffle is deteriorated — replace before sale.
   • Drainfield shows early ponding; limit water use and re-inspect in 12 months.
   ```
   If the comments contain nothing actionable, the draft says: `• System functioned normally at the time of inspection. Continue routine pumping every 3–5 years.`

## 3. Architecture

```
src/lib/ai/draft-recommendations.ts      buildContext(inspection) + draftRecommendations(context) → string
src/app/api/inspections/[id]/draft-recommendations/route.ts   POST, admin/office_staff only, 5/hour/inspection
src/components/dashboard/generate-summary-dialog.tsx          auto-draft on open when empty; Regenerate button
```

- **Context** passed to the model: `septicTank.septicTankComments`, `disposalWorks.disposalWorksComments`, `facilityInfo.cesspoolComments`, the boolean deficiency flags on the tank (`deficiency*`), `compromisedTank`, `septicTankCondition`, `disposalWorksCondition`, `alternativeSystemCondition`, `tanksPumped`, `facilityInfo.isCesspool`. Structured personal fields (names, addresses, emails, phone numbers, permit numbers) are **not** sent; the three free-text comment fields are inspector prose and are sent as written.
- **Model:** `claude-sonnet-4-6` via the existing bare `new Anthropic()` client pattern (same as `rewrite-comments.ts`), `max_tokens 300`, cached system prompt, plain-text output validated to ≤ 5 lines / ≤ 80 words server-side (truncate + trim if exceeded).
- **Route:** mirrors `rewrite-comments/route.ts` — JWT role check (admin | office_staff), loads the inspection, in-memory rate limiter 5/hour/inspection, returns `{ recommendations: string }`; 429 / 502 with a message on failure.

## 4. Testing

- `draft-recommendations.test.ts`: context builder omits PII; prompt snapshot; output post-processing (bullet normalisation, word cap, empty-comment fallback) with a mocked Anthropic client.
- Route test: 401 unauthenticated, 403 field_tech, 429 after 5 calls, 200 shape.
- Dialog test: auto-drafts only when no saved recommendation; skeleton → filled; Regenerate with edits shows confirm; failure notice leaves textarea editable; Generate button still disabled until text present.
- Manual: open the dialog on a finalized inspection with real comments and read the draft.

## 5. Rollout

Single small PR; deploy with Daniel's approval. No migrations. Rollback = revert.
