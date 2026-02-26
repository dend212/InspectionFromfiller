# Feature Research

**Domain:** Inspection form digitization and PDF generation (septic/property transfer)
**Researched:** 2026-02-25
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Mobile-friendly form entry | Field techs use phones/tablets on-site; every competitor (GoCanvas, SafetyCulture, Septic RX) is mobile-first | MEDIUM | Responsive web form, not native app. Touch-friendly inputs, large tap targets, minimal scrolling per section |
| All ADEQ GWS 432 sections represented | This is a regulated form -- missing any section means the report is legally incomplete | HIGH | 7-page form with checkboxes, measurements, dimensions, text fields, multiple sections (Facility Info, General Treatment, Design Flow, Septic Tank, Disposal Works, Alternative Systems) |
| Photo upload and embedding | Every inspection app supports photo capture; photos are required evidence in inspection reports | MEDIUM | Upload from camera roll or capture in-browser. Must embed in final PDF. Septic RX limits to 10; we should support at least 10-15 per inspection |
| Digital signature capture | Standard in GoCanvas, SafetyCulture, GoAudits, and all credible inspection apps. ADEQ form requires inspector signature | MEDIUM | Canvas-based signature pad. Must render cleanly in PDF. Inspector signs at review/finalization, not in the field |
| PDF generation matching official form layout | The entire point of this app. ADEQ form is a regulated document that must look exactly right | HIGH | Pixel-perfect overlay onto GWS 432 template. Use fillable PDF template + server-side population (PDFtk/pdf-lib approach), NOT HTML-to-PDF |
| Review/edit before finalization | Every serious inspection platform has a review step. Dan reviews and edits field tech data before generating the final report | LOW | Standard CRUD editing screen. Show all sections, allow edits, preview before PDF generation |
| Cloud storage of completed reports | Industry standard. Fluix, SafetyCulture, GoAudits all store reports in cloud. Reports must be retrievable later | LOW | Store PDF + structured data in cloud storage. Vercel-compatible (S3/Cloudflare R2/Supabase Storage) |
| Email delivery of finished report | Septic RX, GoCanvas, SafetyCulture all support email delivery. Customers expect to receive reports electronically | LOW | Manual trigger only (per project requirements). Send PDF as attachment to customer email. Simple SMTP/transactional email |
| User authentication and role separation | Three roles defined: Dan (admin/reviewer), field techs, office staff. Standard in any multi-user business app | MEDIUM | Auth with role-based access. Field techs: create/submit. Office staff: view/assist. Dan: full admin, review, sign, finalize |
| Form section navigation | Long forms need section-by-section navigation, not one giant scrollable page. SafetyCulture, GoCanvas, GoAudits all use stepped/sectioned forms | LOW | Stepper or tab navigation. Show progress. Allow jumping between sections. Save progress per section |
| Auto-save / draft persistence | Field techs may lose connectivity or accidentally close browser. Data loss = re-doing an entire inspection | MEDIUM | Auto-save to local storage and/or server on each field change. Resume from where left off |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Workiz CRM data pull | Auto-populate customer name, address, job details from Workiz. No competitor in the septic space does this. Eliminates re-typing customer info that already exists in CRM | MEDIUM | Read-only Workiz API integration. Pull job/customer data by job ID or search. Needs API investigation for available endpoints |
| Templated summaries and recommendations | Dan writes similar summaries repeatedly. Pre-built text blocks with fill-in-the-blank variables save 15-30 min per report. Septic RX has no templating; it is just free-text | MEDIUM | Library of reusable text snippets organized by finding type (e.g., "tank in good condition", "effluent filter missing"). Mix-and-match with custom edits |
| Inspector info pre-population | Dan's credentials (name, company, NAWT cert, CR-37 license, ADEQ truck reg) are the same on every report. Pre-fill once, never type again | LOW | Store inspector profile. Auto-fill on every new inspection. Trivial but saves repetitive data entry across 5-15 inspections/month |
| Inspection history and search | Look up past inspections by address, date, or customer. Useful for repeat customers or property re-inspections. Most small-business tools lack this | LOW | Simple list view with search/filter. Not complex analytics -- just "find that report from last month" |
| Conditional form logic | Show/hide form sections based on previous answers (e.g., skip "Alternative Systems" if conventional system). SafetyCulture does this well; Septic RX does not | MEDIUM | Reduces form length for field techs. Only show relevant sections. Requires mapping ADEQ form logic |
| Photo annotation / markup | Draw arrows, circles, text on photos to highlight issues (cracked tank, effluent level, etc.). ArcSite and InspectAll offer this; most septic-specific tools do not | HIGH | Canvas-based drawing over uploaded photos. Useful but high complexity for v1. Consider v1.x |
| Offline form completion | Rural Arizona properties may lack connectivity. Complete form offline, sync when back online | HIGH | Service worker + IndexedDB for local storage. Complex to implement reliably. Major differentiator for rural use cases |
| Bulk PDF generation | Generate multiple reports in a batch when catching up on paperwork. No septic-specific tool offers this | LOW | Queue multiple inspections for PDF generation. Simple iteration over existing single-report flow |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Native mobile app (iOS/Android) | "Real apps feel better" | Doubles development effort, app store approval delays, two codebases to maintain. PWA/responsive web covers 95% of use cases for form filling | Mobile-first responsive web app. Add to home screen via PWA manifest for app-like experience |
| Drag-and-drop form builder | "Let users create custom forms" | This app serves ONE form (ADEQ GWS 432). A form builder is massive complexity for zero value. SewerTime does not need to design forms -- they need to fill ONE specific form | Hard-code the ADEQ GWS 432 form structure. If other forms needed later, add them as new hard-coded templates |
| Real-time collaboration | "Multiple people editing at once" | Inspection workflow is sequential (field tech fills, Dan reviews). No concurrent editing needed. Real-time sync adds enormous complexity (CRDT, WebSocket, conflict resolution) | Sequential workflow: field tech submits, Dan reviews. Simple state machine, not collaborative editing |
| Automatic email sending | "Just send it when done" | Risk of sending incomplete/incorrect reports. Dan explicitly wants manual control over when reports go out | Manual "Send Report" button. Dan reviews, approves, then explicitly triggers email |
| CompanyCam integration | "Pull photos from CompanyCam" | Out of scope for v1. Adds API integration complexity. Photos can be uploaded directly from phone camera roll which already has CompanyCam photos | Direct photo upload from device. CompanyCam photos are already on the phone's camera roll |
| Workiz write-back | "Update job status in Workiz when report is done" | Write APIs are more complex, error-prone, and risk corrupting CRM data. Read-only is safe and sufficient | Read-only Workiz integration. Dan updates Workiz manually (already part of his workflow) |
| Multi-tenant / white-label | "Other septic companies could use this" | Premature scaling. Build for SewerTime first. Multi-tenancy adds auth complexity, data isolation, billing, onboarding | Single-tenant for SewerTime. If demand emerges later, extract tenant model as a separate effort |
| AI-generated summaries | "Let AI write the inspection summary" | Regulated document -- AI hallucinations in a legal report are a liability. Inspector is professionally responsible for accuracy | Templated text blocks that Dan selects and edits. Human-authored, human-reviewed. AI can assist with drafts in v2+ if desired |
| Complex analytics dashboard | "Show trends, charts, metrics" | SewerTime does 5-15 inspections/month. Analytics at this volume provide no actionable insight. Dashboard development is expensive | Simple list of past inspections with search. Export to CSV if Dan ever wants to analyze in a spreadsheet |

