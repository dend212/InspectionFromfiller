# Phase 1: Foundation and Authentication - Research

**Researched:** 2026-02-25
**Domain:** Next.js 16 project setup, Supabase Auth + RLS, Drizzle ORM, Vercel deployment
**Confidence:** HIGH

## Summary

Phase 1 establishes the entire application foundation: a Next.js 16 app deployed on Vercel with Supabase providing authentication, database, and file storage. The core challenge is wiring Supabase Auth's cookie-based SSR flow with role-based access control enforced at the database level via Row Level Security (RLS) custom claims. The stack is well-documented and widely used together -- Supabase provides an official Next.js starter template, Drizzle ORM has first-class Supabase support, and Vercel's marketplace has a Supabase integration that auto-configures environment variables.

The three user roles (admin, field_tech, office_staff) are implemented via a `user_roles` table combined with Supabase's Custom Access Token Auth Hook, which injects the role into the JWT. RLS policies then reference this JWT claim to enforce data access at the database level. Dan (admin) creates all user accounts server-side using `supabase.auth.admin.createUser()` -- there is no self-signup. Persistent sessions are the Supabase default behavior: users stay logged in until manual logout, which is critical for field techs on personal phones.

**Primary recommendation:** Use the official Supabase + Next.js SSR pattern with `@supabase/ssr`, implement RBAC via Custom Access Token Auth Hook + RLS policies, use Drizzle ORM with `postgres.js` driver (with `prepare: false` for Supabase connection pooler), and deploy to Vercel with the Supabase marketplace integration.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Dan (admin) creates all user accounts -- no self-signup, no invite links
- Three roles: admin, field tech, office staff
- Field techs can start new inspections and see only their own inspections
- Office staff can review, edit, and finalize any inspection
- Admin has full access (same as office staff plus user management)
- Current team size: 3-5 field techs plus Dan
- SewerTime branded login page -- company logo, brand colors, professional look
- Persistent sessions -- users stay logged in until they manually log out (critical for field techs on personal phones)
- Self-service password reset via email reset link
- Dan-only access on initial launch for testing
- Supabase for all backend services: Postgres database, authentication, file storage
- Dan has an existing Vercel account -- deploy there
- Start with Vercel default URL (no custom domain yet)
- Supabase free tier should be sufficient for initial use (3-5 users, 5-15 inspections/month)

