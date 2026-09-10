# Delivery Verification System

**Status: Phase 0 — Foundations.** See `docs/phases/phase-0.md` for exact scope, what's deliberately not built yet, and the manual account-setup steps needed before Phase 1.

## Local setup

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase project's keys
npm run dev
```

## Checks (all run in CI too)

```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint, including the server/client Supabase import boundary
npm run check:rls   # fails if any migration creates a table without enabling RLS
```

## Project structure so far

```
src/
  app/                    Next.js App Router pages
  lib/supabase/
    client.ts             Browser-safe client (anon key only)
    server.ts             Server-only client — the only place the service-role key may live
supabase/
  migrations/              SQL migrations — RLS required on every table, enforced in CI
scripts/
  check-rls.ts             The CI enforcement script above
docs/phases/                Phase-by-phase plan and exit criteria
```

## Reference documents

This build follows two documents already produced for this project:
- **Architecture Spec** — data model, roles, decisions
- **Security Assessment** — the RLS patterns, authorization pattern, and production gate this scaffold is built to satisfy

Next: Phase 1 (Admin Panel core — organizations + departments, first real RLS policies).
