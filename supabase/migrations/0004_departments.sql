-- Phase 1: departments
--
-- client_admin isn't wired up until Phase 2 (no Client Main Panel auth
-- yet), but the policies below already account for it — writing the
-- full admin + client_admin rule now means Phase 2 doesn't need to
-- touch this file again, only add the auth flow that issues
-- client_admin sessions.

CREATE TABLE departments (
  department_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(org_id) ON DELETE RESTRICT,
  department_name   text NOT NULL,
  source_dept_code  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, department_name)
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_departments ON departments
  FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    OR org_id = public.current_user_org_id()
  );

CREATE POLICY insert_departments ON departments
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR (public.current_user_role() = 'client_admin' AND org_id = public.current_user_org_id())
  );

CREATE POLICY update_departments ON departments
  FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    OR (public.current_user_role() = 'client_admin' AND org_id = public.current_user_org_id())
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR (public.current_user_role() = 'client_admin' AND org_id = public.current_user_org_id())
  );

CREATE POLICY delete_departments ON departments
  FOR DELETE
  USING (
    public.current_user_role() = 'admin'
    OR (public.current_user_role() = 'client_admin' AND org_id = public.current_user_org_id())
  );