### Claude's Discretion
- Exact database schema design (tables, columns, relationships, indexes)
- Drizzle ORM configuration and migration strategy
- Supabase Row Level Security policy implementation
- UI component library setup (shadcn/ui theming)
- Project structure and folder organization
- CI/CD configuration

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTH-01 | Users can log in with email and password | Supabase Auth email/password flow with `@supabase/ssr` cookie-based SSR. `signInWithPassword()` on client, `proxy.ts` for token refresh, `createServerClient` for server component auth checks. Password reset via `resetPasswordForEmail()`. |
| AUTH-02 | Role-based access control enforced at database level (admin, field tech, office staff) | Supabase Custom Access Token Auth Hook injects `user_role` claim into JWT. RLS policies use `(auth.jwt() ->> 'user_role')` to enforce per-table access. Three-role enum (`admin`, `field_tech`, `office_staff`) in both Drizzle schema and Postgres. |
| WKFL-03 | Three user roles with appropriate access: admin (Dan), field tech, office staff | `user_roles` table maps users to roles. Admin creates users via `supabase.auth.admin.createUser()` with service role key (server-side only). UI shell shows different navigation/pages per role using JWT role claim read client-side via `jwtDecode()`. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.x (16.1.6 LTS) | Full-stack React framework | Current stable. Turbopack default. App Router with React 19.2. `proxy.ts` replaces middleware. Vercel deployment is first-class. |
| @supabase/supabase-js | latest | Supabase client SDK | Official Supabase JavaScript client for auth, database, and storage operations. |
| @supabase/ssr | latest | Server-side Supabase client | Cookie-based auth for Next.js App Router. Handles token refresh in `proxy.ts`. Required for SSR auth. |
| Drizzle ORM | 0.45.x | Type-safe SQL ORM | SQL-first, ~35KB bundle, sub-500ms serverless cold starts. Built-in Zod schema generation via `createInsertSchema`/`createSelectSchema`. |
| drizzle-kit | 0.30.x | Migration tool | Generates SQL migrations from Drizzle schema. `push` for dev, `generate`+`migrate` for production. |
| postgres (postgres.js) | latest | PostgreSQL driver | Recommended driver for Drizzle + Supabase. Use `{ prepare: false }` with Supabase connection pooler (Transaction mode). |
| Zod | 3.x | Schema validation | Validation schemas generated from Drizzle tables via `drizzle-orm/zod`. Shared across client forms, server actions, and API routes. |
| shadcn/ui | latest (Tailwind v4) | UI component library | Copy-paste components, zero runtime dependency. Tailwind v4 support with `tw-animate-css`. Built on Radix UI for accessibility. |
| Tailwind CSS | 4.x | Utility-first CSS | Default in Next.js 16 `create-next-app`. Uses new `@theme` directive. |
| TypeScript | 5.x | Type safety | Required by Next.js 16. Minimum 5.1.0. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| jwt-decode | latest | Decode JWT on client | Read `user_role` claim from access token in client components for UI branching. |
| @biomejs/biome | latest | Linter + formatter | Next.js 16 removed `next lint`. Biome replaces ESLint + Prettier as a single tool. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Supabase Auth | Better Auth / Clerk | Better Auth is excellent but adds a dependency when Supabase Auth is already bundled. Clerk costs $0.02/MAU after 10K -- overkill for 3-5 users. |
| Drizzle ORM | Prisma | Prisma has 800KB+ bundle and 1-3s cold starts on Vercel serverless. Drizzle is 20x smaller. |
| postgres.js | node-postgres (pg) | Either works. postgres.js is the Supabase-recommended driver for Drizzle. |
| jwt-decode | Manual JWT parsing | jwt-decode is 2KB and handles edge cases (padding, unicode). Not worth hand-rolling. |

**Installation:**
```bash
# Create Next.js 16 project
npx create-next-app@latest inspection-form-filler --typescript --tailwind --app

# Supabase
npm install @supabase/supabase-js @supabase/ssr

# Database & ORM
npm install drizzle-orm postgres zod
npm install -D drizzle-kit

# UI Components (via shadcn CLI)
npx shadcn@latest init
npx shadcn@latest add button input label card form

# JWT decode for client-side role reading
npm install jwt-decode

# Dev Tools
npm install -D @biomejs/biome
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/
│   ├── (auth)/                  # Route group: public auth pages
│   │   ├── login/page.tsx       # SewerTime branded login
│   │   ├── reset-password/page.tsx
│   │   ├── auth/confirm/route.ts  # Email confirmation callback
│   │   └── layout.tsx           # Minimal layout (no nav)
│   ├── (dashboard)/             # Route group: authenticated pages
│   │   ├── layout.tsx           # Dashboard shell with role-aware nav
│   │   ├── page.tsx             # Dashboard home (role-dependent content)
│   │   └── admin/
│   │       └── users/page.tsx   # Admin-only user management
│   ├── api/                     # Route Handlers
│   │   └── admin/
│   │       └── users/route.ts   # Create user endpoint (admin only)
│   ├── layout.tsx               # Root layout
│   └── proxy.ts                 # Auth token refresh (replaces middleware.ts)
├── components/
│   ├── ui/                      # shadcn/ui base components
│   ├── auth/
│   │   ├── login-form.tsx       # Login form component
│   │   └── reset-password-form.tsx
│   └── layout/
│       ├── header.tsx           # App header with user info
│       ├── nav.tsx              # Role-aware navigation
│       └── mobile-nav.tsx       # Mobile navigation
├── lib/
│   ├── supabase/
│   │   ├── client.ts            # Browser Supabase client
│   │   ├── server.ts            # Server Component Supabase client
│   │   ├── admin.ts             # Service role client (server-only, for user creation)
│   │   └── proxy.ts             # Session update utility for proxy.ts
│   ├── db/
│   │   ├── index.ts             # Drizzle DB client instance
│   │   ├── schema.ts            # All table definitions
│   │   └── migrations/          # Generated SQL migrations
│   └── validators/
│       └── auth.ts              # Zod schemas for auth forms
├── types/
│   └── database.ts              # Generated/shared database types
└── drizzle.config.ts            # Drizzle Kit configuration
```

