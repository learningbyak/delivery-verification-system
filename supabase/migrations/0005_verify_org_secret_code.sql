-- Phase 2: org secret-code verification
--
-- The Client Main Panel login flow needs to check an org_name +
-- secret_code pair BEFORE the user is authenticated (they don't have
-- a session yet — that's the whole point of this check). But
-- `organizations` RLS only allows admin to SELECT. Rather than
-- loosening that policy or reaching for the service-role key in
-- application code, this narrow SECURITY DEFINER function does
-- exactly one thing: given a name and a code, return the org_id if
-- and only if they match an active org — nothing else about
-- `organizations` is exposed through this path.
--
-- Verification happens via pgcrypto's crypt(), comparing against the
-- bcrypt hash already stored by the Node app (src/lib/secret-code.ts,
-- using bcryptjs). bcrypt is a standardized hash format regardless of
-- which implementation produced it, so this interop is safe — but it
-- was verified directly in this migration's own test, not assumed
-- (see docs/phases/phase-2.md's testing notes).
--
-- Known limitation, deliberately deferred: a nonexistent org_name
-- returns instantly (no matching row, crypt() never runs), while an
-- existing org with a wrong code takes slightly longer (crypt() does
-- run). This is a minor timing side-channel that could theoretically
-- reveal whether an org_name is registered. Full mitigation (always
-- running crypt() against a dummy hash) is deferred to Phase 6
-- hardening — flagged here so it isn't silently forgotten.

CREATE OR REPLACE FUNCTION public.verify_org_secret_code(p_org_name text, p_secret_code text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT org_id FROM public.organizations
  WHERE org_name = p_org_name
    AND status = 'active'
    AND secret_code_hash = crypt(p_secret_code, secret_code_hash);
$$;

REVOKE ALL ON FUNCTION public.verify_org_secret_code(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_org_secret_code(text, text) TO anon, authenticated;
