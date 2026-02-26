# Roadmap: Inspection Form Filler

## Overview

This roadmap takes the Inspection Form Filler from zero to a working application where field techs capture ADEQ GWS 432 inspection data on mobile, office staff reviews and finalizes reports, and the system generates pixel-perfect PDF replicas of the official government form. The five phases move from foundation (auth, DB, roles) through data capture (form + media), the highest-risk PDF generation work, the review workflow, and finally delivery/dashboard features. Each phase delivers a coherent, testable capability.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation and Authentication** - Next.js app with Supabase auth, role-based access, and database schema
- [x] **Phase 2: Inspection Form Input** - Mobile-first multi-step form for all ADEQ GWS 432 sections with photo/video capture
- [x] **Phase 3: PDF Generation** - Pixel-perfect ADEQ form output via pdfme template overlay with signature and photo pages
- [ ] **Phase 4: Review Workflow** - Office staff review, edit, and finalize inspections before delivery
- [ ] **Phase 5: Delivery and Dashboard** - Cloud storage, email delivery, inspection listing, and search

## Phase Details

### Phase 1: Foundation and Authentication
**Goal**: Users can log in to a running application with role-appropriate access enforced at the database level
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, WKFL-03
**Success Criteria** (what must be TRUE):
  1. User can create an account and log in with email and password
  2. Three roles exist (admin, field tech, office staff) and Dan can assign roles to users
  3. A field tech sees only field-tech-appropriate UI; admin sees admin UI
  4. Database schema for inspections, users, and media is deployed and accessible
  5. App is deployed and accessible on Vercel at a working URL
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — Scaffold Next.js 16 project, Supabase clients, Drizzle ORM, shadcn/ui, and deploy to Vercel
- [x] 01-02-PLAN.md — Login page, password reset, admin user creation API, database schema + RLS deployment, Custom Access Token Hook
- [x] 01-03-PLAN.md — Role-based dashboard shell with navigation, admin user management UI, and end-to-end verification

### Phase 2: Inspection Form Input
**Goal**: Field techs can fill out the complete ADEQ GWS 432 inspection form on a phone and attach photos/videos
**Depends on**: Phase 1
**Requirements**: FORM-01, FORM-02, FORM-03, FORM-04, MDIA-01, MDIA-02
**Success Criteria** (what must be TRUE):
  1. Field tech can step through all 5 form sections (Facility Info, General Treatment, Design Flow, Septic Tank Inspection, Disposal Works) on a mobile screen
  2. Rarely-used alternative system options in Section 2 are hidden by default and expandable on demand
  3. Form data auto-saves on every field change -- closing the browser and reopening restores all entered data
  4. Inspector info (Daniel Endres, SewerTime Septic, NAWT #15805, CR-37, ADEQ Truck #2833) is pre-filled on every new inspection
  5. Field tech can capture photos from device camera and upload videos, both attached to the inspection record
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md — Zod schemas for all 5 ADEQ sections, TypeScript types, constants, inspection CRUD API routes, inspections list page, new-inspection redirect
- [ ] 02-02-PLAN.md — 5-step wizard shell with progress dots, all step components with mobile-first fields, auto-save hook, conditional toggle sections, edit page
- [ ] 02-03-PLAN.md — Photo capture from device camera, video upload with 120s limit, per-section media galleries, Supabase Storage bucket setup, media API route

### Phase 3: PDF Generation
**Goal**: System generates a pixel-perfect PDF replica of the ADEQ GWS 432 form from inspection data, with digital signature and appended photo pages
**Depends on**: Phase 2
**Requirements**: PDF-01, PDF-02, PDF-03, MDIA-03
**Success Criteria** (what must be TRUE):
  1. Generated PDF is visually indistinguishable from the official ADEQ GWS 432 form when printed
  2. All inspection data from the form appears in the correct positions on the correct pages of the PDF
  3. Inspector can draw/capture a signature that appears in the signature area of the generated PDF
  4. Photos from the inspection are appended as additional pages after the main 6-page form
**Plans**: 3 plans

Plans:
- [x] 03-01-PLAN.md — pdfme template schema for all 6 ADEQ form pages + field-mapping layer + font setup
- [x] 03-02-PLAN.md — PDF generation pipeline, signature pad, generate button, in-browser preview, inspection detail page
- [x] 03-03-PLAN.md — Photo page appendix (2 per page, grouped by section), comments overflow page, PDF merge

### Phase 4: Review Workflow
**Goal**: Office staff can review field-submitted inspections, edit summaries and recommendations, and mark reports as finalized
**Depends on**: Phase 3
**Requirements**: WKFL-01, WKFL-02
**Success Criteria** (what must be TRUE):
  1. Field tech can submit a completed inspection, changing its status from draft to "in review"
  2. Dan (office staff/admin) can open a submitted inspection, see all field data, and edit summaries and recommendations
  3. Dan can preview the generated PDF, make edits, and re-generate until satisfied
  4. Dan can mark a report as finalized, locking it from further field tech edits
**Plans**: TBD

Plans:
- [ ] 04-01: Submission flow and status transitions
- [ ] 04-02: Review interface with edit and PDF preview
- [ ] 04-03: Finalization and access control enforcement

### Phase 5: Delivery and Dashboard
**Goal**: Completed reports are stored in the cloud, deliverable to customers via email, and searchable from a dashboard
**Depends on**: Phase 4
**Requirements**: DLVR-01, DLVR-02, DLVR-03, DLVR-04
**Success Criteria** (what must be TRUE):
  1. Finalized PDF reports are automatically saved to Supabase Storage and downloadable at any time
  2. Dan can send a finished PDF to a customer's email address with one button click (never automatic)
  3. Dashboard shows all inspections with their current status (draft, in review, complete) at a glance
  4. Dan can search past inspections by address, date, or customer name and find results quickly
**Plans**: TBD

Plans:
- [ ] 05-01: Cloud storage and PDF persistence
- [ ] 05-02: Email delivery
- [ ] 05-03: Dashboard listing and search

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation and Authentication | 3/3 | Complete | 2026-02-26 |
| 2. Inspection Form Input | 0/3 | Not started | - |
| 3. PDF Generation | 0/3 | Not started | - |
| 4. Review Workflow | 0/3 | Not started | - |
| 5. Delivery and Dashboard | 0/3 | Not started | - |