### Pattern 1: Supabase SSR Auth with proxy.ts
**What:** Cookie-based authentication using `@supabase/ssr` with Next.js 16's `proxy.ts` for automatic token refresh.
**When to use:** Every authenticated request in the application.
**Example:**

```typescript
// src/lib/supabase/client.ts (browser client)
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}
```

```typescript
// src/lib/supabase/server.ts (server client)
// Source: https://supabase.com/docs/guides/auth/server-side/nextjs
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        }
      }
    }
  )
}
```

```typescript
// src/app/proxy.ts (replaces middleware.ts in Next.js 16)
// Source: https://nextjs.org/blog/next-16
import { type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"

export default async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
```

```typescript
// src/lib/supabase/proxy.ts (session update utility)
// Source: https://supabase.com/docs/guides/auth/server-side/nextjs
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session -- do NOT use getSession() here
  const { data: { user } } = await supabase.auth.getUser()

  // Redirect unauthenticated users to login (except auth pages)
  if (!user && !request.nextUrl.pathname.startsWith('/login')
      && !request.nextUrl.pathname.startsWith('/reset-password')
      && !request.nextUrl.pathname.startsWith('/auth')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
```

**Confidence:** HIGH -- Based on official Supabase SSR docs and Next.js 16 blog post.

### Pattern 2: Custom Access Token Auth Hook for RBAC
**What:** A Postgres function that runs before every JWT is issued, injecting the user's role from `user_roles` table into the JWT claims.
**When to use:** Whenever role information needs to be available in RLS policies or client-side code.
**Example:**

```sql
-- Source: https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac

-- 1. Create role enum and user_roles table
CREATE TYPE public.app_role AS ENUM ('admin', 'field_tech', 'office_staff');

CREATE TABLE public.user_roles (
  id        bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id   uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  role      app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- 2. Custom Access Token Hook function
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
  DECLARE
    claims jsonb;
    user_role public.app_role;
  BEGIN
    SELECT role INTO user_role FROM public.user_roles
    WHERE user_id = (event->>'user_id')::uuid;

    claims := event->'claims';

    IF user_role IS NOT NULL THEN
      claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));
    ELSE
      claims := jsonb_set(claims, '{user_role}', 'null');
    END IF;

    event := jsonb_set(event, '{claims}', claims);
    RETURN event;
  END;
$$;

-- 3. Grant permissions for auth system
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook
  FROM authenticated, anon, public;
GRANT ALL ON TABLE public.user_roles TO supabase_auth_admin;
REVOKE ALL ON TABLE public.user_roles FROM authenticated, anon, public;

CREATE POLICY "Allow auth admin to read user roles" ON public.user_roles
AS PERMISSIVE FOR SELECT
TO supabase_auth_admin
USING (true);
```

Then enable the hook in the Supabase Dashboard: Authentication > Hooks (Beta) > Custom Access Token.

**Confidence:** HIGH -- Official Supabase RBAC documentation with verified SQL examples.

### Pattern 3: RLS Policies Using JWT Role Claims
**What:** Database-level access control that reads the `user_role` claim from the JWT to enforce per-table permissions.
**When to use:** Every table that needs role-based access restrictions.
**Example:**

