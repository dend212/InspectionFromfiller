-- =============================================================================
-- Migration: Custom Access Token Auth Hook + RLS Policies
-- Description: Creates the auth hook function for JWT role injection, grants
--              permissions to supabase_auth_admin, enables RLS on all tables,
--              and creates role-based access policies.
-- Run via: Supabase Dashboard -> SQL Editor (copy-paste and execute)
-- =============================================================================

-- ============================================================================
-- PART 1: Custom Access Token Auth Hook
-- Source: https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac
-- ============================================================================

-- Create the hook function that injects user_role into JWT claims
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
  DECLARE
    claims jsonb;
    user_role public.app_role;
  BEGIN
    -- Look up the user's role from user_roles table
    SELECT role INTO user_role FROM public.user_roles
    WHERE user_id = (event->>'user_id')::uuid;

    claims := event->'claims';

    IF user_role IS NOT NULL THEN
      -- Set the user_role claim to the found role
      claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));
    ELSE
      -- Set user_role to null if no role found
      claims := jsonb_set(claims, '{user_role}', 'null');
    END IF;

    -- Update the event with modified claims
    event := jsonb_set(event, '{claims}', claims);
    RETURN event;
  END;
$$;

-- ============================================================================
-- PART 2: Auth Hook Permissions
-- Grant supabase_auth_admin access to the hook function and user_roles table
-- ============================================================================

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;
GRANT ALL ON TABLE public.user_roles TO supabase_auth_admin;
REVOKE ALL ON TABLE public.user_roles FROM authenticated, anon, public;

-- ============================================================================
-- PART 3: Enable Row Level Security on All Tables
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_media ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PART 4: RLS Policies
-- ============================================================================

-- ---------------------------------------------------------------------------
-- user_roles policies
-- ---------------------------------------------------------------------------

-- Allow supabase_auth_admin to read user_roles (required for the auth hook)
CREATE POLICY "Allow auth admin to read user roles"
ON public.user_roles
AS PERMISSIVE FOR SELECT
TO supabase_auth_admin
USING (true);

-- Only admin can manage user_roles
CREATE POLICY "Admins manage user roles"
ON public.user_roles FOR ALL
TO authenticated
USING ((SELECT auth.jwt() ->> 'user_role') = 'admin')
WITH CHECK ((SELECT auth.jwt() ->> 'user_role') = 'admin');

-- ---------------------------------------------------------------------------
-- profiles policies
-- ---------------------------------------------------------------------------

-- Users can read their own profile; admin and office_staff can read all
CREATE POLICY "Users read own profile or admin/office reads all"
ON public.profiles FOR SELECT
TO authenticated
USING (
  auth.uid() = id
  OR (SELECT auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
);

-- Users can update their own profile
CREATE POLICY "Users update own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Admin can insert profiles (for user creation)
CREATE POLICY "Admin can insert profiles"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK ((SELECT auth.jwt() ->> 'user_role') = 'admin');

-- Allow service role to insert profiles (for admin user creation API)
-- Note: service_role bypasses RLS by default, so this is mainly documentation

-- ---------------------------------------------------------------------------
-- inspections policies
-- ---------------------------------------------------------------------------

-- Admin/office_staff see all inspections; field_tech sees only their own
CREATE POLICY "Field techs see own inspections"
ON public.inspections FOR SELECT
TO authenticated
USING (
  (SELECT auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
  OR (auth.uid() = inspector_id)
);

-- Admin and field_tech can create inspections (must set inspector_id to own id)
CREATE POLICY "Field techs create own inspections"
ON public.inspections FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT auth.jwt() ->> 'user_role') IN ('admin', 'field_tech')
  AND auth.uid() = inspector_id
);

-- Admin/office_staff can update any inspection; field_tech can update own drafts
CREATE POLICY "Admin and office update any inspection"
ON public.inspections FOR UPDATE
TO authenticated
USING (
  (SELECT auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
  OR (
    auth.uid() = inspector_id
    AND status = 'draft'
  )
)
WITH CHECK (
  (SELECT auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
  OR (
    auth.uid() = inspector_id
    AND status = 'draft'
  )
);

-- ---------------------------------------------------------------------------
-- inspection_media policies
-- ---------------------------------------------------------------------------

-- Media visibility follows parent inspection visibility
CREATE POLICY "Media visible with parent inspection"
ON public.inspection_media FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.inspections
    WHERE inspections.id = inspection_media.inspection_id
    AND (
      (SELECT auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
      OR auth.uid() = inspections.inspector_id
    )
  )
);

-- Media insert follows inspection insert permissions
CREATE POLICY "Media insert with inspection permissions"
ON public.inspection_media FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.inspections
    WHERE inspections.id = inspection_media.inspection_id
    AND (
      (SELECT auth.jwt() ->> 'user_role') IN ('admin', 'field_tech')
      AND auth.uid() = inspections.inspector_id
    )
  )
);

-- Admin/office_staff can delete any media; field_tech can delete from own inspections
CREATE POLICY "Media delete permissions"
ON public.inspection_media FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.inspections
    WHERE inspections.id = inspection_media.inspection_id
    AND (
      (SELECT auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
      OR auth.uid() = inspections.inspector_id
    )
  )
);
