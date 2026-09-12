-- Phase 1: organizations
--
-- RLS is enabled immediately, with zero policies for now. Per our
-- documented convention (supabase/migrations/README.md), RLS-enabled +
-- no policies = deny-all by default, which is the safe starting state.
-- Real policies are added in 0003 once the role-checking helper
-- functions exist (0002) — policies referencing those functions can't
-- be created before the functions do.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  org_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name          text NOT NULL UNIQUE,
  secret_code_hash  text NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