```sql
-- Source: https://supabase.com/docs/guides/database/postgres/row-level-security

-- Inspections: field techs see only their own; admin/office see all
CREATE POLICY "Field techs see own inspections"
ON public.inspections FOR SELECT
TO authenticated
USING (
  (SELECT auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
  OR (auth.uid() = inspector_id)
);

-- Field techs can create inspections assigned to themselves
CREATE POLICY "Field techs create own inspections"
ON public.inspections FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT auth.jwt() ->> 'user_role') IN ('admin', 'field_tech')
  AND auth.uid() = inspector_id
);

-- Only admin/office staff can update inspections
CREATE POLICY "Admin and office update inspections"
ON public.inspections FOR UPDATE
TO authenticated
USING (
  (SELECT auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
);

-- User roles: only admins can manage
CREATE POLICY "Admins manage user roles"
ON public.user_roles FOR ALL
TO authenticated
USING ((SELECT auth.jwt() ->> 'user_role') = 'admin')
WITH CHECK ((SELECT auth.jwt() ->> 'user_role') = 'admin');
```

**Confidence:** HIGH -- Official Supabase RLS documentation patterns.

### Pattern 4: Admin User Creation (No Self-Signup)
**What:** Admin (Dan) creates user accounts server-side using the Supabase service role key. No public signup endpoint exists.
**When to use:** When a new field tech or office staff member joins the team.
**Example:**

```typescript
// src/lib/supabase/admin.ts (SERVER-ONLY -- never import in client code)
// Source: https://supabase.com/docs/reference/javascript/auth-admin-createuser
import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,  // NEVER expose this key
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
```

```typescript
// src/app/api/admin/users/route.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  // Verify caller is admin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check admin role from JWT
  const { data: claims } = await supabase.auth.getClaims()
  if (claims?.user_role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { email, password, role, name } = await request.json()

  // Create user with admin client
  const adminClient = createAdminClient()
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,  // Skip email confirmation since admin is creating
    user_metadata: { full_name: name }
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Assign role in user_roles table
  const { error: roleError } = await adminClient
    .from('user_roles')
    .insert({ user_id: data.user.id, role })

  if (roleError) return NextResponse.json({ error: roleError.message }, { status: 400 })

  return NextResponse.json({ user: data.user })
}
```

**Confidence:** HIGH -- Official Supabase admin API reference.

### Pattern 5: Drizzle ORM with Supabase
**What:** Type-safe database access using Drizzle ORM connected to Supabase Postgres via the connection pooler.
**When to use:** All database queries outside of Supabase client SDK operations (auth, storage).
**Example:**

```typescript
// drizzle.config.ts
// Source: https://orm.drizzle.team/docs/connect-supabase
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  schemaFilter: "public",
  strict: true,
  verbose: true,
});
```

```typescript
// src/lib/db/index.ts
// Source: https://supabase.com/docs/guides/database/drizzle
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Disable prefetch for Supabase connection pooler (Transaction mode)
const client = postgres(process.env.DATABASE_URL!, { prepare: false })
export const db = drizzle(client, { schema })
```

```typescript
// src/lib/db/schema.ts
import { pgTable, pgEnum, uuid, text, varchar, timestamp,
         boolean, jsonb, integer } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// Role enum matching Supabase custom claims
export const appRoleEnum = pgEnum('app_role', ['admin', 'field_tech', 'office_staff'])

// Inspection status enum
export const inspectionStatusEnum = pgEnum('inspection_status',
  ['draft', 'submitted', 'in_review', 'completed', 'sent'])

// User profiles (extends Supabase auth.users)
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),  // matches auth.users.id
  fullName: text('full_name').notNull(),
  email: text('email').notNull(),
  phone: varchar('phone', { length: 20 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// User roles table (used by Custom Access Token Hook)
export const userRoles = pgTable('user_roles', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid('user_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
  role: appRoleEnum('role').notNull(),
}, (table) => [
  // Unique constraint: one role per user
])

// Inspections table
export const inspections = pgTable('inspections', {
  id: uuid('id').defaultRandom().primaryKey(),
  inspectorId: uuid('inspector_id').references(() => profiles.id).notNull(),
  status: inspectionStatusEnum('status').default('draft').notNull(),
  // Facility info
  facilityName: text('facility_name'),
  facilityAddress: text('facility_address'),
  facilityCity: text('facility_city'),
  facilityCounty: text('facility_county'),
  facilityState: varchar('facility_state', { length: 2 }).default('AZ'),
  facilityZip: varchar('facility_zip', { length: 10 }),
  // Form data stored as JSONB for flexibility during early development
  formData: jsonb('form_data'),
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  submittedAt: timestamp('submitted_at'),
  completedAt: timestamp('completed_at'),
})

// Inspection media (photos and videos)
export const inspectionMedia = pgTable('inspection_media', {
  id: uuid('id').defaultRandom().primaryKey(),
  inspectionId: uuid('inspection_id').references(() => inspections.id, { onDelete: 'cascade' }).notNull(),
  type: text('type').notNull(),  // 'photo' or 'video'
  storagePath: text('storage_path').notNull(),
  label: text('label'),  // e.g., 'Septic Tank Lid', 'Distribution Box'
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Relations
export const profilesRelations = relations(profiles, ({ many }) => ({
  inspections: many(inspections),
  roles: many(userRoles),
}))

export const inspectionsRelations = relations(inspections, ({ one, many }) => ({
  inspector: one(profiles, {
    fields: [inspections.inspectorId],
    references: [profiles.id],
  }),
  media: many(inspectionMedia),
}))

export const inspectionMediaRelations = relations(inspectionMedia, ({ one }) => ({
  inspection: one(inspections, {
    fields: [inspectionMedia.inspectionId],
    references: [inspections.id],
  }),
}))
```

