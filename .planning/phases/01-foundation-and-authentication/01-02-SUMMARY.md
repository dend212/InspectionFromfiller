---
phase: 01-foundation-and-authentication
plan: 02
subsystem: auth
tags: [supabase-auth, rls, jwt, custom-access-token-hook, zod, login, password-reset, admin-api]

# Dependency graph
requires:
  - phase: 01-foundation-and-authentication/01
    provides: Supabase clients (browser, server, admin), Drizzle schema, middleware auth refresh
provides:
  - Email/password login flow at /login with SewerTime branding
  - Password reset flow at /reset-password
  - Custom Access Token Hook injecting user_role into JWT claims
  - RLS policies enforcing role-based data access on all 4 tables
  - Admin user creation API at /api/admin/users (admin-only, creates user + profile + role)
  - Zod validation schemas for login and user creation
  - Email confirmation callback handler at /auth/confirm
  - Dan's admin account with user_role=admin in JWT
affects: [01-03-PLAN, 02-form-input, 04-review-workflow]

# Tech tracking
tech-stack:
  added: []
  patterns: [supabase-signInWithPassword, supabase-resetPasswordForEmail, supabase-verifyOtp, supabase-admin-createUser, custom-access-token-hook, rls-role-based-policies, zod-form-validation]

key-files:
  created:
    - src/app/(auth)/login/page.tsx
    - src/app/(auth)/reset-password/page.tsx
    - src/app/(auth)/auth/confirm/route.ts
    - src/app/(auth)/layout.tsx
    - src/app/api/admin/users/route.ts
    - src/components/auth/login-form.tsx
    - src/components/auth/reset-password-form.tsx
    - src/lib/validators/auth.ts
    - src/lib/db/migrations/0001_custom_auth_hook_and_rls.sql
    - src/lib/db/migrations/0002_seed_admin_user.sql
  modified:
    - .env.example

key-decisions:
  - "Used Transaction pooler (port 6543) instead of Direct connection for DATABASE_URL -- IPv6 unreachable from build environment"
  - "Combined custom auth hook and RLS policies into single migration file (0001_custom_auth_hook_and_rls.sql)"
  - "Seed admin user SQL in separate migration file (0002_seed_admin_user.sql) for reference, applied manually"

patterns-established:
  - "Auth route group: (auth) group with centered layout for login/reset-password pages"
  - "Zod validation: client-side validation in form components using Zod schemas from src/lib/validators/"
  - "Admin API pattern: verify authenticated + verify admin role via JWT decode before allowing operation"
  - "RLS policy pattern: role-based access using auth.jwt() ->> 'user_role' claim injected by Custom Access Token Hook"

requirements-completed: [AUTH-01, AUTH-02, WKFL-03]

# Metrics
duration: ~90min
completed: 2026-02-26
---

# Phase 1 Plan 02: Authentication Flow Summary

**Email/password login with SewerTime branding, Custom Access Token Hook injecting user_role into JWTs, RLS policies on all tables, admin user creation API, and Dan's admin account verified end-to-end**

## Performance

- **Duration:** ~90 min (includes user setup time for Supabase Dashboard configuration and account creation)
- **Started:** 2026-02-26
- **Completed:** 2026-02-26
- **Tasks:** 3 (2 automated, 1 human-action checkpoint)
- **Files created/modified:** 11

## Accomplishments
- Deployed database schema to Supabase via `npm run db:push` and applied Custom Access Token Hook + RLS policies via SQL migration
- Built SewerTime-branded login page with email/password authentication, client-side Zod validation, and password reset flow
- Created admin-only user creation API that creates auth user + profile + role in a single POST request
- Enabled Custom Access Token Hook in Supabase Dashboard so JWTs contain `user_role` claim
- Created Dan's admin account with verified login and `user_role=admin` in JWT
- RLS policies enforce role-based access: field techs see only their own inspections, admin/office staff see all

## Task Commits

Each task was committed atomically:

1. **Task 1: Deploy database schema, RLS policies, and Custom Access Token Hook** - `25386a9` (feat)
2. **Task 2: Build login page, password reset, admin user creation API, and Zod validators** - `c22be8f` (feat)
3. **Task 3: Enable Custom Access Token Hook and create Dan's admin account** - No commit (human-action checkpoint, user configured Supabase Dashboard and created admin account)

