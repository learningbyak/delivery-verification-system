# Migrations — RLS-by-default rule

**Every migration that creates a table MUST enable Row-Level Security on
that table in the same migration file.** No exceptions, no "I'll add
policies later." A table with RLS off is world-readable/writable via the
anon key the moment it exists.

This isn't just a convention — `npm run check:rls` enforces it in CI
(see `scripts/check-rls.ts`). A migration that creates a table without a
matching `ENABLE ROW LEVEL SECURITY` fails the build.

## Required pattern for every new table

```sql
CREATE TABLE example_table (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(org_id)
  -- ...
);

ALTER TABLE example_table ENABLE ROW LEVEL SECURITY;

-- At minimum, a deny-by-default posture until real policies are written:
-- with RLS enabled and zero policies, Postgres denies all access by
-- default, which is the safe starting state. Add explicit policies in
-- the same migration once the access rules for this table are decided
-- (see the Security Assessment, Section 6, for the reference patterns).
```

No tables exist yet in Phase 0 — this file and the CI check exist so
that Phase 1's first real migration can't accidentally skip this.