**Confidence:** HIGH -- Based on official Drizzle ORM docs and Supabase Drizzle integration guide.

### Anti-Patterns to Avoid
- **Using `getSession()` in server code:** Never trust `getSession()` in proxy.ts or Server Components. Use `getUser()` (makes server round-trip) or `getClaims()` (validates JWT signature locally). `getSession()` does not revalidate the auth token.
- **Exposing service role key:** The `SUPABASE_SERVICE_ROLE_KEY` must NEVER be in client code or prefixed with `NEXT_PUBLIC_`. Only use it in server-side Route Handlers / Server Actions.
- **Individual cookie methods:** Never use individual `get`/`set`/`remove` cookie methods with `@supabase/ssr`. Always use `getAll`/`setAll` -- the old pattern will break the application.
- **Storing roles in user_metadata:** `user_metadata` is editable by the user. Roles MUST be stored in a separate `user_roles` table and injected into the JWT via the Custom Access Token Hook, where they are immutable by the user.
- **Skipping `{ prepare: false }`:** Supabase's connection pooler uses Transaction mode, which does not support prepared statements. Omitting `prepare: false` in the postgres.js client will cause query failures.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth session management | Custom JWT + cookie handling | `@supabase/ssr` with `createBrowserClient`/`createServerClient` | Token refresh, cookie serialization, PKCE flow, and cross-tab sync are extremely complex to implement correctly. One missed edge case = security vulnerability. |
| Role-based access control | Custom middleware role checks only | Supabase RLS + Custom Access Token Hook | Middleware-only RBAC can be bypassed via direct API calls. RLS enforces at the database level -- impossible to bypass regardless of how the query arrives. |
| Password reset flow | Custom email + token system | `supabase.auth.resetPasswordForEmail()` | Handles token generation, email sending, expiry, and one-time use. Building this securely is a multi-week effort. |
| User creation for admin | Custom signup endpoint | `supabase.auth.admin.createUser()` | Handles password hashing, email verification, user record creation atomically. |
| Database migrations | Raw SQL files | Drizzle Kit (`generate` + `migrate`) | Tracks migration state, generates diffs, prevents conflicts, provides rollback metadata. |
| Form validation | Manual if/else checking | Zod schemas (generated from Drizzle via `createInsertSchema`) | Single source of truth for validation. Runs on both client (instant feedback) and server (security). |

**Key insight:** Supabase bundles auth, database, storage, and RLS into a single platform. Every hand-rolled replacement of these features adds complexity, introduces security risks, and breaks the tight integration between components (e.g., RLS policies can directly reference `auth.uid()` and `auth.jwt()` because auth and database are the same platform).

## Common Pitfalls

