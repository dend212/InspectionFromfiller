-- =============================================================================
-- Seed: Insert Dan's admin profile and role
-- Description: Run this ONCE after Dan creates his Supabase auth account.
--              Replace <dan-user-uuid> with the actual UUID from Supabase
--              Dashboard -> Authentication -> Users.
-- Run via: Supabase Dashboard -> SQL Editor
-- =============================================================================

-- Step 1: Insert Dan's profile (use the UUID from auth.users)
INSERT INTO public.profiles (id, full_name, email)
VALUES ('<dan-user-uuid>', 'Daniel Endres', '<dan-email>');

-- Step 2: Assign admin role
INSERT INTO public.user_roles (user_id, role)
VALUES ('<dan-user-uuid>', 'admin');

-- Verification: Check that the profile and role were created
-- SELECT p.full_name, p.email, ur.role
-- FROM public.profiles p
-- JOIN public.user_roles ur ON ur.user_id = p.id
-- WHERE p.full_name = 'Daniel Endres';