## Feature Dependencies

```
[User Authentication]
    |-- requires --> [Role-Based Access Control]
    |                   |-- enables --> [Field Tech Form Entry]
    |                   |-- enables --> [Admin Review Workflow]
    |                   |-- enables --> [Office Staff View Access]
    |
[ADEQ Form Data Model]
    |-- requires --> [All Form Sections Implemented]
    |                   |-- enables --> [Form Section Navigation]
    |                   |-- enables --> [Conditional Form Logic]
    |                   |-- enables --> [Auto-Save / Draft Persistence]
    |
[Form Data Entry (Field)]
    |-- enables --> [Review/Edit (Office)]
    |                   |-- enables --> [Templated Summaries]
    |                   |-- enables --> [Digital Signature]
    |                   |                   |-- enables --> [PDF Generation]
    |                   |                                       |-- enables --> [Cloud Storage]
    |                   |                                       |-- enables --> [Email Delivery]
    |
[Workiz CRM Integration]
    |-- enhances --> [Form Data Entry] (auto-populates customer/property fields)
    |
[Photo Upload]
    |-- enhances --> [Form Data Entry]
    |-- required by --> [PDF Generation] (photos embedded in report)
    |
[Photo Annotation]
    |-- requires --> [Photo Upload]
    |
[Inspector Profile]
    |-- enhances --> [PDF Generation] (auto-fills inspector credentials)
    |
[Offline Mode]
    |-- enhances --> [Form Data Entry]
    |-- requires --> [Auto-Save / Draft Persistence]
```