### Pitfall 1: Forgetting to Enable the Custom Access Token Hook in Dashboard
**What goes wrong:** The SQL function for the hook is created, but the hook is not enabled in the Supabase Dashboard. The JWT never contains the `user_role` claim, so all RLS policies fail silently (deny access).
**Why it happens:** The hook requires both: (1) creating the PL/pgSQL function in SQL, AND (2) enabling it in Authentication > Hooks (Beta) in the Supabase Dashboard. Developers complete step 1 and forget step 2.
**How to avoid:** After running the hook SQL, immediately go to the Supabase Dashboard > Authentication > Hooks > Custom Access Token and select the `custom_access_token_hook` function. Test by logging in and inspecting the JWT in browser devtools (Application > Cookies > decode the `sb-*-auth-token` cookie).
**Warning signs:** Users can log in but see empty data. RLS policies with `auth.jwt() ->> 'user_role'` return NULL.

### Pitfall 2: proxy.ts Not Refreshing Tokens Properly
**What goes wrong:** The proxy creates a Supabase client but does not properly pass refreshed cookies back to both the request and response. Server Components receive stale auth tokens, causing intermittent auth failures.
**Why it happens:** The cookie handling in `proxy.ts` requires carefully coordinating `request.cookies.set` AND `response.cookies.set` in the `setAll` callback. If either is missed, tokens are not propagated correctly.
**How to avoid:** Use the exact pattern from Supabase docs (shown in Architecture Patterns above). The `setAll` callback MUST set cookies on both the request (for downstream Server Components) and the supabaseResponse (for the browser). Never modify `supabaseResponse` independently after creating it.
**Warning signs:** Auth works on first page load but breaks after token expiry (default 1 hour). Users report being randomly logged out.

### Pitfall 3: Deploying Without Supabase Environment Variables
**What goes wrong:** App deploys to Vercel but Supabase client cannot connect. All auth and database operations fail.
**Why it happens:** `.env.local` is gitignored (correctly), but developers forget to add the same variables in Vercel's project settings. The Vercel-Supabase marketplace integration can auto-populate these, but only if set up.
**How to avoid:** Use the Vercel marketplace Supabase integration (auto-populates environment variables). Alternatively, manually add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `DATABASE_URL` in Vercel project settings > Environment Variables. Add for all environments (Production, Preview, Development).
**Warning signs:** Works locally but fails on Vercel. Console errors mentioning missing `NEXT_PUBLIC_SUPABASE_URL`.

### Pitfall 4: Supabase Free Tier Email Rate Limit
**What goes wrong:** Password reset emails stop being sent. New user invitations fail silently.
**Why it happens:** Supabase's default email service has a rate limit of 2 emails per hour. During testing with multiple users, this limit is hit quickly.
**How to avoid:** For development and initial launch with 3-5 users, the free tier is acceptable if you are careful about rate limits. For production, configure a custom SMTP provider (Resend, SendGrid, etc.) in Supabase Dashboard > Authentication > Email Templates > SMTP Settings. Resend's free tier (100 emails/day) is more than sufficient.
**Warning signs:** Password reset emails never arrive. No error in the app (Supabase returns success even when rate limited).

### Pitfall 5: Running Drizzle Migrations Against Wrong Database
**What goes wrong:** Migrations run against the direct database connection instead of the pooler, or against the wrong Supabase project.
**Why it happens:** Supabase provides multiple connection strings: Direct Connection (for migrations/admin), Session Pooler, and Transaction Pooler. Using the Transaction Pooler for migrations can fail because some DDL statements require a direct connection.
**How to avoid:** Use the **Direct Connection** string for `drizzle-kit` operations (generate, migrate, push). Use the **Transaction Pooler** string for the application runtime (`DATABASE_URL` in app code). Consider having two env vars: `DATABASE_URL` (pooler, for app) and `DATABASE_URL_DIRECT` (direct, for migrations).
**Warning signs:** Migration commands hang or fail with "prepared statement already exists" errors.

## Code Examples

### Login Form with Supabase Auth
```typescript
// src/components/auth/login-form.tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>SewerTime Septic</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
```

