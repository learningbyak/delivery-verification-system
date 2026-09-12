-- Phase 1: organizations RLS policies
--
-- Deferred from 0001 because these policies call current_user_role(),
-- which didn't exist until 0002. Admin-only, full stop — organizations
-- is the one table in this system where "admin" genuinely means
-- "sees and manages everything, across every org."

CREATE POLICY admin_select_organizations ON organizations
  FOR SELECT
  USING (public.current_user_role() = 'admin');

CREATE POLICY admin_insert_organizations ON organizations
  FOR INSERT
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY admin_update_organizations ON organizations
  FOR UPDATE
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- No DELETE policy — denied by default, intentionally. Organizations
-- are deactivated via status = 'suspended', never hard-deleted, since
-- Phase 2+ data (uploads, departments, delivery history) hangs off
-- org_id and must never silently disappear.