## Files Created/Modified
- `src/lib/db/migrations/0001_custom_auth_hook_and_rls.sql` - Custom Access Token Hook function, grants, RLS enable, and all RLS policies for 4 tables
- `src/lib/db/migrations/0002_seed_admin_user.sql` - Template SQL for seeding admin user profile and role
- `src/app/(auth)/layout.tsx` - Centered auth layout wrapper (no navigation)
- `src/app/(auth)/login/page.tsx` - Login page server component with redirect-if-authenticated
- `src/app/(auth)/reset-password/page.tsx` - Password reset request page
- `src/app/(auth)/auth/confirm/route.ts` - Email confirmation OTP callback handler
- `src/app/api/admin/users/route.ts` - Admin-only POST endpoint: creates user, profile, and role
- `src/components/auth/login-form.tsx` - SewerTime-branded login form with Zod validation and error handling
- `src/components/auth/reset-password-form.tsx` - Password reset form with success message
- `src/lib/validators/auth.ts` - Zod schemas: loginSchema, createUserSchema
- `.env.example` - Updated with DATABASE_URL variable

## Decisions Made
- **Transaction pooler for DATABASE_URL:** Used Supabase Transaction pooler (port 6543) instead of Direct connection because the direct IPv6 endpoint was unreachable from the build environment. This aligns with the `prepare: false` configuration established in Plan 01-01.
- **Single migration file for hook + RLS:** Combined the Custom Access Token Hook and all RLS policies into `0001_custom_auth_hook_and_rls.sql` rather than separate files, since they are applied together via the SQL Editor.
- **Seed SQL as reference:** Admin user seed SQL is version-controlled in `0002_seed_admin_user.sql` but applied manually with actual UUID, as specified in the plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed DATABASE_URL to use Transaction pooler**
- **Found during:** Task 1 (database schema deployment)
- **Issue:** Direct connection string (IPv6) was unreachable from the execution environment, causing `npm run db:push` to fail
- **Fix:** Switched DATABASE_URL to use the Transaction pooler endpoint (port 6543) which is IPv4-accessible
- **Files modified:** .env (local only, not committed)
- **Verification:** `npm run db:push` completed successfully, all tables created
- **Committed in:** 25386a9

**2. [Rule 1 - Bug] Fixed Zod v4 API: .errors to .issues**
- **Found during:** Task 2 (Zod validation implementation)
- **Issue:** Zod v4 changed the validation error property from `.errors` to `.issues`
- **Fix:** Updated all Zod error handling to use `.issues` property
- **Files modified:** src/components/auth/login-form.tsx, src/components/auth/reset-password-form.tsx
- **Verification:** Build passes, client-side validation works correctly
- **Committed in:** c22be8f

**3. [Rule 1 - Bug] Fixed Zod v4 z.enum() parameter format**
- **Found during:** Task 2 (Zod schema definition)
- **Issue:** Zod v4 changed `z.enum()` parameter format from array to spread or different syntax
- **Fix:** Updated enum definition in createUserSchema to match Zod v4 API
- **Files modified:** src/lib/validators/auth.ts
- **Verification:** Build passes, schema validates correctly
- **Committed in:** c22be8f

---

**Total deviations:** 3 auto-fixed (1 blocking, 2 bugs)
**Impact on plan:** All auto-fixes were necessary for the code to build and run correctly. No scope creep. Functionality matches plan intent exactly.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required

User completed all setup during Task 3 checkpoint:
- Enabled Custom Access Token Hook in Supabase Dashboard (Authentication -> Hooks -> Custom Access Token pointing to `custom_access_token_hook` function)
- Created Dan's admin account in Supabase Authentication
- Inserted profile and admin role via SQL Editor
- Verified login at https://sewertime.vercel.app with JWT containing `user_role=admin`
- App redeployed to Vercel with login page live

## Next Phase Readiness
- Authentication flow is fully operational: login, password reset, JWT role injection, RLS enforcement
- Plan 01-03 can proceed immediately: role-based dashboard shell, navigation, admin user management UI, and end-to-end verification
- Admin user creation API is ready for the user management UI to consume
- All three roles (admin, field_tech, office_staff) are defined and enforced at database level

## Self-Check: PASSED

All 11 key files verified present. Commits 25386a9 and c22be8f verified in git log. Summary file exists at expected path.

---
*Phase: 01-foundation-and-authentication*
*Completed: 2026-02-26*