### Password Reset Request
```typescript
// Source: https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
'use client'

import { createClient } from '@/lib/supabase/client'

async function handleResetPassword(email: string) {
  const supabase = createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
  })
  if (error) throw error
  // Show success message: "Check your email for a reset link"
}
```

### Reading User Role Client-Side
```typescript
// Source: https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac
'use client'

import { jwtDecode } from 'jwt-decode'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'

type AppRole = 'admin' | 'field_tech' | 'office_staff'

export function useUserRole(): AppRole | null {
  const [role, setRole] = useState<AppRole | null>(null)
  const supabase = createClient()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session) {
          const jwt = jwtDecode<{ user_role: AppRole }>(session.access_token)
          setRole(jwt.user_role)
        } else {
          setRole(null)
        }
      }
    )
    return () => subscription.unsubscribe()
  }, [supabase])

  return role
}
```

### Protected Server Component
```typescript
// src/app/(dashboard)/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // getClaims() validates JWT locally (fast, no server round-trip)
  const { data: claims } = await supabase.auth.getClaims()
  const userRole = claims?.user_role as string

  return (
    <div>
      <h1>Welcome to SewerTime</h1>
      {userRole === 'admin' && <AdminDashboard />}
      {userRole === 'field_tech' && <FieldTechDashboard />}
      {userRole === 'office_staff' && <OfficeDashboard />}
    </div>
  )
}
```

