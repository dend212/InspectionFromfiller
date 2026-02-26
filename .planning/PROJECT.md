# Inspection Form Filler

## What This Is

A web application for SewerTime Septic that digitizes the ADEQ Property Transfer Inspection process (Form GWS 432). Field techs fill out inspection data on-site via phone or tablet, and office staff (primarily Dan) reviews the data, writes summaries and recommendations, attaches photos, signs, and generates a pixel-perfect PDF replica of the official ADEQ form. The app replaces the current manual process of transferring data from Workiz/CompanyCam into a PDF by hand.

## Core Value

Field techs capture inspection data digitally on-site, and the office produces a professional, pixel-perfect ADEQ inspection report without manually re-entering data into a PDF.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Field techs can fill out the full ADEQ GWS 432 inspection form on a mobile-friendly web interface
- [ ] All form sections are represented: Facility Info, General Treatment, Design Flow, Septic Tank Inspection, Disposal Works, Alternative Systems
- [ ] Office staff can review and edit submitted inspection data before finalizing
- [ ] Summaries and recommendations use a mix of templated language and custom notes
- [ ] Photos can be uploaded and attached to inspections (embedded in final PDF and available separately)
- [ ] Final output is a pixel-perfect PDF replica of the official ADEQ Property Transfer Inspection Form
- [ ] Inspector can digitally sign the completed report
- [ ] Completed reports are saved to cloud storage
- [ ] Optional email delivery of finished report to customer (manual trigger, not automatic)
- [ ] Customer and property info can be pulled from Workiz CRM (name, address, job details)
- [ ] Three user roles: Dan (admin/reviewer), field techs, office staff
- [ ] Deployable on Vercel

### Out of Scope

- Other form types beyond ADEQ GWS 432 — focus on one form done well first
- Native mobile app — web app works on all devices via browser
- Automatic email sending — always manual trigger
- CompanyCam integration — not needed for v1
- Workiz write-back — read-only integration for now (pull data, don't push back)

## Context

- SewerTime Septic does 5-15 property transfer inspections per month in Arizona
- Current process: Field tech collects images and info on-site → data goes into Workiz CRM and CompanyCam → Dan manually fills out the ADEQ PDF form in the office, reviews info, writes summaries, attaches photos, signs, and sends to customer
- The ADEQ form (GWS 432, revised April 22, 2021) is a 7-page standardized form required by Arizona law (A.A.C. R18-9-A316) before property transfer
- The form includes checkboxes, measurements (liquid levels, scum/sludge thickness), tank dimensions, disposal works details, and inspector comments
- Inspector info is pre-known (Dan Endres, SewerTime Septic, NAWT certified, CR-37 licensed, ADEQ truck reg #2833)
- The reference PDF (`Adeq Report1.pdf`) is the exact form layout the output must match

## Constraints

- **Deployment**: Must deploy on Vercel — drives tech stack toward Next.js
- **PDF fidelity**: Output must be pixel-perfect match to official ADEQ form — this is a regulated document
- **Mobile-first field UI**: Field techs use phones/tablets on-site — form must be usable on small screens
- **Workiz API**: Integration depends on what their API exposes — may need to investigate availability
- **Offline capability**: Field techs may have limited connectivity at rural Arizona properties (nice to have)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Web app over native mobile | Works on all devices, single codebase, Vercel deployment | — Pending |
| Vercel deployment | Dan's preference, good fit with Next.js | — Pending |
| Pixel-perfect PDF via template overlay | Official form layout must be replicated exactly | — Pending |
| Workiz read-only integration | Start simple, pull customer data, don't write back | — Pending |
| One form type for v1 | ADEQ GWS 432 only — nail it before expanding | — Pending |

---
*Last updated: 2026-02-25 after initialization*