### Dependency Notes

- **PDF Generation requires Digital Signature:** The ADEQ form needs the inspector's signature. PDF cannot be finalized without it.
- **Review/Edit enables Templated Summaries:** Summary templates are used during the review phase, not in the field.
- **Offline Mode requires Auto-Save:** Offline capability fundamentally depends on robust local persistence. Build auto-save first, offline extends it.
- **Workiz Integration enhances Form Entry:** It is an enhancement, not a blocker. Forms work fine with manual data entry. Workiz pull is a time-saver.
- **Conditional Logic requires all form sections:** Must understand the full form structure before adding show/hide logic on top.

## MVP Definition

### Launch With (v1)

Minimum viable product -- what is needed to replace Dan's manual PDF-filling process.

- [ ] **User auth with roles** -- Gate access to the app. Dan (admin), field techs, office staff
- [ ] **Complete ADEQ GWS 432 form entry** -- All sections, all field types (checkboxes, measurements, text, dropdowns)
- [ ] **Section-by-section navigation** -- Stepper UI for the 7-page form on mobile
- [ ] **Auto-save / draft persistence** -- Do not lose field data if browser closes
- [ ] **Photo upload** -- Attach inspection photos to the report (minimum 10-15 per inspection)
- [ ] **Review/edit workflow** -- Dan can review, modify, add summaries before finalizing
- [ ] **Inspector info pre-population** -- Dan's credentials auto-filled on every report
- [ ] **Digital signature** -- Canvas-based signature capture for the inspector
- [ ] **Pixel-perfect PDF generation** -- Output matches the official ADEQ GWS 432 form exactly
- [ ] **Cloud storage** -- Save completed PDFs and inspection data
- [ ] **Email delivery** -- Manual trigger to send PDF to customer

### Add After Validation (v1.x)

Features to add once core is working and Dan is actively using the app.

- [ ] **Workiz CRM data pull** -- Trigger: Dan confirms the workflow works and wants to eliminate manual customer data entry
- [ ] **Templated summaries and recommendations** -- Trigger: Dan identifies his most-used summary phrases after 10-20 inspections
- [ ] **Conditional form logic** -- Trigger: Field techs request shorter forms for common system types
- [ ] **Inspection history and search** -- Trigger: Dan needs to look up a past inspection and can't find it easily
- [ ] **Photo annotation** -- Trigger: Field techs want to highlight specific issues in photos

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **Offline mode** -- High complexity. Defer until connectivity is proven to be a real blocker, not hypothetical
- [ ] **Bulk PDF generation** -- Low priority until inspection volume increases
- [ ] **Additional form types** -- Only after ADEQ GWS 432 is rock-solid
- [ ] **CompanyCam integration** -- Only if direct photo upload proves insufficient
- [ ] **AI-assisted summary drafting** -- Only after templated summaries are battle-tested and Dan wants more automation

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| ADEQ form data entry (all sections) | HIGH | HIGH | P1 |
| Section navigation (stepper) | HIGH | LOW | P1 |
| Auto-save / draft persistence | HIGH | MEDIUM | P1 |
| Photo upload | HIGH | MEDIUM | P1 |
| Review/edit workflow | HIGH | LOW | P1 |
| Digital signature | HIGH | MEDIUM | P1 |
| PDF generation (pixel-perfect) | HIGH | HIGH | P1 |
| User auth + roles | HIGH | MEDIUM | P1 |
| Cloud storage | HIGH | LOW | P1 |
| Email delivery | MEDIUM | LOW | P1 |
| Inspector info pre-population | MEDIUM | LOW | P1 |
| Workiz CRM data pull | MEDIUM | MEDIUM | P2 |
| Templated summaries | MEDIUM | MEDIUM | P2 |
| Conditional form logic | MEDIUM | MEDIUM | P2 |
| Inspection history/search | LOW | LOW | P2 |
| Photo annotation | MEDIUM | HIGH | P3 |
| Offline mode | MEDIUM | HIGH | P3 |
| Bulk PDF generation | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for launch -- without these, the app does not replace the manual process
- P2: Should have, add when possible -- these make the app faster and better than manual
- P3: Nice to have, future consideration -- valuable but high cost or unproven need

