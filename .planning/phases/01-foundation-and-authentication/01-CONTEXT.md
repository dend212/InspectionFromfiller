# Phase 1: Foundation and Authentication - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Next.js 16 app deployed on Vercel with Supabase for database, authentication, and file storage. Three user roles (admin, field tech, office staff) with role-based access enforced at the database level. Database schema covers users, inspections, and media. This phase delivers a running, deployed app with login — no inspection form UI yet.

</domain>

<decisions>
## Implementation Decisions

### User Roles & Access
- Dan (admin) creates all user accounts — no self-signup, no invite links
- Three roles: admin, field tech, office staff
- Field techs can start new inspections and see only their own inspections
- Office staff can review, edit, and finalize any inspection
- Admin has full access (same as office staff plus user management)
- Current team size: 3-5 field techs plus Dan

### Login Experience
- SewerTime branded login page — company logo, brand colors, professional look
- Persistent sessions — users stay logged in until they manually log out (critical for field techs on personal phones)
- Self-service password reset via email reset link
- Dan-only access on initial launch for testing

### Database & Infrastructure
- Supabase for all backend services: Postgres database, authentication, file storage
- Dan has an existing Vercel account — deploy there
- Start with Vercel default URL (no custom domain yet)
- Supabase free tier should be sufficient for initial use (3-5 users, 5-15 inspections/month)

### Claude's Discretion
- Exact database schema design (tables, columns, relationships, indexes)
- Drizzle ORM configuration and migration strategy
- Supabase Row Level Security policy implementation
- UI component library setup (shadcn/ui theming)
- Project structure and folder organization
- CI/CD configuration

</decisions>

<specifics>
## Specific Ideas

- Login page should feel professional — SewerTime branding, not a generic template
- Field techs use personal phones in the field — persistent login is essential so they don't have to re-authenticate at every job site
- Dan is the only admin for now — user management can be simple (no complex org hierarchy)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-and-authentication*
*Context gathered: 2026-02-25*
