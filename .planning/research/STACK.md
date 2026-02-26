# Stack Research

**Domain:** Inspection form digitization with pixel-perfect PDF generation
**Researched:** 2026-02-25
**Confidence:** HIGH (core stack), MEDIUM (PDF generation approach), LOW (Workiz API specifics)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Next.js | 16.x (current: 16.1.6 LTS) | Full-stack framework | Current stable. Turbopack default for fast dev. App Router with React 19.2. Vercel deployment is first-class. Cache Components for performance. `proxy.ts` replaces middleware. |
| TypeScript | 5.x | Type safety | Required by Next.js 16. Shared types between form schemas, API responses, and PDF generation prevent data mismatches across the pipeline. |
| React | 19.2 | UI framework | Ships with Next.js 16. View Transitions, useEffectEvent, Activity component. React Compiler support for automatic memoization. |
| Tailwind CSS | 4.x | Styling | Default in Next.js 16 create-next-app. Utility-first approach works well for mobile-responsive form layouts. No runtime CSS-in-JS overhead. |

### Database & Backend

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Supabase | Latest | Database + Auth + Storage (unified BaaS) | Single platform for Postgres, auth, and file storage. Free tier: 500MB DB, 1GB storage, 50K MAU auth. Row Level Security for role-based access. Eliminates need for separate auth provider, storage service, and database. For a 5-15 inspections/month business, this is the simplest architecture with the least moving parts. |
| Drizzle ORM | 0.45.x | Database ORM | SQL-first, type-safe, tiny bundle (~35KB vs Prisma's 800KB+). Sub-500ms serverless cold starts vs Prisma's 1-3s. Built-in Zod schema generation via `drizzle-zod`. Native Postgres support with Supabase. |
| Drizzle Kit | 0.30.x | Migrations | Generates and runs SQL migrations. Introspection in <1s. Pairs with Drizzle ORM. |

### PDF Generation

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| pdfme | 5.5.0 | Template-based PDF generation | **Critical choice for this project.** pdfme separates a template into `basePdf` (the ADEQ form as background) and `schemas` (variable data fields with x/y coordinates). Load the official GWS 432 PDF as basePdf, define schema positions for every field, and generate filled PDFs with `generate()`. Works in both browser and Node.js. Includes a visual WYSIWYG Designer component for mapping field positions. MIT licensed, actively maintained (last release Nov 2025). |
| @pdfme/pdf-lib | 0.x | Low-level PDF manipulation (used internally by pdfme) | Maintained fork of the abandoned `pdf-lib`. Adds rounded rectangles, SVG support. Installed as pdfme dependency. |

### UI Components

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| shadcn/ui | Latest | Component library | Copy-paste components, zero runtime dependency. Full ownership of code. New Field component (Oct 2025) with `orientation="responsive"` for mobile forms. Built on Radix UI primitives for accessibility. Touch-friendly with configurable hit targets. |
| React Hook Form | 7.x | Form state management | Lightweight, performant. Uncontrolled components by default (critical for large inspection forms with 100+ fields). Deep integration with shadcn/ui Form component. |
| Zod | 3.x | Schema validation | Shared validation schemas between client forms, server actions, and Drizzle ORM. Single source of truth for field types and constraints. `drizzle-zod` generates Zod schemas from database tables. |

### File Storage & Upload

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Supabase Storage | (included in Supabase) | Photo upload and completed PDF storage | RLS-protected buckets. Signed upload URLs for direct client uploads. CDN-backed serving. No additional service needed. Supports any file type (photos, PDFs). Path structure: `{inspection_id}/photos/` and `{inspection_id}/report.pdf`. |

### Authentication & Authorization

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Supabase Auth | (included in Supabase) | User authentication and role management | Built into Supabase, zero additional cost. Email/password auth sufficient for a small team (Dan, field techs, office staff). Custom claims for roles (admin, field_tech, office_staff). RLS policies enforce data access at the database level. @supabase/ssr package handles Next.js App Router cookie management. |

### Digital Signature

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| react-signature-canvas | 1.x | Signature capture pad | ~400K weekly downloads. Thin wrapper around signature_pad. Outputs PNG/JPEG data URLs that embed directly into pdfme schemas as image fields. TypeScript support. 100% test coverage. Touch-friendly for mobile use. |

### External Integration

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Workiz REST API | v1 | Pull customer/job data | REST API at `api.workiz.com/api/v1/`. Supports GET for jobs and leads with pagination. API key auth. Read-only integration to pre-fill customer name, address, and job details. Requires Developer API add-on enabled in Workiz Feature Center. |

### Email Delivery

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Resend | Latest | Send completed reports via email | Simple API, generous free tier (100 emails/day). Next.js/React email template support. Manual trigger only. Alternative: Supabase Edge Functions with a mail provider. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Turbopack | Bundler (default in Next.js 16) | 2-5x faster builds, 10x faster HMR. No config needed. |
| Biome | Linter + formatter | Next.js 16 removed `next lint`. Biome replaces ESLint + Prettier in one tool. Faster than ESLint. |
| drizzle-kit studio | Database GUI | Visual database browser for development. `npx drizzle-kit studio`. |
| Supabase CLI | Local development | `supabase start` for local Postgres, Auth, Storage. Matches production environment. |

## Installation

```bash
# Create Next.js 16 project
npx create-next-app@latest inspection-form-filler --typescript --tailwind --app

# Database & ORM
npm install drizzle-orm @supabase/supabase-js @supabase/ssr
npm install -D drizzle-kit

# PDF Generation
npm install @pdfme/generator @pdfme/ui @pdfme/common

# Forms & Validation
npm install react-hook-form @hookform/resolvers zod drizzle-zod

# UI Components (via shadcn CLI, not npm)
npx shadcn@latest init
npx shadcn@latest add form input select checkbox textarea switch tabs card dialog sheet

# Digital Signature
npm install react-signature-canvas
npm install -D @types/react-signature-canvas

# Email
npm install resend

# Dev Tools
npm install -D @biomejs/biome
```

## Alternatives Considered

| Category | Recommended | Alternative | Why Not Alternative |
|----------|-------------|-------------|---------------------|
| PDF Generation | pdfme (template overlay) | Puppeteer/Playwright (HTML-to-PDF) | Pixel-perfect government form replication requires overlaying on the exact official PDF. HTML-to-PDF can never exactly match a regulated form layout. Also, Puppeteer requires headless Chrome which does not run on Vercel serverless. |
| PDF Generation | pdfme | Raw pdf-lib | pdf-lib is unmaintained (last update 3+ years ago). pdfme wraps it with declarative templates, a WYSIWYG designer, and active maintenance. Using raw pdf-lib means manual coordinate math for every field. |
| PDF Generation | pdfme | @react-pdf/renderer | react-pdf generates PDFs from React components from scratch. Cannot overlay on an existing PDF template. Wrong tool for replicating an official form. |
| Database | Supabase (Postgres) | Neon (Postgres) | Neon is a better pure database, but Supabase bundles auth + storage + RLS. For a small team app, one platform beats three services. Neon would require separate auth (Better Auth/Clerk) and storage (Vercel Blob/S3). |
| ORM | Drizzle | Prisma | Prisma's 800KB+ bundle and 1-3s cold starts are unacceptable on Vercel serverless. Drizzle is 20x smaller with sub-500ms cold starts. Prisma 7 improves this, but Drizzle is the natural fit for serverless in 2026. |
| Auth | Supabase Auth | Better Auth | Better Auth is excellent and now maintains Auth.js codebase. But since we already use Supabase for DB and storage, using Supabase Auth means zero additional configuration, one fewer dependency, and RLS policies that reference `auth.uid()` directly. |
| Auth | Supabase Auth | Clerk | Clerk has better pre-built UI and DX, but costs $0.02/MAU after 10K. Overkill for a 3-5 user app. Supabase Auth is free for 50K MAU. |
| Storage | Supabase Storage | Vercel Blob | Vercel Blob works well but is a separate service. Supabase Storage shares the same auth context and RLS policies as the database. One platform. |
| Signature | react-signature-canvas | Apryse SDK | Apryse is enterprise-grade and expensive. react-signature-canvas is free, simple, and outputs the PNG data URLs we need for pdfme image embedding. |
| Email | Resend | SendGrid / Nodemailer | Resend has the simplest API and best Next.js integration. SendGrid is more complex than needed. Nodemailer requires SMTP setup. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| pdf-lib (direct) | Unmaintained for 3+ years. No security updates. GitHub issue #1423 "Is this thing still on?" with no response. | pdfme (which uses @pdfme/pdf-lib, a maintained fork) |
| Puppeteer / Playwright for PDF | Cannot run on Vercel serverless (requires headless Chrome). Cannot overlay on existing PDF templates. HTML-to-PDF will never pixel-perfectly match a government form. | pdfme with basePdf template overlay |
| @react-pdf/renderer | Generates PDFs from scratch via React components. Cannot use an existing PDF as background. Wrong paradigm for form replication. | pdfme |
| Prisma | 800KB+ bundle size. 1-3 second cold starts on serverless. Needs Prisma Accelerate for edge. Overkill for this app's data model. | Drizzle ORM |
| NextAuth / Auth.js v5 | Still in beta after 2+ years. Auth.js team joined Better Auth in Sep 2025. Maintenance will be security-only. Starting new projects on Auth.js is not recommended. | Supabase Auth (bundled with our BaaS) |
| Pages Router | Deprecated patterns. Next.js 16 is App Router-first. Server Components, Server Actions, and Cache Components require App Router. | App Router |
| CSS Modules / styled-components | Runtime overhead, harder to make responsive. Not the Next.js 16 default. | Tailwind CSS |
| MongoDB / NoSQL | Inspection data is relational (inspections have sections, sections have fields, inspections belong to customers). Postgres with JSON columns handles both structured and semi-structured data. | Supabase Postgres |
| Native mobile app | Out of scope. Web app with mobile-responsive design works on all devices through the browser. PWA capabilities if offline needed. | Next.js responsive web app |

## Stack Patterns by Variant

**If offline capability becomes a requirement:**
- Add `next-pwa` for service worker and offline caching
- Use IndexedDB (via `idb` library) to store form data locally
- Sync to Supabase when back online
- This is a significant complexity increase -- defer unless rural connectivity is a real blocker

**If Workiz API is unavailable or too limited:**
- Build a simple customer/property management module in the app
- Manual data entry for customer info (name, address, phone)
- CSV import as a quick alternative
- The Workiz API requires a paid Developer API add-on; confirm this is available on Dan's plan before building the integration

**If more complex user management is needed later:**
- Supabase Auth supports OAuth providers (Google, etc.) if needed
- Custom claims handle role-based access
- If enterprise features (SSO, SCIM) ever needed, migrate to Better Auth or Clerk

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Next.js 16.x | React 19.2, Node.js 20.9+ | Turbopack is default bundler. TypeScript 5+ required. |
| Drizzle ORM 0.45.x | drizzle-kit 0.30.x, drizzle-zod | All in drizzle-orm monorepo now. Zod/Valibot validators built in. |
| @supabase/ssr | Next.js 16.x App Router | Handles cookie-based auth in Server Components, Server Actions, and proxy.ts (replaces middleware). |
| pdfme 5.5.0 | Node.js 20+, Browser | Works in both Next.js API routes (server-side PDF generation) and browser (client-side preview). |
| shadcn/ui | Tailwind CSS 4.x, React 19 | Latest shadcn CLI supports Tailwind 4. Use `npx shadcn@latest`. |
| react-signature-canvas 1.x | React 19 | Thin wrapper around canvas. No React version conflicts. |

## Sources

- Next.js 16 Blog Post (Oct 2025): https://nextjs.org/blog/next-16 -- Verified Next.js 16.1.6 LTS as current stable. Turbopack default, React 19.2, proxy.ts, Cache Components. [HIGH confidence]
- Supabase Docs: https://supabase.com/docs -- Auth, Storage, RLS, Next.js integration guides verified. @supabase/ssr for App Router. [HIGH confidence]
- Drizzle ORM Docs: https://orm.drizzle.team/ -- Version 0.45.1 stable. 1.0.0-beta.2 in development. Serverless cold start advantages verified across multiple sources. [HIGH confidence]
- pdfme GitHub (v5.5.0, Nov 2025): https://github.com/pdfme/pdfme -- basePdf template concept, WYSIWYG designer, coordinate-based schemas verified. [HIGH confidence]
- pdfme Docs: https://pdfme.com/docs/getting-started -- Template structure: basePdf + schemas. Supports existing PDF as background. [HIGH confidence]
- pdf-lib Maintenance Status: GitHub Issue #1423 "Is this thing still on?" -- Confirmed inactive, no updates in 3+ years. [HIGH confidence]
- shadcn/ui Oct 2025 Changelog: https://ui.shadcn.com/docs/changelog/2025-10-new-components -- New Field component with responsive orientation. [HIGH confidence]
- React Hook Form + Zod + shadcn/ui: https://ui.shadcn.com/docs/forms/react-hook-form -- Official integration pattern. [HIGH confidence]
- Auth.js joins Better Auth (Sep 2025): https://github.com/nextauthjs/next-auth/discussions/13252 -- Auth.js maintenance is security-only going forward. [HIGH confidence]
- Workiz API: https://developer.workiz.com/ -- REST API v1 exists. Jobs and leads endpoints confirmed. Requires Developer API add-on. Specific field documentation could not be verified. [LOW confidence on data fields]
- react-signature-canvas: https://www.npmjs.com/package/react-signature-canvas -- ~400K weekly downloads. v1.1.0-alpha.2. TypeScript support. [MEDIUM confidence - alpha version]
- Drizzle vs Prisma (2026): Multiple sources agree on serverless advantages. https://designrevision.com/blog/prisma-vs-drizzle [MEDIUM confidence]
- Supabase Pricing (2026): https://supabase.com/pricing -- Free tier: 500MB DB, 1GB storage, 50K MAU auth. [HIGH confidence]

---
*Stack research for: Inspection Form Digitization (ADEQ GWS 432)*
*Researched: 2026-02-25*
