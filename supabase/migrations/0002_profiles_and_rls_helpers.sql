-- Phase 1: profiles + role-checking helper functions
--
-- profiles links a Supabase Auth user (auth.users) to a role and,
-- for client_admin, an organization. admin/client_admin distinction
-- and org scoping is decided here, not via custom JWT claims — this
-- avoids requiring a manual "Custom Access Token Hook" configuration
-- step in the Supabase Dashboard, so the whole security model is
-- expressible purely in SQL migrations, testable without any
-- additional account-level setup.
--
-- current_user_role() / current_user_org_id() are SECURITY DEFINER,
-- meaning they bypass RLS for their own internal lookup. This is a
-- deliberate, standard Supabase pattern: without it, a policy on
-- `profiles` that calls a function which queries `profiles` would
-- recurse into itself. SECURITY DEFINER breaks that cycle safely,
-- because the function does exactly one narrow thing (look up the
-- calling user's own row) and nothing else.

CREATE TABLE profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('admin', 'client_admin')),
  org_id      uuid REFERENCES organizations(org_id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_has_no_org_client_admin_requires_org CHECK (
    (role = 'admin' AND org_id IS NULL) OR
    (role = 'client_admin' AND org_id IS NOT NULL)
  )
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid();
$$;

-- A user can always read their own profile row.
CREATE POLICY self_select_profile ON profiles
  FOR SELECT
  USING (id = auth.uid());

-- Admin can read every profile.
CREATE POLICY admin_select_all_profiles ON profiles
  FOR SELECT
  USING (public.current_user_role() = 'admin');

-- Only admin can create/modify profiles in Phase 1 — there is no
-- self-service signup flow yet (that arrives with Client Main Panel
-- auth in Phase 2). The very first admin profile is created by the
-- bootstrap script (scripts/create-admin.ts) using the service-role
-- key, which bypasses RLS — see that script for why this is the one
-- legitimate use of service-role in this phase.
CREATE POLICY admin_insert_profiles ON profiles
  FOR INSERT
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY admin_update_profiles ON profiles
  FOR UPDATE
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- No DELETE policy — denied by default. Profile removal, if ever
-- needed, cascades from deleting the auth.users row via service-role,
-- not a direct client-facing delete.
