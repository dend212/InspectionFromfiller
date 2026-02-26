---
phase: 01-foundation-and-authentication
plan: 03
subsystem: ui
tags: [role-based-nav, dashboard, admin-ui, user-management, shadcn-ui, jwt-decode, mobile-nav, sidebar]

# Dependency graph
requires:
  - phase: 01-foundation-and-authentication/02
    provides: Login flow, admin user creation API, Custom Access Token Hook with user_role JWT claim, RLS policies
provides:
  - Dashboard layout with Header + sidebar Nav (responsive)
  - Role-aware navigation filtering items by user_role JWT claim
  - Mobile hamburger menu via shadcn/ui Sheet
  - useUserRole hook decoding JWT for client-side role detection
  - Admin user management page at /admin/users with server-side role gate
  - CreateUserForm posting to /api/admin/users
  - Existing users list with name, email, role, created date
  - Role-appropriate dashboard home with quick links per role
  - AppRole type and NAV_ITEMS config for navigation definition
affects: [02-form-input, 04-review-workflow, 05-delivery-and-dashboard]

# Tech tracking
tech-stack:
  added: [jwt-decode]
  patterns: [useUserRole-hook, role-filtered-navigation, server-side-role-gate, dashboard-route-group, sidebar-layout]

key-files:
  created:
    - src/types/roles.ts
    - src/hooks/use-user-role.ts
    - src/components/layout/header.tsx
    - src/components/layout/nav.tsx
    - src/components/layout/mobile-nav.tsx
    - src/components/ui/sheet.tsx
    - src/app/(dashboard)/layout.tsx
    - src/app/(dashboard)/page.tsx
    - src/app/(dashboard)/admin/users/page.tsx
    - src/components/admin/create-user-form.tsx
    - src/components/ui/badge.tsx
    - src/components/ui/select.tsx
    - src/components/ui/table.tsx
  modified:
    - src/app/page.tsx (removed, replaced by dashboard route group page)

key-decisions:
  - "Dashboard uses (dashboard) route group so layout.tsx only wraps authenticated pages"
  - "useUserRole hook decodes JWT client-side via jwt-decode for navigation filtering -- avoids extra server calls"
  - "Admin route protection is server-side (redirect before render), not just hidden in navigation"
  - "Vercel DATABASE_URL updated to Transaction pooler for runtime DB queries (admin users page)"

patterns-established:
  - "Dashboard route group: (dashboard) group with auth-check layout for all post-login pages"
  - "Role-aware navigation: NAV_ITEMS config array with roles field, filtered by useUserRole hook"
  - "Server-side role gate: admin pages check user_role server-side and redirect non-admin users"
  - "Admin UI pattern: server component page with embedded client component form (CreateUserForm)"

requirements-completed: [AUTH-02, WKFL-03]

# Metrics
duration: ~45min
completed: 2026-02-26
---

# Phase 1 Plan 03: Role-Based Dashboard Shell Summary

**Role-aware dashboard with sidebar navigation, mobile hamburger menu, admin user management UI, and server-side route protection -- completing the Phase 1 authentication experience end-to-end**

## Performance

- **Duration:** ~45 min (across execution and human verification)
- **Started:** 2026-02-26
- **Completed:** 2026-02-26
- **Tasks:** 3 (2 automated, 1 human-verify checkpoint)
- **Files created/modified:** 14

## Accomplishments
- Built responsive dashboard shell with Header (SewerTime branding, user email, logout) + sidebar Nav on desktop + hamburger Sheet on mobile
- Created useUserRole hook that decodes JWT user_role claim from Supabase session for client-side role filtering
- Implemented role-aware navigation: admin sees all 6 nav items, field tech sees 3 (Dashboard, New Inspection, My Inspections), office staff sees 4 (Dashboard, All Inspections, Review Queue)
- Built admin user management page at /admin/users with server-side role gate, CreateUserForm, and existing users table
- User verified complete end-to-end flow: login, role-based nav, user creation, field tech limited access, admin route protection, mobile nav, password reset, logout

## Task Commits

Each task was committed atomically:

1. **Task 1: Create role types, useUserRole hook, and role-aware navigation components** - `36a2e77` (feat)
2. **Task 2: Build dashboard layout, role-based dashboard home, and admin user management page** - `0cac596` (feat)
3. **Task 3: Verify complete Phase 1 auth flow end-to-end** - No commit (human-verify checkpoint, user approved)

## Files Created/Modified
- `src/types/roles.ts` - AppRole type, NavItem interface, NAV_ITEMS configuration array
- `src/hooks/use-user-role.ts` - React hook decoding user_role from JWT via jwt-decode and Supabase auth state
- `src/components/layout/header.tsx` - SewerTime branding, user email display, logout button, mobile hamburger trigger
- `src/components/layout/nav.tsx` - Sidebar navigation filtered by user role with active route highlighting
- `src/components/layout/mobile-nav.tsx` - Sheet-based mobile navigation with role-filtered items
- `src/components/ui/sheet.tsx` - shadcn/ui Sheet component for mobile drawer
- `src/app/(dashboard)/layout.tsx` - Dashboard layout with server-side auth check, Header + Nav structure
- `src/app/(dashboard)/page.tsx` - Role-specific dashboard home with welcome message and quick link cards
- `src/app/(dashboard)/admin/users/page.tsx` - Admin-only user management page with server-side role gate, users table
- `src/components/admin/create-user-form.tsx` - User creation form with Zod validation, role select, success/error feedback
- `src/components/ui/badge.tsx` - shadcn/ui Badge component for role display
- `src/components/ui/select.tsx` - shadcn/ui Select component for role dropdown
- `src/components/ui/table.tsx` - shadcn/ui Table component for users list

## Decisions Made
- **Dashboard route group pattern:** Used `(dashboard)` route group so the authenticated layout (Header + Nav + sidebar) only wraps post-login pages, keeping auth pages with their own minimal layout.
- **Client-side JWT decode for nav:** useUserRole hook decodes the JWT access token client-side using jwt-decode library, avoiding additional server requests for role info on every navigation render.
- **Server-side admin gate:** Admin pages enforce role checks server-side with redirect before rendering, not just by hiding nav items. Direct URL access to /admin/users by non-admin users is blocked.
- **Vercel DATABASE_URL fix:** Updated the Vercel environment variable to use the Transaction pooler endpoint (port 6543) since the admin users page needs runtime database queries via Drizzle ORM.

## Deviations from Plan

None - plan executed exactly as written. Both automated tasks built successfully on the first pass, and the human verification confirmed all functionality working correctly.

## Issues Encountered

- **Vercel DATABASE_URL:** The production database connection on Vercel needed to be updated to the Transaction pooler URL for the admin users page to query the database at runtime. This was identified and fixed during the human verification checkpoint. Not a code deviation -- it was an environment configuration issue.

## User Setup Required

None - no additional external service configuration required beyond what was already set up in Plan 01-02.

## Next Phase Readiness
- Phase 1 is now complete: all 3 plans executed, all success criteria verified
- Authentication, roles, navigation, and admin user management are fully operational
- Phase 2 (Inspection Form Input) can proceed: the dashboard shell is ready to host the multi-step inspection form
- Navigation already includes links to Phase 2+ pages (New Inspection, My Inspections, All Inspections, Review Queue) -- those pages just need to be built
- The (dashboard) route group layout provides the authenticated shell for all future pages

## Self-Check: PASSED

All 13 key files verified present. Commits 36a2e77 and 0cac596 verified in git log. Summary file exists at expected path.

---
*Phase: 01-foundation-and-authentication*
*Completed: 2026-02-26*