### Drizzle Zod Validation Schema Generation
```typescript
// src/lib/validators/auth.ts
// Source: https://orm.drizzle.team/docs/zod
import { createInsertSchema, createSelectSchema } from 'drizzle-orm/zod'
import { z } from 'zod'
import { profiles, inspections } from '@/lib/db/schema'

// Auto-generated from Drizzle schema, with refinements
export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(1, 'Name is required'),
  role: z.enum(['admin', 'field_tech', 'office_staff']),
})

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
})

// Generated from Drizzle table definitions
export const insertProfileSchema = createInsertSchema(profiles)
export const selectProfileSchema = createSelectSchema(profiles)
export const insertInspectionSchema = createInsertSchema(inspections)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `middleware.ts` | `proxy.ts` | Next.js 16 (Oct 2025) | Rename file and export. Logic stays the same. `middleware.ts` still works but is deprecated. |
| `@supabase/auth-helpers-nextjs` | `@supabase/ssr` | 2024 | Old package is fully deprecated. New package uses `getAll`/`setAll` cookie pattern. |
| `getSession()` in server code | `getUser()` or `getClaims()` | 2025 | `getSession()` does not revalidate the JWT. `getClaims()` validates signature locally; `getUser()` makes a server round-trip. |
| `experimental.ppr` flag | `cacheComponents: true` | Next.js 16 | PPR flag removed. Cache Components is the new programming model. Not needed for Phase 1. |
| `next lint` command | Biome or ESLint CLI directly | Next.js 16 | `next lint` and `next build` linting removed. Use Biome as standalone tool. |
| `drizzle-zod` package | `drizzle-orm/zod` (built-in) | drizzle-orm 0.30.0 | Zod schema generation is now built into drizzle-orm core. No separate package needed. |
| Individual cookie methods | `getAll`/`setAll` | @supabase/ssr | Old individual `get`/`set`/`remove` pattern breaks the app. Must use bulk methods. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 2025 | Supabase transitioning to new key format. Both work during transition period. |

**Deprecated/outdated:**
- `@supabase/auth-helpers-nextjs`: Fully replaced by `@supabase/ssr`. Will break with current Supabase versions.
- `middleware.ts`: Deprecated in Next.js 16 in favor of `proxy.ts`. Still works but will be removed.
- `next lint`: Removed in Next.js 16. Use Biome.

## Open Questions

1. **Supabase `getClaims()` availability**
   - What we know: Supabase docs reference `getClaims()` as the recommended method for server-side JWT validation. It validates the JWT signature against the project's published public keys without a server round-trip.
   - What's unclear: The exact API surface of `getClaims()` is relatively new and may not be in all `@supabase/supabase-js` versions. Some docs still reference `getUser()` as the primary method.
   - Recommendation: Use `getUser()` in `proxy.ts` (needs server validation for token refresh). Use `getClaims()` in Server Components where available; fall back to `getUser()` if not. Test during implementation.

2. **Next.js 16 proxy.ts file location**
   - What we know: The Next.js 16 blog post shows `proxy.ts` at the project root with `export default function proxy()`. The Supabase docs still reference `middleware.ts`.
   - What's unclear: Whether `proxy.ts` goes in `src/app/proxy.ts` or project root `proxy.ts` when using the `src/` directory structure.
   - Recommendation: Place at project root (`proxy.ts`) mirroring where `middleware.ts` lived. Test during scaffolding. The Next.js upgrade guide will clarify.

3. **Supabase email deliverability on free tier**
   - What we know: Free tier has a 2 emails/hour rate limit. Password reset emails use this quota.
   - What's unclear: Whether the rate limit applies per-project or per-email-address. Whether rate-limited emails are queued or silently dropped.
   - Recommendation: For initial launch with Dan as the only user, the free tier is fine. Configure a custom SMTP (Resend free tier) before adding more users.

## Sources

### Primary (HIGH confidence)
- [Supabase Auth Quickstart for Next.js](https://supabase.com/docs/guides/auth/quickstarts/nextjs) -- SSR setup, client/server patterns
- [Supabase Server-Side Auth for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs) -- proxy.ts integration, cookie handling
- [Supabase SSR Client Creation](https://supabase.com/docs/guides/auth/server-side/creating-a-client) -- `createBrowserClient`, `createServerClient`, `getAll`/`setAll`
- [Supabase Custom Claims & RBAC](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac) -- Custom Access Token Hook, `user_roles` table, JWT claims
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) -- RLS policy patterns, `auth.uid()`, `auth.jwt()`
- [Supabase Session Configuration](https://supabase.com/docs/guides/auth/sessions) -- Persistent sessions, refresh tokens, JWT expiry
- [Supabase `auth.admin.createUser()`](https://supabase.com/docs/reference/javascript/auth-admin-createuser) -- Server-side user creation API
- [Supabase Password Reset](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail) -- Email reset flow
- [Next.js 16 Blog Post](https://nextjs.org/blog/next-16) -- `proxy.ts`, Cache Components, Turbopack, breaking changes
- [Drizzle ORM + Supabase](https://supabase.com/docs/guides/database/drizzle) -- Connection config, `prepare: false`
- [Drizzle ORM Connect Supabase](https://orm.drizzle.team/docs/connect-supabase) -- postgres.js driver setup
- [Drizzle ORM Schema Declaration](https://orm.drizzle.team/docs/sql-schema-declaration) -- `pgTable`, column types, enums, relations
- [Drizzle ORM Zod Integration](https://orm.drizzle.team/docs/zod) -- Built-in Zod schema generation
- [Drizzle Kit Overview](https://orm.drizzle.team/docs/kit-overview) -- `generate`, `migrate`, `push` commands
- [shadcn/ui Next.js Installation](https://ui.shadcn.com/docs/installation/next) -- Setup with Tailwind v4
- [shadcn/ui Tailwind v4 Guide](https://ui.shadcn.com/docs/tailwind-v4) -- `tw-animate-css`, `@theme` directive

### Secondary (MEDIUM confidence)
- [Supabase + Next.js AI Prompts Guide](https://supabase.com/docs/guides/getting-started/ai-prompts/nextjs-supabase-auth) -- Next.js v16 specific patterns
- [Vercel Supabase Marketplace Integration](https://vercel.com/marketplace/supabase) -- Auto-populated env vars
- [Supabase Advanced Auth Guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide) -- `getClaims()` vs `getUser()` vs `getSession()`

### Tertiary (LOW confidence)
- None -- all findings verified with official documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries have official integration docs with each other
- Architecture: HIGH -- Supabase + Next.js SSR pattern is well-documented with official examples
- Pitfalls: HIGH -- Common issues documented in official troubleshooting guides and GitHub discussions

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (stable stack, 30-day validity)