## Competitor Feature Analysis

| Feature | Septic RX | SafetyCulture (iAuditor) | GoCanvas | Our Approach |
|---------|-----------|--------------------------|----------|--------------|
| Mobile form entry | Yes (native app) | Yes (native + web) | Yes (native + web) | Web app, mobile-first responsive |
| Septic-specific form | Yes (generic septic form) | No (generic templates) | Partial (template library) | ADEQ GWS 432 specific -- exact form match |
| Photo capture | Up to 10 photos | Unlimited with annotations | Yes with annotations | 10-15+ photos, annotations in v1.x |
| Digital signature | Not mentioned | Yes | Yes | Yes, canvas-based |
| PDF output | Generic septic report PDF | Branded report PDF | Custom PDF from template | Pixel-perfect ADEQ form replica |
| CRM integration | None | Zapier/API integrations | Zapier/API integrations | Direct Workiz pull (v1.x) |
| Templated text | None (free-text only) | Template library | Template library | Domain-specific summary templates (v1.x) |
| Offline mode | Yes (native app) | Yes | Yes | v2+ (service worker approach) |
| Review workflow | None (single user) | Yes (assign actions) | Yes (approval flows) | Yes, field-to-office review pipeline |
| Price | $50/year after free trial | $24/user/month (premium) | $30/user/month | Internal tool, no per-user cost |
| Regulatory compliance | Generic | Generic | Generic | ADEQ-specific, legally compliant output |

**Our competitive advantage:** No existing tool produces a pixel-perfect ADEQ GWS 432 form. Septic RX generates a generic septic report. SafetyCulture and GoCanvas generate branded but non-regulatory PDFs. Our app fills the exact official form, which is the legally required output.

## Sources

- [Septic RX Features](https://septicinspectionform.com/septic-inspection-app-features.html) - Direct competitor for septic inspection forms
- [SafetyCulture (iAuditor) Reviews - Capterra](https://www.capterra.com/p/141080/iAuditor/) - Feature analysis of industry-leading inspection platform
- [GoCanvas Inspection App](https://www.gocanvas.com/mobile-forms-apps/24458-Inspection) - General inspection mobile form platform
- [GoAudits Building Inspection Software](https://goaudits.com/blog/building-inspection-software-app/) - Construction inspection app comparison
- [Best Field Inspection Apps 2025 - TeamIM](https://www.teamim.com/blog/best-field-inspection-apps) - Industry overview of field inspection apps
- [Alpha Software Mobile Inspection App](https://www.alphasoftware.com/blog/sample-inspection-app-with-critical-features-required-by-field-inspectors) - Critical features for field inspectors (offline, annotation, voice)
- [ADEQ Form GWS 432](https://static.azdeq.gov/forms/septic_system_insp.pdf) - Official ADEQ form and instructions
- [ADEQ Notice of Transfer and Inspection](https://azdeq.gov/wqd-onsite-wastewater-notice-transfer-and-inspection) - Regulatory context for the form
- [PDFtk Pixel-Perfect PDF Forms](https://www.fullstack.com/labs/resources/blog/generate-pixel-perfect-pdf-forms-with-pdftk-and-node-js) - Technical approach for PDF template filling
- [Fluix Inspection Records Management](https://fluix.io/blog/inspection-records) - Cloud storage and archival best practices
- [Building Inspection App Smart Forms](https://www.buildinginspectionapp.com/modules/smart-forms) - CRM auto-population patterns
- [Best Mobile Inspection Software 2026 - Gitnux](https://gitnux.org/best/mobile-inspection-software/) - Market overview

---
*Feature research for: Inspection form digitization and PDF generation (septic/property transfer)*
*Researched: 2026-02-25*
