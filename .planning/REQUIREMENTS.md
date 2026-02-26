# Requirements: Inspection Form Filler

**Defined:** 2026-02-25
**Core Value:** Field techs capture inspection data digitally on-site, and the office produces a professional, pixel-perfect ADEQ inspection report without manually re-entering data into a PDF.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Form Input

- [x] **FORM-01**: Field tech can fill out the ADEQ GWS 432 form as a multi-step mobile wizard (all 5 sections: Facility Info, General Treatment, Design Flow, Septic Tank Inspection, Disposal Works)
- [x] **FORM-02**: Rarely-used options in Section 2 (alternative system types beyond GP 4.02) are collapsed/hidden by default with expand-on-demand
- [x] **FORM-03**: Form auto-saves on every field change to prevent data loss (localStorage/IndexedDB)
- [x] **FORM-04**: Inspector info (Daniel Endres, SewerTime Septic, NAWT #15805, CR-37, ADEQ Truck #2833) is pre-populated on every new inspection

### Media

- [x] **MDIA-01**: User can capture or upload photos from device camera
- [x] **MDIA-02**: User can upload videos as part of field data collection (stored with inspection, not embedded in PDF)
- [ ] **MDIA-03**: Photos are embedded in the final PDF report as appended photo pages

### PDF Generation

- [x] **PDF-01**: System generates a pixel-perfect PDF using the ADEQ GWS 432 form as the base template via pdfme coordinate overlay
- [x] **PDF-02**: Inspector can digitally sign the completed report (signature captured and placed on form)
- [ ] **PDF-03**: Photo pages are appended after the main form pages in the final PDF

### Workflow

- [ ] **WKFL-01**: Field tech submits completed inspection for office review
- [ ] **WKFL-02**: Office staff (Dan) can review, edit summaries/recommendations, and finalize reports before sending
- [x] **WKFL-03**: Three user roles with appropriate access: admin (Dan), field tech, office staff

### Delivery & Storage

- [ ] **DLVR-01**: Completed reports are saved to cloud storage (Supabase Storage)
- [ ] **DLVR-02**: Manual email delivery of finished PDF to customer (button trigger, never automatic)
- [ ] **DLVR-03**: Dashboard listing all inspections with status (draft, in review, complete)
- [ ] **DLVR-04**: Search past inspections by address, date, or customer name

### Authentication

- [x] **AUTH-01**: Users can log in with email and password
- [x] **AUTH-02**: Role-based access control enforced at database level (admin, field tech, office staff)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Integration

- **INTG-01**: Pull customer name and address from Workiz CRM to pre-fill inspection forms
- **INTG-02**: Pull job details (scheduled date, assigned tech, notes) from Workiz CRM

### Media Enhancements

- **MDIA-04**: HEIC-to-JPEG auto-conversion for iPhone photo uploads
- **MDIA-05**: Photo annotation (draw on photos to highlight issues)

### Offline

- **OFFL-01**: Offline form entry with sync when connectivity returns (PWA/service worker)

### Templates

- **TMPL-01**: Templated summary/recommendation language library (standard phrases for common findings)
- **TMPL-02**: Custom template creation and management

## Out of Scope

| Feature | Reason |
|---------|--------|
| Other form types beyond ADEQ GWS 432 | Focus on one form done well first |
| Native mobile app (iOS/Android) | Web app works on all devices via browser |
| Automatic email sending | Always manual trigger per Dan's requirement |
| CompanyCam integration | Not needed for v1 |
| Workiz write-back | Read-only integration when added, don't push data back |
| AI-generated summaries | Over-engineering for this use case |
| Drag-and-drop form builder | Hard-coded form for a single regulated document is correct |
| Real-time collaboration | Only 3-5 users, not needed |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1: Foundation and Authentication | Complete |
| AUTH-02 | Phase 1: Foundation and Authentication | Complete |
| WKFL-03 | Phase 1: Foundation and Authentication | Complete |
| FORM-01 | Phase 2: Inspection Form Input | Complete |
| FORM-02 | Phase 2: Inspection Form Input | Complete |
| FORM-03 | Phase 2: Inspection Form Input | Complete |
| FORM-04 | Phase 2: Inspection Form Input | Complete |
| MDIA-01 | Phase 2: Inspection Form Input | Complete |
| MDIA-02 | Phase 2: Inspection Form Input | Complete |
| PDF-01 | Phase 3: PDF Generation | Complete |
| PDF-02 | Phase 3: PDF Generation | Complete |
| PDF-03 | Phase 3: PDF Generation | Pending |
| MDIA-03 | Phase 3: PDF Generation | Pending |
| WKFL-01 | Phase 4: Review Workflow | Pending |
| WKFL-02 | Phase 4: Review Workflow | Pending |
| DLVR-01 | Phase 5: Delivery and Dashboard | Pending |
| DLVR-02 | Phase 5: Delivery and Dashboard | Pending |
| DLVR-03 | Phase 5: Delivery and Dashboard | Pending |
| DLVR-04 | Phase 5: Delivery and Dashboard | Pending |

**Coverage:**
- v1 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0

---
*Requirements defined: 2026-02-25*
*Last updated: 2026-02-25 after roadmap creation*
