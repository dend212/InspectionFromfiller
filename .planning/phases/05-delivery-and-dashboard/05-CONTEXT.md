# Phase 5: Delivery and Dashboard - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Completed inspection reports are stored in Supabase Storage, deliverable to customers via manual email, and viewable/searchable from a dashboard. This phase covers cloud persistence, email delivery, dashboard listing, and search. New form capabilities, workflow changes, and CRM integrations are out of scope.

</domain>

<decisions>
## Implementation Decisions

### Email Delivery Flow
- Clicking "Send to Customer" opens a confirmation dialog (not a full compose screen)
- Dialog shows: recipient email, subject line, and email preview before sending
- Email body uses a standard professional template with an optional editable personal note field
- Recipient email is pre-filled from the inspection record if available, but always editable at send time
- Send history is tracked per inspection — Dan can see when emails were sent and to whom
- Emails are never sent automatically — always requires explicit button click + confirmation

### Dashboard Layout
- Table/list layout — rows with columns, not cards
- Columns: Address, Date, Customer Name, Status, Inspector, Sent/Delivered
- Status displayed as colored badges: Draft = gray, In Review = yellow/amber, Complete = green
- Default sort order: newest inspections first
- Clickable column headers for re-sorting

### Search & Filtering
- Single search box that searches across address, customer name, and date
- Real-time filtering as Dan types (table updates live)
- Tab-style status filters above the table: All | Draft | In Review | Complete
- Status tabs work alongside text search (combinable)

### PDF Storage & Downloads
- PDF automatically saved to Supabase Storage when inspection is finalized (marked complete)
- Downloaded filenames use address + date format (e.g., "123-Main-St_2026-02-26.pdf")
- Download button available both on dashboard table rows and inside inspection detail view
- If a completed inspection is edited and re-finalized, old PDF is replaced with newly generated one

### Claude's Discretion
- Empty search state design (message + clear button approach or similar)
- Email subject line default template text
- Exact table pagination or infinite scroll for large datasets
- Loading states and error handling patterns
- Column width proportions and responsive behavior

</decisions>

<specifics>
## Specific Ideas

- Customer email will eventually be pre-filled via Workiz CRM integration (v2 INTG-01/02) — design the email field to accommodate future auto-population
- Dan is the primary user checking the dashboard — optimize for his workflow of reviewing recent inspections and sending completed reports

</specifics>

<deferred>
## Deferred Ideas

- Workiz CRM integration for pre-filling customer email and address — v2 (INTG-01, INTG-02)

</deferred>

---

*Phase: 05-delivery-and-dashboard*
*Context gathered: 2026-02-26*
